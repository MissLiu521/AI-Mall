/**
 * 用户资产域：收藏夹 / 浏览足迹 / 积分与会员
 */
import { all, get, run } from '../db/index.js';
import { AppError } from './users.js';
import { toIso } from '../lib/time.js';
import { MEMBER_LEVELS, memberOf, levelForSpent } from './pricing.js';

const mapProduct = (p) => ({
  id: p.id,
  title: p.title,
  subtitle: p.subtitle,
  price: +(p.price_cents / 100).toFixed(2),
  compareAt: p.compare_at_cents ? +(p.compare_at_cents / 100).toFixed(2) : null,
  image: p.image,
  rating: p.rating,
  category: p.category,
  sales: p.sales,
  stock: p.stock,
});

// ── 收藏 ──────────────────────────────────────────────────

export function toggleFavorite(userId, productId) {
  const p = get('SELECT id FROM products WHERE id = ?', [+productId]);
  if (!p) throw new AppError('NOT_FOUND', '商品不存在', 404);
  const exist = get('SELECT 1 AS x FROM favorites WHERE user_id = ? AND product_id = ?', [userId, +productId]);
  if (exist) {
    run('DELETE FROM favorites WHERE user_id = ? AND product_id = ?', [userId, +productId]);
    return { favorited: false };
  }
  run('INSERT INTO favorites (user_id, product_id) VALUES (?,?)', [userId, +productId]);
  return { favorited: true };
}

export function isFavorited(userId, productId) {
  if (!userId) return false;
  return !!get('SELECT 1 AS x FROM favorites WHERE user_id = ? AND product_id = ?', [userId, +productId]);
}

export function listFavorites(userId, { page = 1, pageSize = 20 } = {}) {
  const total = get('SELECT COUNT(*) c FROM favorites WHERE user_id = ?', [userId]).c;
  const items = all(
    `SELECT p.*, f.created_at AS fav_at FROM favorites f JOIN products p ON p.id = f.product_id
      WHERE f.user_id = ? ORDER BY f.created_at DESC LIMIT ? OFFSET ?`,
    [userId, pageSize, (page - 1) * pageSize],
  ).map((p) => ({
    ...mapProduct(p),
    // 降价提醒：收藏后价格低于当前标价时提示（示例数据用 compare_at 判断）
    priceDrop: p.compare_at_cents && p.compare_at_cents > p.price_cents
      ? +((p.compare_at_cents - p.price_cents) / 100).toFixed(2) : 0,
    favoritedAt: toIso(p.fav_at),
  }));
  return { items, total, page, pageSize };
}

// ── 足迹 ──────────────────────────────────────────────────

export function recordFootprint(userId, productId) {
  if (!userId) return { recorded: false };
  const p = get('SELECT id FROM products WHERE id = ?', [+productId]);
  if (!p) return { recorded: false };
  run(
    `INSERT INTO footprints (user_id, product_id, viewed_at) VALUES (?,?, datetime('now'))
     ON CONFLICT(user_id, product_id) DO UPDATE SET viewed_at = datetime('now')`,
    [userId, +productId],
  );
  // 只保留最近 200 条，避免单表无限膨胀
  run(
    `DELETE FROM footprints WHERE user_id = ? AND product_id NOT IN (
       SELECT product_id FROM footprints WHERE user_id = ? ORDER BY viewed_at DESC LIMIT 200)`,
    [userId, userId],
  );
  return { recorded: true };
}

export function listFootprints(userId, { page = 1, pageSize = 40 } = {}) {
  const total = get('SELECT COUNT(*) c FROM footprints WHERE user_id = ?', [userId]).c;
  const rows = all(
    `SELECT p.*, f.viewed_at FROM footprints f JOIN products p ON p.id = f.product_id
      WHERE f.user_id = ? ORDER BY f.viewed_at DESC LIMIT ? OFFSET ?`,
    [userId, pageSize, (page - 1) * pageSize],
  );
  // 按天分组，像淘宝"足迹"那样给用户时间感
  const groups = [];
  for (const r of rows) {
    const day = String(r.viewed_at).slice(0, 10);
    let g = groups.find((x) => x.day === day);
    if (!g) { g = { day, label: dayLabel(day), items: [] }; groups.push(g); }
    g.items.push({ ...mapProduct(r), viewedAt: toIso(r.viewed_at) });
  }
  return { groups, total, page, pageSize };
}

function dayLabel(day) {
  const today = new Date().toISOString().slice(0, 10);
  const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (day === today) return '今天';
  if (day === y) return '昨天';
  return day.slice(5).replace('-', ' 月 ') + ' 日';
}

export function clearFootprints(userId) {
  run('DELETE FROM footprints WHERE user_id = ?', [userId]);
  return { cleared: true };
}

// ── 积分与会员 ────────────────────────────────────────────

export function pointsInfo(userId) {
  const u = get('SELECT points, level, total_spent_cents FROM users WHERE id = ?', [userId]);
  if (!u) throw new AppError('NOT_FOUND', '用户不存在', 404);
  const level = MEMBER_LEVELS[u.level] || MEMBER_LEVELS.normal;
  const nextKey = u.level === 'gold' ? null : u.level === 'silver' ? 'gold' : 'silver';
  const next = nextKey ? MEMBER_LEVELS[nextKey] : null;
  const history = all(
    'SELECT id, delta, reason, created_at FROM points_log WHERE user_id = ? ORDER BY id DESC LIMIT 30',
    [userId],
  ).map((p) => ({ id: p.id, delta: p.delta, reason: p.reason, createdAt: toIso(p.created_at) }));

  return {
    points: u.points,
    // 100 积分 = 1 元
    cashValue: +(u.points / 100).toFixed(2),
    level: { key: u.level || 'normal', label: level.label, rate: level.rate, freeShip: level.freeShip },
    totalSpent: +(u.total_spent_cents / 100).toFixed(2),
    next: next ? {
      label: next.label,
      needCents: Math.max(0, next.minSpent - u.total_spent_cents),
      rate: next.rate,
    } : null,
    history,
  };
}

export function addPoints(userId, delta, reason, refId = null) {
  if (!delta) return;
  run('INSERT INTO points_log (user_id, delta, reason, ref_id) VALUES (?,?,?,?)', [userId, delta, reason, refId]);
  run('UPDATE users SET points = MAX(0, points + ?) WHERE id = ?', [delta, userId]);
}

/** 支付成功后：累计消费、返积分、升级会员（只升不降，避免数据初始化不一致时把用户等级打回普通） */
export function onOrderPaid(userId, orderId, totalCents) {
  run('UPDATE users SET total_spent_cents = total_spent_cents + ? WHERE id = ?', [totalCents, userId]);
  // 1 元返 1 积分
  const earned = Math.floor(totalCents / 100);
  if (earned > 0) addPoints(userId, earned, '购物返积分', orderId);
  const u = get('SELECT level, total_spent_cents FROM users WHERE id = ?', [userId]);
  const next = levelForSpent(u.total_spent_cents || 0);
  const rank = { normal: 0, silver: 1, gold: 2 };
  if (rank[next] > rank[u.level || 'normal']) {
    run('UPDATE users SET level = ? WHERE id = ?', [next, userId]);
    return { earned, level: next, upgraded: true };
  }
  return { earned, level: u.level || 'normal', upgraded: false };
}

export { memberOf };
