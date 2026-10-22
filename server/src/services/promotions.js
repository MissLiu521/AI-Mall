/**
 * 营销域：优惠券 / 限时秒杀 / 拼团
 *
 * 设计取舍：
 * - 券的"能不能用"由 pricing.evaluateCoupon 判定，这里只负责发放与状态流转，避免两套规则打架。
 * - 秒杀与 SKU 库存联动：秒杀有独立配额，但下单时仍会校验 SKU 库存，双保险防超卖。
 * - 拼团用订单承载：开团/参团都生成一笔待付款订单，成团后统一置为已支付，失败统一退款。
 */
import { all, get, run, tx } from '../db/index.js';
import { AppError } from './users.js';
import { toIso } from '../lib/time.js';
import { onOrderPaid } from './engagement.js';
import { levelForSpent } from './pricing.js';

// ── 优惠券 ────────────────────────────────────────────────

/** 券中心：列出可领取的券，并标注当前用户是否已领/是否抢光 */
export function listCoupons(userId) {
  const rows = all(
    `SELECT * FROM coupons
      WHERE status = 'active'
        AND (start_at IS NULL OR start_at <= datetime('now'))
        AND (end_at IS NULL OR end_at > datetime('now'))
      ORDER BY threshold_cents, id`,
  );
  const mine = userId
    ? all('SELECT coupon_id, COUNT(*) c FROM user_coupons WHERE user_id = ? GROUP BY coupon_id', [userId])
    : [];
  const mineMap = new Map(mine.map((m) => [m.coupon_id, m.c]));
  return rows.map((c) => {
    const claimedByMe = mineMap.get(c.id) || 0;
    const soldOut = c.total > 0 && c.claimed >= c.total;
    return {
      id: c.id,
      title: c.title,
      type: c.type,
      threshold: +(c.threshold_cents / 100).toFixed(2),
      value: c.value,
      maxDiscount: c.max_discount_cents ? +(c.max_discount_cents / 100).toFixed(2) : null,
      category: c.category || '全场通用',
      total: c.total,
      claimed: c.claimed,
      remain: Math.max(0, c.total - c.claimed),
      perUser: c.per_user,
      claimedByMe,
      soldOut,
      canClaim: !soldOut && claimedByMe < c.per_user,
      endAt: toIso(c.end_at),
      // 给前端一句人话，不用自己拼
      rule: couponRuleText(c),
    };
  });
}

function couponRuleText(c) {
  const t = c.threshold_cents ? `满 ¥${(c.threshold_cents / 100).toFixed(0)}` : '无门槛';
  if (c.type === 'free_ship') return `${t} 免运费`;
  if (c.type === 'discount') {
    const cap = c.max_discount_cents ? `，最高减 ¥${(c.max_discount_cents / 100).toFixed(0)}` : '';
    return `${t} 享 ${(c.value / 10).toFixed(1)} 折${cap}`;
  }
  return `${t} 减 ¥${(c.value / 100).toFixed(0)}`;
}

export function claimCoupon(userId, couponId) {
  return tx(() => {
    const c = get('SELECT * FROM coupons WHERE id = ?', [couponId]);
    if (!c) throw new AppError('NOT_FOUND', '优惠券不存在', 404);
    if (c.status !== 'active') throw new AppError('COUPON_OFF', '该券已停止发放', 400);
    if (c.end_at && get("SELECT datetime('now') > ? AS x", [c.end_at]).x) {
      throw new AppError('COUPON_EXPIRED', '该券已过期', 400);
    }
    if (c.total > 0 && c.claimed >= c.total) throw new AppError('COUPON_SOLD_OUT', '该券已被领完', 400);

    const mine = get('SELECT COUNT(*) c FROM user_coupons WHERE user_id = ? AND coupon_id = ?', [userId, couponId]).c;
    if (mine >= c.per_user) throw new AppError('COUPON_LIMIT', `每人限领 ${c.per_user} 张`, 400);

    run('UPDATE coupons SET claimed = claimed + 1 WHERE id = ?', [couponId]);
    const { lastId } = run(
      'INSERT INTO user_coupons (user_id, coupon_id, expire_at) VALUES (?,?,?)',
      [userId, couponId, c.end_at],
    );
    return { id: lastId, couponId, title: c.title };
  });
}

/** 我的券包：过期状态按时间实时判定，不依赖定时任务 */
export function myCoupons(userId, status = '') {
  const rows = all(
    `SELECT uc.id AS id, uc.status, uc.expire_at, uc.order_id,
            c.id AS coupon_id, c.title, c.type, c.threshold_cents, c.value,
            c.max_discount_cents, c.category
       FROM user_coupons uc
       JOIN coupons c ON c.id = uc.coupon_id
      WHERE uc.user_id = ?
      ORDER BY uc.id DESC`,
    [userId],
  );
  const now = get("SELECT datetime('now') AS n").n;
  const items = rows.map((r) => {
    let st = r.status;
    if (st === 'unused' && r.expire_at && String(r.expire_at) <= String(now)) st = 'expired';
    return {
      id: r.id,
      couponId: r.coupon_id,
      title: r.title,
      type: r.type,
      threshold: +(r.threshold_cents / 100).toFixed(2),
      value: r.value,
      category: r.category || '全场通用',
      rule: couponRuleText(r),
      status: st,
      orderId: r.order_id || null,
      expireAt: toIso(r.expire_at),
    };
  });
  if (!status) return items;
  return items.filter((i) => i.status === status);
}

/** 下单时按 userCouponId 取券模板，并校验归属与状态 */
export function resolveUserCoupon(userId, userCouponId) {
  if (!userCouponId) return null;
  // 注意：user_coupons 与 coupons 都有 status/id，必须显式别名，否则会被后者的同名列传覆盖
  const row = get(
    `SELECT uc.id AS user_coupon_id, uc.status AS use_status, uc.expire_at,
            c.id AS coupon_id, c.title, c.type, c.threshold_cents, c.value,
            c.max_discount_cents, c.category, c.status AS coupon_status
       FROM user_coupons uc
       JOIN coupons c ON c.id = uc.coupon_id
      WHERE uc.id = ? AND uc.user_id = ?`,
    [+userCouponId, userId],
  );
  if (!row) throw new AppError('COUPON_NOT_FOUND', '优惠券不存在或不属于你', 400);
  if (row.use_status !== 'unused') throw new AppError('COUPON_USED', '该券已使用', 400);
  if (row.expire_at && get("SELECT datetime('now') > ? AS x", [row.expire_at]).x) {
    throw new AppError('COUPON_EXPIRED', '该券已过期', 400);
  }
  return {
    id: row.coupon_id,
    user_coupon_id: row.user_coupon_id,
    title: row.title,
    type: row.type,
    threshold_cents: row.threshold_cents,
    value: row.value,
    max_discount_cents: row.max_discount_cents,
    category: row.category,
    status: row.coupon_status,
    expire_at: row.expire_at,
  };
}

export function markCouponUsed(userId, userCouponId, orderId) {
  if (!userCouponId) return;
  run("UPDATE user_coupons SET status = 'used', order_id = ? WHERE id = ? AND user_id = ?",
    [orderId, userCouponId, userId]);
}

export function restoreCoupon(userId, orderId) {
  run("UPDATE user_coupons SET status = 'unused', order_id = NULL WHERE order_id = ? AND user_id = ?",
    [orderId, userId]);
}

// ── 限时秒杀 ──────────────────────────────────────────────

export function listFlashSales() {
  const rows = all(
    `SELECT f.*, p.title AS product_name, p.subtitle, p.image, p.price_cents AS origin_cents, p.category, p.rating
       FROM flash_sales f JOIN products p ON p.id = f.product_id
      WHERE f.status = 'active' AND f.end_at > datetime('now')
      ORDER BY f.end_at`,
  );
  return rows.map((f) => ({
    id: f.id,
    productId: f.product_id,
    skuId: f.sku_id,
    campaign: f.title || '限时秒杀',
    productName: f.product_name,
    subtitle: f.subtitle,
    image: f.image,
    category: f.category,
    rating: f.rating,
    origin: +(f.origin_cents / 100).toFixed(2),
    price: +(f.price_cents / 100).toFixed(2),
    priceCents: f.price_cents,
    off: +(100 - (f.price_cents / f.origin_cents) * 100).toFixed(0),
    stock: f.stock,
    sold: f.sold,
    remain: Math.max(0, f.stock - f.sold),
    progress: f.stock ? Math.min(100, Math.round((f.sold / f.stock) * 100)) : 100,
    limitPerUser: f.limit_per_user,
    startAt: toIso(f.start_at),
    endAt: toIso(f.end_at),
    // 用服务端时间做倒计时基准，避免客户端时钟不准
    serverNow: Date.now(),
  }));
}

/** 该商品当前是否在秒杀中（下单时校验价格来源） */
export function activeFlashFor(productId) {
  return get(
    `SELECT * FROM flash_sales
      WHERE product_id = ? AND status = 'active'
        AND start_at <= datetime('now') AND end_at > datetime('now')
        AND sold < stock
      ORDER BY price_cents LIMIT 1`,
    [+productId],
  ) || null;
}

export function consumeFlashStock(flashId, qty = 1) {
  const r = run(
    "UPDATE flash_sales SET sold = sold + ? WHERE id = ? AND sold + ? <= stock AND status = 'active'",
    [qty, flashId, qty],
  );
  if (!r.changes) throw new AppError('FLASH_SOLD_OUT', '秒杀名额已抢完', 400);
}

export function restoreFlashStock(flashId, qty = 1) {
  if (!flashId) return;
  run('UPDATE flash_sales SET sold = MAX(0, sold - ?) WHERE id = ?', [qty, flashId]);
}

// ── 拼团 ──────────────────────────────────────────────────

export function listGroupBuys() {
  const rows = all(
    `SELECT g.*, p.title AS product_title, p.image, p.price_cents AS origin_cents, p.rating, p.category
       FROM group_buys g JOIN products p ON p.id = g.product_id
      WHERE g.status = 'active' ORDER BY g.id`,
  );
  return rows.map((g) => ({
    id: g.id,
    productId: g.product_id,
    productTitle: g.product_title,
    image: g.image,
    origin: +(g.origin_cents / 100).toFixed(2),
    price: +(g.price_cents / 100).toFixed(2),
    priceCents: g.price_cents,
    save: +((g.origin_cents - g.price_cents) / 100).toFixed(2),
    required: g.required,
    expireHours: g.expire_hours,
    rating: g.rating,
    category: g.category,
    teams: openTeams(g.id).length,
  }));
}

export function groupDetail(groupBuyId, userId = null) {
  const g = get(
    `SELECT g.*, p.title AS product_title, p.image, p.price_cents AS origin_cents, p.rating, p.description, p.stock
       FROM group_buys g JOIN products p ON p.id = g.product_id WHERE g.id = ?`,
    [+groupBuyId],
  );
  if (!g) throw new AppError('NOT_FOUND', '拼团活动不存在', 404);
  return {
    id: g.id,
    productId: g.product_id,
    productTitle: g.product_title,
    description: g.description,
    image: g.image,
    origin: +(g.origin_cents / 100).toFixed(2),
    price: +(g.price_cents / 100).toFixed(2),
    priceCents: g.price_cents,
    save: +((g.origin_cents - g.price_cents) / 100).toFixed(2),
    required: g.required,
    expireHours: g.expire_hours,
    stock: g.stock,
    teams: openTeams(g.id).map((t) => decorateTeam(t, g.required, userId)),
  };
}

function openTeams(groupBuyId) {
  return all(
    `SELECT t.*, u.name AS leader_name,
            (SELECT COUNT(*) FROM group_members m WHERE m.team_id = t.id) AS joined
       FROM group_teams t JOIN users u ON u.id = t.leader_id
      WHERE t.group_buy_id = ? AND t.status = 'forming' AND t.expire_at > datetime('now')
      ORDER BY t.expire_at LIMIT 20`,
    [+groupBuyId],
  );
}

function decorateTeam(t, required, userId) {
  const members = all(
    `SELECT m.user_id, m.is_leader, u.name FROM group_members m JOIN users u ON u.id = m.user_id
      WHERE m.team_id = ? ORDER BY m.is_leader DESC, m.id`,
    [t.id],
  );
  return {
    id: t.id,
    leaderId: t.leader_id,
    leaderName: maskName(t.leader_name),
    members: members.map((m) => ({ name: maskName(m.name), isLeader: !!m.is_leader })),
    joined: t.joined,
    required,
    need: Math.max(0, required - t.joined),
    expireAt: toIso(t.expire_at),
    joinedByMe: !!userId && members.some((m) => m.user_id === userId),
  };
}

function maskName(name = '') {
  const s = String(name);
  if (s.length <= 1) return s || '匿名';
  return s[0] + '*'.repeat(Math.max(1, s.length - 1));
}

/** 扣减拼团库存（下单时调用） */
export function assertGroupStock(productId, qty) {
  const p = get('SELECT stock, status FROM products WHERE id = ?', [+productId]);
  if (!p) throw new AppError('NOT_FOUND', '商品不存在', 404);
  if (p.status !== 'active') throw new AppError('OFF_SHELF', '商品已下架', 400);
  if (p.stock < qty) throw new AppError('OUT_OF_STOCK', '商品库存不足', 400);
}

export function teamById(teamId) {
  return get('SELECT * FROM group_teams WHERE id = ?', [+teamId]);
}

export function createTeam(groupBuyId, leaderId) {
  const g = get('SELECT * FROM group_buys WHERE id = ?', [+groupBuyId]);
  if (!g) throw new AppError('NOT_FOUND', '拼团活动不存在', 404);
  const { lastId } = run(
    `INSERT INTO group_teams (group_buy_id, leader_id, status, expire_at)
     VALUES (?,?, 'forming', datetime('now', ?))`,
    [g.id, leaderId, `+${g.expire_hours} hours`],
  );
  return lastId;
}

export function addMember(teamId, userId, orderId, isLeader = false) {
  const exist = get('SELECT * FROM group_members WHERE team_id = ? AND user_id = ?', [teamId, userId]);
  if (exist) return exist;
  const { lastId } = run(
    'INSERT INTO group_members (team_id, user_id, order_id, is_leader) VALUES (?,?,?,?)',
    [teamId, userId, orderId, isLeader ? 1 : 0],
  );
  return { id: lastId };
}

/** 检查是否已成团，成团则把成员订单置为已支付（并同步消费、返积分、会员升级） */
export function checkTeamSuccess(teamId) {
  const t = teamById(teamId);
  if (!t || t.status !== 'forming') return t;
  const g = get('SELECT * FROM group_buys WHERE id = ?', [t.group_buy_id]);
  const joined = get('SELECT COUNT(*) c FROM group_members WHERE team_id = ?', [teamId]).c;
  if (joined < g.required) return t;

  run("UPDATE group_teams SET status = 'success' WHERE id = ?", [teamId]);
  // 只捞"本次真正被置为已支付"的订单：用户若已手动付款，不能重复计入消费与返积分
  const toPay = all(
    `SELECT id, user_id, total_cents FROM orders
      WHERE id IN (SELECT order_id FROM group_members WHERE team_id = ? AND order_id IS NOT NULL)
        AND status = 'pending_payment'`,
    [teamId],
  );
  run(`UPDATE orders SET status = 'paid', paid_at = datetime('now')
        WHERE id IN (SELECT order_id FROM group_members WHERE team_id = ? AND order_id IS NOT NULL)
          AND status = 'pending_payment'`, [teamId]);
  for (const o of toPay) onOrderPaid(o.user_id, o.id, o.total_cents);
  return teamById(teamId);
}

/** 定时任务：超时未成团的团置为失败，成员订单关闭并退款 */
export function settleTeams() {
  const expired = all(
    `SELECT * FROM group_teams WHERE status = 'forming' AND expire_at <= datetime('now')`,
  );
  let failed = 0;
  let success = 0;
  for (const t of expired) {
    const g = get('SELECT * FROM group_buys WHERE id = ?', [t.group_buy_id]);
    const joined = get('SELECT COUNT(*) c FROM group_members WHERE team_id = ?', [t.id]).c;
    if (joined >= (g?.required || 2)) {
      checkTeamSuccess(t.id);
      success += 1;
      continue;
    }
    tx(() => {
      run("UPDATE group_teams SET status = 'failed' WHERE id = ?", [t.id]);
      const orders = all('SELECT * FROM group_members WHERE team_id = ? AND order_id IS NOT NULL', [t.id]);
      for (const m of orders) {
        const o = get('SELECT * FROM orders WHERE id = ?', [m.order_id]);
        if (!o) continue;
        // 已支付/已发货的团员：团失败要自动退款，不能把人的钱和订单一直挂着
        const paidAlready = ['paid', 'shipped', 'completed'].includes(o.status);
        if (!paidAlready && o.status !== 'pending_payment') continue;

        // 按行回补商品与规格库存（不能把订单 ID 当商品 ID）
        const items = all('SELECT product_id, sku_id, qty FROM order_items WHERE order_id = ?', [o.id]);
        for (const it of items) {
          run('UPDATE products SET stock = stock + ?, sales = MAX(0, sales - ?) WHERE id = ?',
            [it.qty, it.qty, it.product_id]);
          if (it.sku_id) run('UPDATE product_skus SET stock = stock + ? WHERE id = ?', [it.qty, it.sku_id]);
        }
        // 抵扣过的券与积分也要退回
        if (o.points_used > 0) {
          run('UPDATE users SET points = points + ? WHERE id = ?', [o.points_used, o.user_id]);
          run("INSERT INTO points_log (user_id, delta, reason, ref_id) VALUES (?,?,'拼团失败退回积分',?)",
            [o.user_id, o.points_used, o.id]);
        }
        run("UPDATE user_coupons SET status = 'unused', order_id = NULL WHERE order_id = ? AND user_id = ?",
          [o.id, o.user_id]);
        if (paidAlready) {
          // 已付款的走"已退款"，并留一条退款记录，用户端能看到进度
          run("UPDATE orders SET status = 'refunded', cancel_reason = '拼团超时未成团，已自动退款' WHERE id = ?", [o.id]);
          run(`INSERT INTO refunds (order_id, user_id, reason, status, amount_cents, decided_at)
               VALUES (?,?,?, 'approved', ?, datetime('now'))`,
            [o.id, o.user_id, '拼团超时未成团，系统自动退款', o.total_cents]);
          const back = Math.floor(o.total_cents / 100);
          run('UPDATE users SET total_spent_cents = MAX(0, total_spent_cents - ?) WHERE id = ?',
            [o.total_cents, o.user_id]);
          if (back > 0) {
            run('UPDATE users SET points = MAX(0, points - ?) WHERE id = ?', [back, o.user_id]);
            run("INSERT INTO points_log (user_id, delta, reason, ref_id) VALUES (?,?,'拼团失败扣回返积分',?)",
              [o.user_id, -back, o.id]);
          }
          const spent = get('SELECT total_spent_cents FROM users WHERE id = ?', [o.user_id]);
          run('UPDATE users SET level = ? WHERE id = ?',
            [levelForSpent(spent?.total_spent_cents || 0), o.user_id]);
        } else {
          run("UPDATE orders SET status = 'cancelled', cancel_reason = '拼团超时未成团，已自动关单', cancelled_at = datetime('now') WHERE id = ?", [o.id]);
        }
      }
    });
    failed += 1;
  }
  return { failed, success, checked: expired.length };
}
