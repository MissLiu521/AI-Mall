/**
 * 统一计价引擎
 *
 * 结算页预览与真实下单必须调用同一个函数，否则会出现"看到的价格和付出的价格不一样"。
 * 顺序固定：行小计 → 会员折扣 → 优惠券 → 满减 → 积分抵扣 → 余额抵扣 → 运费 = 实付
 * 每一步都夹一次下限，保证任何组合都不会把实付算成负数。
 */
import { get, all } from '../db/index.js';
import { AppError } from './users.js';

/** 会员等级：折扣率与包邮门槛 */
export const MEMBER_LEVELS = {
  normal: { label: '普通会员', rate: 1, freeShip: false, minSpent: 0 },
  silver: { label: '银卡会员', rate: 0.95, freeShip: true, minSpent: 100000 },
  gold: { label: '金卡会员', rate: 0.9, freeShip: true, minSpent: 500000 },
};

/** 满减档位：取满足条件的最优一档（不是叠加） */
export const FULL_CUT_TIERS = [
  { threshold: 19900, cut: 3000, label: '满 199 减 30' },
  { threshold: 39900, cut: 8000, label: '满 399 减 80' },
  { threshold: 99900, cut: 20000, label: '满 999 减 200' },
];

/** 积分兑换比例：1 积分 = 1 分钱（100 积分 = 1 元） */
export const POINTS_PER_CENT = 1;
/** 单笔最多抵扣商品小计的 30% */
export const POINTS_MAX_RATIO = 0.3;

export const memberOf = (user) => MEMBER_LEVELS[user?.level] || MEMBER_LEVELS.normal;

export function levelForSpent(totalSpentCents) {
  if (totalSpentCents >= MEMBER_LEVELS.gold.minSpent) return 'gold';
  if (totalSpentCents >= MEMBER_LEVELS.silver.minSpent) return 'silver';
  return 'normal';
}

export function bestFullCut(subtotalCents) {
  let hit = null;
  for (const t of FULL_CUT_TIERS) {
    if (subtotalCents >= t.threshold) hit = t;
  }
  return hit || { threshold: 0, cut: 0, label: '' };
}

/** 距离下一档满减还差多少（用于 "再买 X 元减 Y" 的凑单提示） */
export function nextFullCut(subtotalCents) {
  const next = FULL_CUT_TIERS.find((t) => subtotalCents < t.threshold);
  if (!next) return null;
  return { gapCents: next.threshold - subtotalCents, cutCents: next.cut, label: next.label };
}

/**
 * 计算一张券在给定订单上的优惠额（分）
 * @returns {{ ok: boolean, reason?: string, discountCents: number, freeShip: boolean }}
 */
export function evaluateCoupon(coupon, subtotalCents, eligibleCents = subtotalCents) {
  if (!coupon) return { ok: false, reason: '券不存在', discountCents: 0, freeShip: false };
  if (coupon.status && !['active'].includes(coupon.status)) {
    return { ok: false, reason: '券已停用', discountCents: 0, freeShip: false };
  }
  const threshold = coupon.threshold_cents || 0;
  if (eligibleCents < threshold) {
    return { ok: false, reason: `还差 ¥${((threshold - eligibleCents) / 100).toFixed(2)} 可用`, discountCents: 0, freeShip: false };
  }
  if (coupon.type === 'free_ship') {
    return { ok: true, discountCents: 0, freeShip: true };
  }
  if (coupon.type === 'discount') {
    const raw = Math.floor((eligibleCents * (100 - coupon.value)) / 100);
    const capped = coupon.max_discount_cents ? Math.min(raw, coupon.max_discount_cents) : raw;
    return { ok: true, discountCents: Math.max(0, capped), freeShip: false };
  }
  // reduce
  return { ok: true, discountCents: Math.max(0, Math.min(coupon.value, eligibleCents)), freeShip: false };
}

/**
 * 核心报价函数（纯函数，不写库）
 * @param {object} p
 * @param {Array}  p.lines       [{ productId, title, priceCents, qty, category }]
 * @param {object} p.user        { id, points, level }
 * @param {object} p.coupon      券模板行（可选）
 * @param {number} p.usePoints   想使用的积分数（可选）
 * @param {number} p.useBalance  想使用的余额（分，可选；评价返现所得）
 * @param {boolean} p.freeShip   是否已通过免邮券/活动免邮
 */
export function quote({ lines, user, coupon = null, usePoints = 0, useBalance = 0, flashFreeShip = false }) {
  if (!Array.isArray(lines) || !lines.length) {
    throw new AppError('EMPTY_ORDER', '订单没有商品', 400);
  }
  for (const l of lines) {
    if (!Number.isFinite(l.priceCents) || l.priceCents < 0) {
      throw new AppError('INVALID_PRICE', '商品价格异常', 400);
    }
    if (!Number.isInteger(l.qty) || l.qty < 1) {
      throw new AppError('INVALID_QTY', '商品数量异常', 400);
    }
  }

  const subtotalCents = lines.reduce((s, l) => s + l.priceCents * l.qty, 0);
  const level = memberOf(user);
  const memberDiscountCents = Math.round(subtotalCents * (1 - level.rate));

  let remaining = subtotalCents - memberDiscountCents;
  const steps = [];

  if (memberDiscountCents > 0) {
    steps.push({ label: `${level.label} ${(level.rate * 10).toFixed(1)} 折`, cents: memberDiscountCents });
  }

  // 券：品类券只对匹配品类的行生效
  let couponDiscountCents = 0;
  let freeShip = flashFreeShip;
  let couponNote = '';
  if (coupon) {
    const eligibleCents = coupon.category
      ? lines.filter((l) => l.category === coupon.category).reduce((s, l) => s + l.priceCents * l.qty, 0)
      : subtotalCents - memberDiscountCents;
    const r = evaluateCoupon(coupon, subtotalCents, eligibleCents);
    if (!r.ok) {
      couponNote = r.reason;
    } else {
      couponDiscountCents = Math.min(r.discountCents, remaining);
      freeShip = freeShip || r.freeShip;
      if (couponDiscountCents > 0) {
        steps.push({ label: coupon.title, cents: couponDiscountCents });
      } else if (r.freeShip) {
        steps.push({ label: coupon.title, cents: 0, note: '免运费' });
      }
    }
    remaining -= couponDiscountCents;
  }

  // 满减：按商品小计判断档位
  const cut = bestFullCut(subtotalCents);
  const fullCutCents = Math.min(cut.cut, Math.max(0, remaining));
  if (fullCutCents > 0) {
    steps.push({ label: cut.label, cents: fullCutCents });
    remaining -= fullCutCents;
  }

  // 积分：上限 = 剩余应付的 30%，且不超过用户余额
  const balance = Math.max(0, Number(user?.points) || 0);
  const maxByRatio = Math.floor(Math.max(0, remaining) * POINTS_MAX_RATIO);
  const want = Math.max(0, Math.floor(Number(usePoints) || 0));
  const pointsUsed = Math.min(balance, maxByRatio, want);
  const pointsDiscountCents = Math.min(pointsUsed * POINTS_PER_CENT, Math.max(0, remaining));
  if (pointsDiscountCents > 0) {
    steps.push({ label: `积分抵现（${Math.floor(pointsDiscountCents / POINTS_PER_CENT)} 积分）`, cents: pointsDiscountCents });
    remaining -= pointsDiscountCents;
  }

  // 余额（评价返现）：可全额抵扣剩余应付商品金额，不含运费
  const balanceCents = Math.max(0, Number(user?.balance_cents) || 0);
  const wantBalance = Math.max(0, Math.floor(Number(useBalance) || 0));
  const balanceUsed = Math.min(balanceCents, wantBalance, Math.max(0, remaining));
  if (balanceUsed > 0) {
    steps.push({ label: `余额抵扣（¥${(balanceUsed / 100).toFixed(2)}）`, cents: balanceUsed });
    remaining -= balanceUsed;
  }

  // 运费：会员包邮 / 满 99 包邮 / 免邮券
  const baseShipping = subtotalCents >= 9900 ? 0 : 800;
  const shippingCents = freeShip || level.freeShip ? 0 : baseShipping;
  if (shippingCents > 0) steps.push({ label: '运费', cents: -shippingCents });

  const totalCents = Math.max(0, subtotalCents - memberDiscountCents - couponDiscountCents - fullCutCents - pointsDiscountCents - balanceUsed + shippingCents);

  return {
    subtotalCents,
    memberDiscountCents,
    couponDiscountCents,
    fullCutCents,
    pointsUsed,
    pointsDiscountCents,
    balanceUsed,
    balanceDiscountCents: balanceUsed,
    balanceCents,
    shippingCents,
    totalCents,
    steps,
    couponNote,
    level: { key: user?.level || 'normal', label: level.label, rate: level.rate },
    // 前端直接展示的元值
    display: {
      subtotal: +(subtotalCents / 100).toFixed(2),
      discount: +((subtotalCents - (totalCents - shippingCents)) / 100).toFixed(2),
      shipping: +(shippingCents / 100).toFixed(2),
      total: +(totalCents / 100).toFixed(2),
      saved: +((subtotalCents + shippingCents - totalCents) / 100).toFixed(2),
    },
    next: nextFullCut(subtotalCents),
  };
}

/** 读取用户可用券并评估，供结算页展示"哪些券能用、能省多少" */
export function usableCoupons(userId, subtotalCents, lines, memberDiscountCents = 0) {
  const rows = _joinUserCoupons(userId);
  // 与 quote 保持同一基准：非品类券按"扣完会员折扣后的金额"判断门槛，
  // 否则列表显示"可用"，点进去却少减几块钱
  const afterMember = Math.max(0, subtotalCents - memberDiscountCents);
  return rows.map((r) => {
    const eligible = r.category
      ? lines.filter((l) => l.category === r.category).reduce((s, l) => s + l.priceCents * l.qty, 0)
      : afterMember;
    const ev = evaluateCoupon(r, subtotalCents, eligible);
    return {
      userCouponId: r.user_coupon_id,
      couponId: r.id,
      title: r.title,
      type: r.type,
      threshold: +(r.threshold_cents / 100).toFixed(2),
      value: r.value,
      maxDiscount: r.max_discount_cents ? +(r.max_discount_cents / 100).toFixed(2) : null,
      category: r.category,
      expireAt: r.expire_at,
      usable: ev.ok,
      reason: ev.ok ? null : ev.reason,
      discount: +(ev.discountCents / 100).toFixed(2),
      freeShip: ev.freeShip,
    };
  }).sort((a, b) => Number(b.usable) - Number(a.usable) || b.discount - a.discount);
}

function _joinUserCoupons(userId) {
  return all(
    `SELECT uc.id AS user_coupon_id, uc.expire_at,
            c.id, c.title, c.type, c.threshold_cents, c.value,
            c.max_discount_cents, c.category
       FROM user_coupons uc
       JOIN coupons c ON c.id = uc.coupon_id
      WHERE uc.user_id = ? AND uc.status = 'unused'
        AND c.status = 'active'
        AND (uc.expire_at IS NULL OR uc.expire_at > datetime('now'))
      ORDER BY c.threshold_cents`,
    [userId],
  );
}

/** 会员等级升级检查：下单支付后调用，返回最新等级 */
export function refreshLevel(userId) {
  const u = get('SELECT level, total_spent_cents FROM users WHERE id = ?', [userId]);
  if (!u) return null;
  const next = levelForSpent(u.total_spent_cents || 0);
  const rank = { normal: 0, silver: 1, gold: 2 };
  if (rank[next] > rank[u.level || 'normal']) return next;
  return u.level || 'normal';
}
