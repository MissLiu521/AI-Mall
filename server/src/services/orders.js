import { all, get, run, tx } from '../db/index.js';
import { AppError } from './users.js';
import { toIso, daysSince } from '../lib/time.js';
import { quote, memberOf, levelForSpent, usableCoupons } from './pricing.js';
import { resolveUserCoupon, markCouponUsed, restoreCoupon, consumeFlashStock, restoreFlashStock, createTeam, addMember, checkTeamSuccess, teamById } from './promotions.js';
import { onOrderPaid, addPoints } from './engagement.js';
import * as wallet from './wallet.js';
import { clawbackByOrder } from './reviews.js';

export const ORDER_STATUS = {
  pending_payment: { label: '待付款', tone: 'warning' },
  paid: { label: '待发货', tone: 'primary' },
  shipped: { label: '已发货', tone: 'primary' },
  completed: { label: '已完成', tone: 'success' },
  cancelled: { label: '已取消', tone: 'muted' },
  refunding: { label: '退款中', tone: 'warning' },
  refunded: { label: '已退款', tone: 'danger' },
};

/** 未支付订单保留时长：超时自动关单并回补库存 */
export const PAYMENT_TIMEOUT_MIN = 15;
/** 发货后自动确认收货天数 */
export const AUTO_COMPLETE_DAYS = 7;

const orderNo = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `AIM${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${rand}`;
};

/** 物流轨迹：按订单生成节点，未发货时为空 */
export function shipmentTimeline(order) {
  const rows = all('SELECT * FROM shipment_events WHERE order_id = ? ORDER BY id', [order.id]);
  const nodes = rows.map((e) => ({
    status: e.status,
    description: e.description,
    location: e.location,
    at: toIso(e.created_at),
  }));
  const planned = [
    { status: '已揽收', description: '商家已发货，快递已揽收' },
    { status: '运输中', description: '快件运输中' },
    { status: '派送中', description: '快递员正在派送' },
    { status: '已签收', description: '快件已签收' },
  ];
  return {
    carrier: order.carrier || '',
    trackingNo: order.tracking_no || '',
    events: nodes,
    // 给出"下一步会发生什么"，减少等待焦虑
    next: order.status === 'shipped'
      ? (nodes.some((n) => n.status === '派送中') ? '今天派送，请保持电话畅通' : '预计 1–2 天内到达派送点')
      : order.status === 'completed' ? '已签收，如有问题可在 15 天内申请售后' : '商家发货后可查看轨迹',
    progress: nodes.length ? Math.min(100, Math.round((nodes.length / planned.length) * 100)) : 0,
  };
}

const specText = (sku) => {
  if (!sku) return '';
  try {
    const o = JSON.parse(sku.spec_json || '{}');
    return Object.entries(o).map(([k, v]) => `${k}：${v}`).join(' / ');
  } catch { return ''; }
};

function hydrate(o) {
  if (!o) return null;
  const items = all(
    `SELECT oi.*, p.image AS p_image, p.category AS p_category
       FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = ?`, [o.id],
  ).map((i) => ({
    id: i.id,
    productId: i.product_id,
    skuId: i.sku_id || null,
    specText: i.spec_text || '',
    title: i.title,
    price: +(i.price_cents / 100).toFixed(2),
    qty: i.qty,
    image: i.image || i.p_image || '',
    category: i.p_category || '',
    // 已评价标记，决定详情页显示"去评价"还是"已评价"
    reviewed: !!get('SELECT id FROM reviews WHERE order_item_id = ?', [i.id]),
  }));
  // 退款单：pending/approved 随状态保留；rejected 后订单会回到原状态，
  // 但用户仍需要看到"被驳回"的结果，否则会误以为没提交过
  const funding = get(
    'SELECT * FROM refunds WHERE order_id = ? ORDER BY id DESC LIMIT 1',
    [o.id],
  );
  const showRefund = funding && (
    ['refunding', 'refunded'].includes(o.status) || funding.status === 'rejected'
  );
  const shop = o.shop_id ? get('SELECT name, is_self FROM shops WHERE id = ?', [o.shop_id]) : null;
  const level = memberOf(get('SELECT level FROM users WHERE id = ?', [o.user_id]));
  const coupon = o.coupon_id ? get('SELECT title FROM coupons WHERE id = ?', [o.coupon_id]) : null;

  return {
    id: o.id,
    orderNo: o.order_no,
    userId: o.user_id,
    status: o.status,
    statusLabel: ORDER_STATUS[o.status]?.label || o.status,
    statusTone: ORDER_STATUS[o.status]?.tone || 'muted',
    subtotal: +(o.subtotal_cents / 100).toFixed(2),
    shipping: +((o.shipping_cents || 0) / 100).toFixed(2),
    discount: +(o.discount_cents / 100).toFixed(2),
    total: +(o.total_cents / 100).toFixed(2),
    // 优惠明细：每一分钱都能对上。会员折扣必须由总额反推，
    // 否则会把券/满减/积分一起算进"会员折扣"，用户看到的明细是错的
    pricing: {
      memberLabel: level.label,
      memberDiscount: +(((
        o.subtotal_cents
        - (o.coupon_discount_cents || 0)
        - (o.fullcut_cents || 0)
        - (o.points_discount_cents || 0)
        - (o.balance_discount_cents || 0)
        + (o.shipping_cents || 0)
        - o.total_cents
      ) / 100).toFixed(2)),
      couponTitle: coupon?.title || '',
      couponDiscount: +((o.coupon_discount_cents || 0) / 100).toFixed(2),
      fullCut: +((o.fullcut_cents || 0) / 100).toFixed(2),
      pointsUsed: o.points_used || 0,
      pointsDiscount: +((o.points_discount_cents || 0) / 100).toFixed(2),
      balanceDiscount: +((o.balance_discount_cents || 0) / 100).toFixed(2),
    },
    address: o.address,
    remark: o.remark,
    aiAssisted: !!o.ai_assisted,
    shopName: shop?.name || '',
    isSelf: !!shop?.is_self,
    groupTeamId: o.group_team_id || null,
    carrier: o.carrier || '',
    trackingNo: o.tracking_no || '',
    cancelReason: o.cancel_reason || '',
    reviewed: !!o.reviewed,
    items,
    shipment: o.tracking_no || o.status === 'shipped' || o.status === 'completed'
      ? shipmentTimeline(o) : null,
    // 退款进度时间轴：让"提交后没动静"变成"现在卡在哪、谁在处理"
    refund: showRefund ? refundTimeline(funding) : null,
    // 退款被驳回时，用原状态判断能不能继续申请，而不是一律当成待发货
    refundedFrom: o.status_before_refund || null,
    createdAt: toIso(o.created_at),
    paidAt: toIso(o.paid_at),
    shippedAt: toIso(o.shipped_at),
    completedAt: toIso(o.completed_at),
    cancelledAt: toIso(o.cancelled_at),
  };
}

/** 解析一行商品，返回带真实单价的 line；SKU / 秒杀 / 拼团价都在这里统一 */
function resolveLine({ productId, skuId = null, qty = 1, flashSaleId = null, groupPriceCents = null }) {
  const p = get('SELECT * FROM products WHERE id = ?', [+productId]);
  if (!p) throw new AppError('NOT_FOUND', `商品 ${productId} 不存在`, 404);
  if (p.status !== 'active') throw new AppError('OFF_SHELF', `${p.title} 已下架`);

  const skus = all("SELECT * FROM product_skus WHERE product_id = ? AND status = 'active'", [p.id]);
  let sku = null;
  if (skus.length) {
    sku = skuId ? get('SELECT * FROM product_skus WHERE id = ? AND product_id = ?', [+skuId, p.id]) : null;
    if (skuId && !sku) throw new AppError('SKU_NOT_FOUND', '所选规格不存在', 400);
    // 未指定规格时落到默认规格（第一个有货的），前端也会默认选中第一个，
    // 这样旧调用方和活动下单都不会因为"没传 skuId"而失败
    if (!sku) sku = skus.find((s) => s.stock > 0) || skus[0];
    if (sku.stock < qty) throw new AppError('OUT_OF_STOCK', `${p.title}（${specText(sku)}）库存不足`);
  } else if (p.stock < qty) {
    throw new AppError('OUT_OF_STOCK', `${p.title} 库存不足`);
  }

  let priceCents = sku ? sku.price_cents : p.price_cents;
  let campaign = null;

  // 秒杀价只认"显式带来的场次"：用户在详情页/秒杀页点「抢购」时前端会带 flashSaleId。
  // 不能自动套用进行中的秒杀价，否则普通购买会被秒杀限购规则误伤
  // （典型场景：秒杀限购 1 件，用户想按原价买 2 件却被拒）。
  const flash = flashSaleId
    ? get("SELECT * FROM flash_sales WHERE id = ? AND product_id = ? AND status = 'active' AND end_at > datetime('now')",
      [+flashSaleId, p.id])
    : null;
  if (flashSaleId && !flash) throw new AppError('FLASH_ENDED', '秒杀活动已结束', 400);
  if (flash) {
    priceCents = flash.price_cents;
    campaign = { type: 'flash', id: flash.id, title: flash.title || '限时秒杀' };
  }
  if (groupPriceCents != null) {
    priceCents = groupPriceCents;
    campaign = { type: 'group', title: '拼团价' };
  }

  return {
    product: p,
    sku,
    qty,
    priceCents,
    campaign,
    flash,
    line: {
      productId: p.id,
      skuId: sku?.id || null,
      title: p.title,
      specText: specText(sku),
      image: sku?.image || p.image,
      priceCents,
      qty,
      category: p.category,
      shopId: p.shop_id,
      campaign,
    },
  };
}

/** 结算页预览：不写库，只算钱 */
export function previewOrder(userId, { items = [], productId, skuId, qty = 1, userCouponId = null, usePoints = 0, useBalance = 0, flashSaleId = null, groupBuyId = null }) {
  const user = get('SELECT id, points, balance_cents, level FROM users WHERE id = ?', [userId]);
  if (!user) throw new AppError('NOT_FOUND', '用户不存在', 404);

  let rawLines = [];
  if (Array.isArray(items) && items.length) {
    rawLines = items.map((i) => ({ productId: i.productId, skuId: i.skuId, qty: Math.max(1, +i.qty || 1) }));
  } else if (productId) {
    rawLines = [{ productId, skuId, qty: Math.max(1, +qty || 1) }];
  } else {
    rawLines = all('SELECT product_id AS productId, sku_id AS skuId, qty FROM cart_items WHERE user_id = ? AND selected = 1', [userId]);
    if (!rawLines.length) throw new AppError('EMPTY_CART', '购物车为空');
  }

  // 拼团价必须由活动决定，不能由前端传价格，否则等于把定价权交给浏览器
  let groupPriceCents = null;
  if (groupBuyId) {
    const g = get("SELECT * FROM group_buys WHERE id = ? AND status = 'active'", [+groupBuyId]);
    if (!g) throw new AppError('NOT_FOUND', '拼团活动不存在或已结束', 404);
    groupPriceCents = g.price_cents;
  }

  const resolved = rawLines.map((r) => resolveLine({ ...r, flashSaleId, groupPriceCents }));
  const lines = resolved.map((r) => r.line);
  const coupon = userCouponId ? resolveUserCoupon(userId, userCouponId) : null;
  const q = quote({ lines, user, coupon, usePoints, useBalance });

  // 秒杀 / 拼团商品要带上活动信息，结算页才能展示"已享活动价"而不是莫名便宜
  const campaign = resolved.find((r) => r.campaign)?.campaign || null;

  return {
    ...q,
    items: lines,
    campaign,
    coupons: usableCoupons(userId, q.subtotalCents, lines, q.memberDiscountCents),
    pointsBalance: user.points,
    balanceCents: user.balance_cents || 0,
  };
}

/** 下单：从购物车或指定商品生成订单，事务 + 幂等键 + 库存扣减 + 优惠核销 */
export function createOrder(userId, {
  address, remark = '', productId, skuId = null, items = null, qty = 1, idemKey = null,
  aiAssisted = false, userCouponId = null, usePoints = 0, useBalance = 0, flashSaleId = null,
  groupPriceCents = null, groupBuyId = null, groupTeamId = null,
}) {
  if (idemKey) {
    const exist = get('SELECT * FROM orders WHERE user_id = ? AND idem_key = ?', [userId, idemKey]);
    if (exist) return hydrate(exist);
  }
  if (!address || String(address).trim().length < 5) throw new AppError('INVALID_ADDRESS', '请填写完整收货地址');

  const user = get('SELECT id, points, balance_cents, level FROM users WHERE id = ?', [userId]);
  if (!user) throw new AppError('NOT_FOUND', '用户不存在', 404);

  return tx(() => {
    let rawLines = [];
    if (Array.isArray(items) && items.length) {
      rawLines = items.map((i) => ({ productId: i.productId, skuId: i.skuId, qty: Math.max(1, +i.qty || 1) }));
    } else if (productId) {
      rawLines = [{ productId, skuId, qty: Math.max(1, +qty || 1) }];
    } else {
      const rows = all('SELECT product_id AS productId, sku_id AS skuId, qty FROM cart_items WHERE user_id = ? AND selected = 1', [userId]);
      if (!rows.length) throw new AppError('EMPTY_CART', '购物车为空');
      rawLines = rows;
    }

    const resolved = rawLines.map((r) => resolveLine({ ...r, flashSaleId, groupPriceCents }));
    const lines = resolved.map((r) => r.line);

    const coupon = userCouponId ? resolveUserCoupon(userId, userCouponId) : null;
    const q = quote({ lines, user, coupon, usePoints, useBalance });

    const shopId = lines[0]?.shopId || null;
    const no = orderNo();
    const { lastId } = run(
      `INSERT INTO orders (order_no, user_id, status, subtotal_cents, discount_cents, shipping_cents, total_cents,
                           address, remark, ai_assisted, idem_key, shop_id,
                           coupon_id, coupon_discount_cents, fullcut_cents, points_used, points_discount_cents,
                           balance_used, balance_discount_cents,
                           group_team_id, flash_sale_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [no, userId, 'pending_payment', q.subtotalCents,
        q.memberDiscountCents + q.couponDiscountCents + q.fullCutCents + q.pointsDiscountCents + q.balanceDiscountCents,
        q.shippingCents, q.totalCents, String(address).trim(), remark, aiAssisted ? 1 : 0, idemKey, shopId,
        coupon?.id || null, q.couponDiscountCents, q.fullCutCents, q.pointsUsed, q.pointsDiscountCents,
        q.balanceUsed, q.balanceDiscountCents,
        groupTeamId, flashSaleId ? resolved[0].flash?.id || flashSaleId : null],
    );

    for (const r of resolved) {
      // 秒杀限购：按"同一场次历史有效下单量 + 本次数量"校验，取消/退款后可重新购买
      if (r.flash && r.flash.limit_per_user > 0) {
        const bought = get(
          `SELECT COALESCE(SUM(oi.qty), 0) q FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
            WHERE o.user_id = ? AND o.flash_sale_id = ?
              AND o.status NOT IN ('cancelled', 'refunded')`,
          [userId, r.flash.id],
        ).q;
        if (bought + r.qty > r.flash.limit_per_user) {
          throw new AppError('FLASH_LIMIT',
            `秒杀每人限购 ${r.flash.limit_per_user} 件，你已购买 ${bought} 件`, 400);
        }
      }
      run(`INSERT INTO order_items (order_id, product_id, title, price_cents, qty, sku_id, spec_text, image)
           VALUES (?,?,?,?,?,?,?,?)`,
        [lastId, r.product.id, r.product.title, r.priceCents, r.qty, r.sku?.id || null, r.line.specText, r.line.image]);
      // 扣减总库存 + SKU 库存
      run('UPDATE products SET stock = stock - ?, sales = sales + ? WHERE id = ?', [r.qty, r.qty, r.product.id]);
      if (r.sku) {
        const ok = run('UPDATE product_skus SET stock = stock - ? WHERE id = ? AND stock >= ?', [r.qty, r.sku.id, r.qty]);
        if (!ok.changes) throw new AppError('OUT_OF_STOCK', `${r.product.title} 规格库存不足`);
      }
      if (r.flash) consumeFlashStock(r.flash.id, r.qty);
    }

    // 核销券与积分（在事务内，失败会整体回滚）
    if (coupon) markCouponUsed(userId, coupon.user_coupon_id, lastId);
    if (q.pointsUsed > 0) {
      run('UPDATE users SET points = MAX(0, points - ?) WHERE id = ?', [q.pointsUsed, userId]);
      run("INSERT INTO points_log (user_id, delta, reason, ref_id) VALUES (?,?,?,?)",
        [userId, -q.pointsUsed, '下单积分抵扣', lastId]);
    }
    // 余额抵扣：与积分同样在事务内扣减，订单失败会自动回滚
    if (q.balanceUsed > 0) {
      wallet.debit(userId, q.balanceUsed, '下单余额抵扣', { refType: 'order', refId: lastId });
    }

    if (!productId && !(Array.isArray(items) && items.length)) {
      run('DELETE FROM cart_items WHERE user_id = ?', [userId]);
    }
    return hydrate(get('SELECT * FROM orders WHERE id = ?', [lastId]));
  });
}

/** 模拟支付：本地演示保留，但必须由用户显式触发，下单不再自动置为已支付 */
export function payOrder(userId, orderId) {
  return tx(() => {
    const o = get('SELECT * FROM orders WHERE id = ? AND user_id = ?', [+orderId, userId]);
    if (!o) throw new AppError('NOT_FOUND', '订单不存在', 404);
    if (o.status !== 'pending_payment') throw new AppError('BAD_STATUS', '订单状态不允许支付');
    run("UPDATE orders SET status = 'paid', paid_at = datetime('now') WHERE id = ?", [o.id]);
    // 支付成功才计入消费、返积分、升级会员——取消/未支付不产生资产
    onOrderPaid(userId, o.id, o.total_cents);
    return hydrate(get('SELECT * FROM orders WHERE id = ?', [o.id]));
  });
}

/** 回补库存与销量：取消/关单/退款共用；同时归还秒杀配额、优惠券与积分 */
function restoreStock(orderId, userId = null) {
  const o = get('SELECT * FROM orders WHERE id = ?', [orderId]);
  let totalQty = 0;
  for (const it of all('SELECT * FROM order_items WHERE order_id = ?', [orderId])) {
    run('UPDATE products SET stock = stock + ?, sales = MAX(0, sales - ?) WHERE id = ?',
      [it.qty, it.qty, it.product_id]);
    if (it.sku_id) run('UPDATE product_skus SET stock = stock + ? WHERE id = ?', [it.qty, it.sku_id]);
    totalQty += it.qty;
  }
  if (o?.flash_sale_id) restoreFlashStock(o.flash_sale_id, totalQty);
  if (userId) restoreCoupon(userId, orderId);
  // 积分退回：避免"取消订单积分却没了"
  if (o && o.points_used > 0) {
    run('UPDATE users SET points = points + ? WHERE id = ?', [o.points_used, o.user_id]);
    run("INSERT INTO points_log (user_id, delta, reason, ref_id) VALUES (?,?,'订单关闭退回积分',?)",
      [o.user_id, o.points_used, orderId]);
    run('UPDATE orders SET points_used = 0 WHERE id = ?', [orderId]);
  }
  // 余额退回：balance_used 置 0 作为"已退"标记，重复关单不会重复退款
  if (o && o.balance_used > 0) {
    wallet.credit(o.user_id, o.balance_used, '订单关闭退回余额', { refType: 'order', refId: orderId });
    run('UPDATE orders SET balance_used = 0 WHERE id = ?', [orderId]);
  }
  // 已支付过的订单（取消/退款）要冲回累计消费与消费返积分，
  // 否则「下单 → 支付 → 取消」可以无限刷积分和会员等级
  if (o && o.paid_at) {
    run('UPDATE users SET total_spent_cents = MAX(0, total_spent_cents - ?) WHERE id = ?',
      [o.total_cents, o.user_id]);
    const earnedBack = Math.floor(o.total_cents / 100);
    if (earnedBack > 0) addPoints(o.user_id, -earnedBack, '订单取消/退款扣回消费返积分', orderId);
    // 退款等于交易没发生，等级要能回落；否则可以靠「下单-支付-退款」永久刷到金卡
    const spent = get('SELECT total_spent_cents FROM users WHERE id = ?', [o.user_id]);
    run('UPDATE users SET level = ? WHERE id = ?',
      [levelForSpent(spent?.total_spent_cents || 0), o.user_id]);
  }
}

export function cancelOrder(userId, orderId, reason = '') {
  return tx(() => {
    const o = get('SELECT * FROM orders WHERE id = ? AND user_id = ?', [+orderId, userId]);
    if (!o) throw new AppError('NOT_FOUND', '订单不存在', 404);
    if (!['pending_payment', 'paid'].includes(o.status)) {
      throw new AppError('BAD_STATUS', o.status === 'shipped' ? '已发货订单请走退款流程' : '当前状态不可取消');
    }
    run("UPDATE orders SET status = 'cancelled', cancelled_at = datetime('now'), cancel_reason = ? WHERE id = ?",
      [String(reason || (o.status === 'paid' ? '用户取消，模拟支付原路退回' : '用户取消')).slice(0, 200), o.id]);
    restoreStock(o.id, userId);
    return hydrate(get('SELECT * FROM orders WHERE id = ?', [o.id]));
  });
}

/** 用户确认收货：shipped → completed */
export function confirmReceipt(userId, orderId) {
  const o = get('SELECT * FROM orders WHERE id = ? AND user_id = ?', [+orderId, userId]);
  if (!o) throw new AppError('NOT_FOUND', '订单不存在', 404);
  if (o.status !== 'shipped') throw new AppError('BAD_STATUS', '仅已发货订单可确认收货');
  run("UPDATE orders SET status = 'completed', completed_at = datetime('now') WHERE id = ?", [o.id]);
  return hydrate(get('SELECT * FROM orders WHERE id = ?', [o.id]));
}

/** 定时任务：超时未支付自动关单（回补库存），发货超期自动确认收货 */
export function sweepOrders() {
  let closed = 0;
  let completed = 0;
  const stale = all(
    `SELECT id FROM orders WHERE status = 'pending_payment'
       AND created_at <= datetime('now', ?) LIMIT 100`,
    [`-${PAYMENT_TIMEOUT_MIN} minutes`],
  );
  for (const { id } of stale) {
    try {
      tx(() => {
        const o = get('SELECT * FROM orders WHERE id = ?', [id]);
        if (!o || o.status !== 'pending_payment') return;
        run("UPDATE orders SET status = 'cancelled', cancelled_at = datetime('now'), cancel_reason = ? WHERE id = ?",
          [`超时 ${PAYMENT_TIMEOUT_MIN} 分钟未支付，系统自动关闭`, id]);
        restoreStock(id, o.user_id);
        closed += 1;
      });
    } catch (e) {
      console.error('[orders] 自动关单失败', id, e.message);
    }
  }

  const shipped = all(
    `SELECT id FROM orders WHERE status = 'shipped'
       AND shipped_at IS NOT NULL AND shipped_at <= datetime('now', ?) LIMIT 100`,
    [`-${AUTO_COMPLETE_DAYS} days`],
  );
  for (const { id } of shipped) {
    run("UPDATE orders SET status = 'completed', completed_at = datetime('now') WHERE id = ?", [id]);
    completed += 1;
  }
  return { closed, completed };
}

export function myOrders(userId, { page = 1, pageSize = 50 } = {}) {
  return all('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?',
    [userId, pageSize, (page - 1) * pageSize]).map(hydrate);
}

export function getOrderForUser(userId, orderId) {
  const o = get('SELECT * FROM orders WHERE id = ? AND user_id = ?', [+orderId, userId]);
  if (!o) throw new AppError('NOT_FOUND', '订单不存在', 404);
  return hydrate(o);
}

export function findOrderByNo(userId, no) {
  const o = get('SELECT * FROM orders WHERE order_no = ? AND user_id = ?', [no, userId]);
  return o ? hydrate(o) : null;
}

export function allOrders({ status = '', q = '', page = 1, pageSize = 50 } = {}) {
  const where = [];
  const params = [];
  if (status) { where.push('status = ?'); params.push(status); }
  // 订单号或收货信息（收货人/电话/地址）都能搜
  if (q) {
    where.push('(order_no LIKE ? OR address LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = get(`SELECT COUNT(*) c FROM orders ${clause}`, params).c;
  const items = all(`SELECT * FROM orders ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]).map(hydrate);
  return { items, total, page, pageSize };
}

/** 发货：写入运单并生成物流节点，让"已发货"不再是死状态 */
export function shipOrder(orderId, { carrier = '', trackingNo = '' } = {}) {
  return tx(() => {
    const o = get('SELECT * FROM orders WHERE id = ?', [+orderId]);
    if (!o) throw new AppError('NOT_FOUND', '订单不存在', 404);
    if (o.status !== 'paid') throw new AppError('BAD_STATUS', '仅待发货订单可发货');
    const c = String(carrier || '顺丰速运').slice(0, 40);
    run("UPDATE orders SET status = 'shipped', shipped_at = datetime('now'), carrier = ?, tracking_no = ? WHERE id = ?",
      [c, String(trackingNo || '').slice(0, 60), o.id]);
    run(`INSERT INTO shipment_events (order_id, status, description, location)
         VALUES (?, '已揽收', ?, '商家仓库')`, [o.id, `${c} 已揽收，运单号 ${trackingNo || '（未填写）'}`]);
    return hydrate(get('SELECT * FROM orders WHERE id = ?', [o.id]));
  });
}

/** 推进物流节点：演示用，模拟快递在途 */
export function advanceShipment(orderId) {
  const o = get('SELECT * FROM orders WHERE id = ?', [+orderId]);
  if (!o) throw new AppError('NOT_FOUND', '订单不存在', 404);
  if (!['shipped', 'completed'].includes(o.status)) throw new AppError('BAD_STATUS', '订单尚未发货');
  const seq = [
    ['运输中', '快件已到达转运中心，正在分拣'],
    ['派送中', '快递员正在派送，请保持电话畅通'],
    ['已签收', '快件已签收，感谢使用'],
  ];
  const done = all('SELECT status FROM shipment_events WHERE order_id = ?', [o.id]).map((x) => x.status);
  const next = seq.find(([s]) => !done.includes(s));
  if (!next) return hydrate(o);
  run('INSERT INTO shipment_events (order_id, status, description, location) VALUES (?,?,?,?)',
    [o.id, next[0], next[1], next[0] === '派送中' ? '收货地址所在片区' : '区域转运中心']);
  if (next[0] === '已签收') {
    run("UPDATE orders SET status = 'completed', completed_at = datetime('now') WHERE id = ?", [o.id]);
  }
  return hydrate(get('SELECT * FROM orders WHERE id = ?', [o.id]));
}

/** 退款申请资格校验（供 AI 客服与接口共用） */
export function checkReturnEligibility(userId, orderId) {
  const o = get('SELECT * FROM orders WHERE id = ? AND user_id = ?', [+orderId, userId]);
  if (!o) return { eligible: false, reason: '没有找到这笔订单' };
  if (['pending_payment'].includes(o.status)) return { eligible: false, reason: '订单还未支付，无需退款，可直接取消' };
  if (['refunding', 'refunded'].includes(o.status)) return { eligible: false, reason: '该订单已在退款流程中' };
  if (o.status === 'cancelled') return { eligible: false, reason: '订单已取消' };

  // 以签收（完成）时间为起点；未完成时用发货时间兜底
  const start = o.completed_at || o.shipped_at;
  if (start) {
    const days = daysSince(start);
    if (days > 15) return { eligible: false, reason: `已签收 ${days} 天，超出 15 天售后时效，建议联系人工客服协商`, days };
    return { eligible: true, reason: `签收 ${days} 天，在 15 天售后时效内`, days, amount: o.total_cents, remainDays: 15 - days };
  }
  return { eligible: true, reason: '尚未发货，可全额退款', amount: o.total_cents };
}

export function createRefund(userId, orderId, reason) {
  const check = checkReturnEligibility(userId, orderId);
  if (!check.eligible) throw new AppError('NOT_ELIGIBLE', check.reason);
  return tx(() => {
    const o = get('SELECT * FROM orders WHERE id = ? AND user_id = ?', [+orderId, userId]);
    if (!o) throw new AppError('NOT_FOUND', '订单不存在', 404);
    const exist = get("SELECT id FROM refunds WHERE order_id = ? AND status = 'pending'", [o.id]);
    if (exist) throw new AppError('DUPLICATE', '该订单已有待处理的退款申请');
    const { lastId } = run(
      'INSERT INTO refunds (order_id, user_id, reason, status, amount_cents) VALUES (?,?,?,?,?)',
      [o.id, userId, String(reason || '用户申请退款').slice(0, 200), 'pending', o.total_cents],
    );
    // 记住退款前状态：驳回时恢复，避免已发货/已完成订单被打回「待发货」
    run("UPDATE orders SET status = 'refunding', status_before_refund = ? WHERE id = ?", [o.status, o.id]);
    return { id: lastId, status: 'pending', amount: +(o.total_cents / 100).toFixed(2) };
  });
}

/**
 * 退款时间轴：把"提交了 3 天没动静"变成"现在卡在哪、谁在处理、还要多久"
 * 直接回应售后流程进度不透明的核心痛点
 */
export function refundTimeline(refund) {
  if (!refund) return null;
  const created = refund.created_at;
  const decided = refund.decided_at;
  const pending = refund.status === 'pending';
  const approved = refund.status === 'approved';
  const rejected = refund.status === 'rejected';

  const nodes = [
    {
      key: 'submitted',
      title: '退款申请已提交',
      owner: '你',
      ownerType: 'user',
      done: true,
      at: toIso(created),
      desc: '系统已收到申请，订单状态锁定为「退款中」',
    },
    {
      key: 'review',
      title: pending ? '等待商家审核' : rejected ? '商家已驳回' : '商家已通过审核',
      owner: '商家',
      ownerType: 'merchant',
      done: !pending,
      active: pending,
      at: toIso(decided),
      desc: pending
        ? '商家将在 1–3 个工作日内处理'
        : rejected
          ? `${refund.operator ? refund.operator + ' ' : ''}驳回：${refund.reject_reason || '商家认为不符合退款条件'}`
          : `审核通过${refund.operator ? '（处理人：' + refund.operator + '）' : ''}，进入退款打款环节`,
    },
    {
      key: 'refunded',
      title: approved ? '退款已原路退回' : rejected ? '退款未执行' : '退款到账',
      owner: '支付渠道',
      ownerType: 'system',
      done: approved,
      active: false,
      at: approved ? toIso(decided) : null,
      desc: approved
        ? `¥${(refund.amount_cents / 100).toFixed(2)} 已退回原支付账户（演示环境为模拟退款）`
        : rejected
          ? '如对结果有异议，可转人工客服申诉'
          : '商家通过后 1–3 个工作日内原路退回',
    },
  ];

  const currentIndex = pending ? 1 : 2;
  return {
    refundId: refund.id,
    status: refund.status,
    amount: +(refund.amount_cents / 100).toFixed(2),
    reason: refund.reason,
    currentIndex,
    currentNode: nodes[currentIndex],
    nodes,
    // 给用户一句"现在该怎么办"的确定性结论
    nextAction: pending
      ? '你可以先做别的事，审核结果会通过站内信通知'
      : approved
        ? '无需操作，留意原支付账户到账'
        : '如需申诉，可让 AI 客服转人工',
  };
}

/** 按订单取当前（最近一笔）退款单，附带时间轴 */
export function refundByOrder(orderId, userId = null) {
  const r = userId
    ? get('SELECT * FROM refunds WHERE order_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1', [+orderId, userId])
    : get('SELECT * FROM refunds WHERE order_id = ? ORDER BY id DESC LIMIT 1', [+orderId]);
  return r ? { ...r, timeline: refundTimeline(r) } : null;
}

export function listRefunds({ status = '', page = 1, pageSize = 50 } = {}) {
  const where = [];
  const params = [];
  if (status) { where.push('r.status = ?'); params.push(status); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return all(
    `SELECT r.*, o.order_no, u.name AS user_name FROM refunds r
     JOIN orders o ON o.id = r.order_id JOIN users u ON u.id = r.user_id
     ${clause} ORDER BY r.id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  ).map((r) => ({
    id: r.id, orderId: r.order_id, orderNo: r.order_no, userName: r.user_name,
    reason: r.reason, status: r.status, amount: +(r.amount_cents / 100).toFixed(2),
    rejectReason: r.reject_reason || '',
    operator: r.operator || '',
    createdAt: toIso(r.created_at), decidedAt: toIso(r.decided_at),
    // 商家侧也看到同一份时间轴，避免"用户问、商家也说不清"
    timeline: refundTimeline(r),
  }));
}

export function decideRefund(refundId, approve, rejectReason = '', operator = '') {
  return tx(() => {
    const r = get('SELECT * FROM refunds WHERE id = ?', [+refundId]);
    if (!r) throw new AppError('NOT_FOUND', '退款单不存在', 404);
    if (r.status !== 'pending') throw new AppError('BAD_STATUS', '该退款单已处理');
    const o = get('SELECT * FROM orders WHERE id = ?', [r.order_id]);
    if (!o) throw new AppError('NOT_FOUND', '订单不存在', 404);

    run("UPDATE refunds SET status = ?, decided_at = datetime('now'), reject_reason = ?, operator = ? WHERE id = ?",
      [approve ? 'approved' : 'rejected', approve ? '' : String(rejectReason || '').slice(0, 200),
        String(operator || '').slice(0, 40), r.id]);

    if (approve) {
      run("UPDATE orders SET status = 'refunded', status_before_refund = NULL WHERE id = ?", [o.id]);
      restoreStock(o.id, o.user_id);
      // 交易撤销，评价返现与评价积分一并扣回，堵住"评价拿钱再退款"的套利路径
      clawbackByOrder(o.id);
    } else {
      // 回到退款前的真实状态（可能是 paid / shipped / completed），而不是一律 paid
      const back = o.status_before_refund && ORDER_STATUS[o.status_before_refund]
        ? o.status_before_refund
        : (o.shipped_at ? 'shipped' : 'paid');
      run("UPDATE orders SET status = ?, status_before_refund = NULL WHERE id = ?", [back, o.id]);
    }
    return { id: r.id, status: approve ? 'approved' : 'rejected' };
  });
}

/**
 * 拼团下单：开团（无 teamId）与参团（有 teamId）走同一个入口
 * 成团判定在事务内完成，避免"第 2 个人付了钱但团还没成"的竞态
 */
export function createGroupOrder(userId, { groupBuyId, teamId = null, address, idemKey = null }) {
  return tx(() => {
    const g = get("SELECT * FROM group_buys WHERE id = ? AND status = 'active'", [+groupBuyId]);
    if (!g) throw new AppError('NOT_FOUND', '拼团活动不存在或已结束', 404);

    let team;
    let isLeader = false;
    if (teamId) {
      team = teamById(teamId);
      if (!team) throw new AppError('NOT_FOUND', '拼团不存在', 404);
      if (team.group_buy_id !== g.id) throw new AppError('INVALID', '该团不属于此活动', 400);
      if (team.status !== 'forming') throw new AppError('BAD_STATUS', '该团已结束，去开个新团吧', 400);
      if (get("SELECT datetime('now') > ? AS x", [team.expire_at]).x) {
        throw new AppError('TEAM_EXPIRED', '该团已超时，去开个新团吧', 400);
      }
      if (get('SELECT id FROM group_members WHERE team_id = ? AND user_id = ?', [team.id, userId])) {
        throw new AppError('DUPLICATE', '你已经在这个团里了', 400);
      }
    } else {
      const id = createTeam(g.id, userId);
      team = teamById(id);
      isLeader = true;
    }

    const order = createOrder(userId, {
      address,
      productId: g.product_id,
      qty: 1,
      idemKey,
      groupPriceCents: g.price_cents,
      groupBuyId: g.id,
      // 记录团号：订单详情/后台要能看出"这是拼团单"，团失败时也能按团找回订单
      groupTeamId: team.id,
    });

    addMember(team.id, userId, order.id, isLeader);
    const settled = checkTeamSuccess(team.id);
    const joined = get('SELECT COUNT(*) c FROM group_members WHERE team_id = ?', [team.id]).c;

    return {
      order,
      team: {
        id: team.id,
        status: settled.status,
        joined,
        required: g.required,
        need: Math.max(0, g.required - joined),
        expireAt: toIso(team.expire_at),
        isLeader,
        // 成团后订单已自动置为已支付，前端据此改文案
        success: settled.status === 'success',
      },
      shareHint: settled.status === 'success'
        ? '已成团，订单已确认，等待商家发货'
        : `还差 ${Math.max(0, g.required - joined)} 人成团，${g.expire_hours} 小时内有效`,
    };
  });
}

/** 我的拼团：用户参与过的团及状态 */
export function myTeams(userId) {
  return all(
    `SELECT t.*, g.product_id, g.price_cents, g.required, p.title, p.image
       FROM group_members m JOIN group_teams t ON t.id = m.team_id
       JOIN group_buys g ON g.id = t.group_buy_id JOIN products p ON p.id = g.product_id
      WHERE m.user_id = ? ORDER BY t.id DESC LIMIT 30`,
    [userId],
  ).map((t) => {
    const joined = get('SELECT COUNT(*) c FROM group_members WHERE team_id = ?', [t.id]).c;
    return {
      teamId: t.id,
      status: t.status,
      productId: t.product_id,
      title: t.title,
      image: t.image,
      price: +(t.price_cents / 100).toFixed(2),
      joined,
      required: t.required,
      need: Math.max(0, t.required - joined),
      expireAt: toIso(t.expire_at),
    };
  });
}

export { hydrate as hydrateOrder };
