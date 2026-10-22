/**
 * 内容域：逛逛（内容即货架）
 * 一条内容挂多个商品，点进去可直接下单——抖音的核心结构。
 */
import { all, get, run } from '../db/index.js';
import { AppError } from './users.js';
import { toIso } from '../lib/time.js';

function parseIds(s) {
  try {
    const v = JSON.parse(s || '[]');
    return Array.isArray(v) ? v.map(Number).filter(Boolean) : [];
  } catch { return []; }
}

function productsOf(ids) {
  if (!ids.length) return [];
  const ph = ids.map(() => '?').join(',');
  const rows = all(`SELECT id, title, price_cents, compare_at_cents, image, category, rating, sales FROM products
                     WHERE id IN (${ph}) AND status = 'active'`, ids);
  const order = new Map(ids.map((id, i) => [id, i]));
  return rows.sort((a, b) => order.get(a.id) - order.get(b.id)).map((p) => ({
    id: p.id,
    title: p.title,
    price: +(p.price_cents / 100).toFixed(2),
    compareAt: p.compare_at_cents ? +(p.compare_at_cents / 100).toFixed(2) : null,
    image: p.image,
    category: p.category,
    rating: p.rating,
    sales: p.sales,
  }));
}

export function listFeeds({ page = 1, pageSize = 10, userId = null } = {}) {
  const total = get("SELECT COUNT(*) c FROM feeds WHERE status = 'active'").c;
  const rows = all(
    `SELECT * FROM feeds WHERE status = 'active' ORDER BY id DESC LIMIT ? OFFSET ?`,
    [pageSize, (page - 1) * pageSize],
  );
  const items = rows.map((f) => decorate(f, userId));
  return { items, total, page, pageSize };
}

export function feedDetail(id, userId = null) {
  const f = get("SELECT * FROM feeds WHERE id = ? AND status = 'active'", [+id]);
  if (!f) throw new AppError('NOT_FOUND', '内容不存在', 404);
  run('UPDATE feeds SET views = views + 1 WHERE id = ?', [+id]);
  return decorate({ ...f, views: f.views + 1 }, userId);
}

function decorate(f, userId) {
  const ids = parseIds(f.product_ids);
  return {
    id: f.id,
    type: f.type,
    title: f.title,
    body: f.body,
    cover: f.cover,
    media: f.media,
    authorName: f.author_name,
    likes: f.likes,
    views: f.views,
    liked: userId ? !!get('SELECT 1 AS x FROM feed_likes WHERE feed_id = ? AND user_id = ?', [f.id, userId]) : false,
    products: productsOf(ids),
    createdAt: toIso(f.created_at),
  };
}

export function toggleLike(feedId, userId) {
  const f = get('SELECT * FROM feeds WHERE id = ?', [+feedId]);
  if (!f) throw new AppError('NOT_FOUND', '内容不存在', 404);
  const liked = get('SELECT 1 AS x FROM feed_likes WHERE feed_id = ? AND user_id = ?', [+feedId, userId]);
  if (liked) {
    run('DELETE FROM feed_likes WHERE feed_id = ? AND user_id = ?', [+feedId, userId]);
    run('UPDATE feeds SET likes = MAX(0, likes - 1) WHERE id = ?', [+feedId]);
    return { liked: false, likes: Math.max(0, f.likes - 1) };
  }
  run('INSERT INTO feed_likes (feed_id, user_id) VALUES (?,?)', [+feedId, userId]);
  run('UPDATE feeds SET likes = likes + 1 WHERE id = ?', [+feedId]);
  return { liked: true, likes: f.likes + 1 };
}

export function adminListFeeds({ page = 1, pageSize = 20 } = {}) {
  const total = get('SELECT COUNT(*) c FROM feeds').c;
  const items = all('SELECT * FROM feeds ORDER BY id DESC LIMIT ? OFFSET ?', [pageSize, (page - 1) * pageSize])
    .map((f) => decorate(f, null));
  return { items, total, page, pageSize };
}

export function createFeed({ authorId = null, authorName = '官方账号', type = 'image', title, body = '', cover = '', media = '', productIds = [] }) {
  const t = String(title || '').trim();
  if (t.length < 2) throw new AppError('INVALID', '标题至少 2 个字', 400);
  const { lastId } = run(
    `INSERT INTO feeds (author_id, author_name, type, title, body, cover, media, product_ids)
     VALUES (?,?,?,?,?,?,?,?)`,
    [authorId, authorName, type, t.slice(0, 80), String(body).slice(0, 2000), cover, media,
      JSON.stringify(Array.isArray(productIds) ? productIds.slice(0, 10) : [])],
  );
  return decorate(get('SELECT * FROM feeds WHERE id = ?', [lastId]), null);
}

export function removeFeed(id) {
  run("UPDATE feeds SET status = 'hidden' WHERE id = ?", [+id]);
  return { removed: true };
}
