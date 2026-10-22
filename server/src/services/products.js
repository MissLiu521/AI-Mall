import { all, get, run } from '../db/index.js';
import { AppError } from './users.js';
import { searchProducts } from './search.js';
import { toIso } from '../lib/time.js';

/** 库存语义化：把数字翻译成用户能判断的结论，回应"库存含糊" */
export function stockStatus(stock) {
  const n = Number(stock) || 0;
  if (n <= 0) return { level: 'out', label: '暂时缺货', hint: '补货中，可让 AI 助手在有货时提醒你', buyable: false };
  if (n <= 5) return { level: 'low', label: `仅剩 ${n} 件`, hint: '库存紧张，建议尽快下单', buyable: true };
  if (n <= 20) return { level: 'limited', label: `库存 ${n} 件`, hint: '库存有限，通常 3 天内发出', buyable: true };
  return { level: 'enough', label: '现货充足', hint: '今日下单，预计 48 小时内发出', buyable: true };
}

/** 价格构成明细：把"到手价怎么来的"摆到明面上，避免结算页惊喜 */
export function priceBreakdown(p) {
  const priceCents = p.price_cents;
  const originCents = p.compare_at_cents || null;
  const savingCents = originCents && originCents > priceCents ? originCents - priceCents : 0;
  return {
    origin: originCents ? +(originCents / 100).toFixed(2) : null,
    final: +(priceCents / 100).toFixed(2),
    saving: +(savingCents / 100).toFixed(2),
    discountLabel: savingCents ? `直降 ¥${(savingCents / 100).toFixed(2)}` : null,
    // 运费规则前置展示，不在结算页才出现
    shipping: { freeThreshold: 99, fee: 8, text: '满 ¥99 免运费，未满收 ¥8' },
    note: '当前无跨店满减、无会员加价，标价即到手价',
  };
}

/** 退换政策：商品页即可判定，不用等下单后再问客服 */
export function returnPolicy(category) {
  const special = {
    食品: { returnable: false, days: 0, text: '食品类未开封 7 天内可退，开封后不支持' },
    美妆: { returnable: false, days: 0, text: '美妆类开封后不支持无理由退货，质量问题除外' },
    个护: { returnable: true, days: 7, text: '未使用且包装完整 7 天无理由，贴身用品拆封后不支持' },
    服饰: { returnable: true, days: 7, text: '吊牌完整 7 天无理由，鞋类需未外穿' },
  };
  return special[category] || { returnable: true, days: 7, text: '7 天无理由退货，质量问题 15 天包换' };
}

const map = (p) => p && {
  id: p.id,
  title: p.title,
  subtitle: p.subtitle,
  description: p.description,
  price: +(p.price_cents / 100).toFixed(2),
  priceCents: p.price_cents,
  compareAt: p.compare_at_cents ? +(p.compare_at_cents / 100).toFixed(2) : null,
  stock: p.stock,
  stockStatus: stockStatus(p.stock),
  priceBreakdown: priceBreakdown(p),
  returnPolicy: returnPolicy(p.category),
  specs: (() => { try { return JSON.parse(p.specs || '{}'); } catch { return {}; } })(),
  category: p.category,
  tags: p.tags ? p.tags.split(',').filter(Boolean) : [],
  image: p.image,
  status: p.status,
  rating: p.rating,
  sales: p.sales,
  shopId: p.shop_id || null,
  imageList: p.images ? String(p.images).split(',').filter(Boolean) : (p.image ? [p.image] : []),
  hasVideo: !!p.video,
  createdAt: toIso(p.created_at),
};

export { map as mapProduct };

export function listProducts({ q = '', category = '', page = 1, pageSize = 12, includeInactive = false, explain = false, shopId = 0, sort = 'default' } = {}) {
  // 服务层再做一次兜底，任何调用方（含 AI 工具）传入 NaN/超大值都不会拖垮 SQLite
  const safePage = Math.max(1, Number.isFinite(+page) ? Math.floor(+page) : 1);
  const safeSize = Math.min(200, Math.max(1, Number.isFinite(+pageSize) ? Math.floor(+pageSize) : 12));
  page = safePage;
  pageSize = safeSize;
  const where = [];
  const params = [];
  if (!includeInactive) where.push("status = 'active'");
  if (category && category !== '全部') { where.push('category = ?'); params.push(category); }
  if (shopId) { where.push('shop_id = ?'); params.push(+shopId); }

  // 排序：榜单/筛选用，默认按销量
  const ORDER = {
    default: 'sales DESC, id DESC',
    price_asc: 'price_cents ASC, id DESC',
    price_desc: 'price_cents DESC, id DESC',
    rating: 'rating DESC, sales DESC',
    new: 'id DESC',
  };
  const orderBy = ORDER[sort] || ORDER.default;

  // 带关键词时走可解释检索：每条结果附带"为什么推荐它"
  if (q) {
    const rows = all(`SELECT * FROM products ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${orderBy}`, params);
    const { items, suggestions } = searchProducts(rows, q, { limit: 500 });
    const total = items.length;
    const offset = (Math.max(1, +page) - 1) * pageSize;
    const pageItems = items.slice(offset, offset + +pageSize).map((it) => {
      // 明确区分"商品字段"与"检索元信息"，避免污染 Product 类型
      const { matchScore, matchReasons, hitCount, ...product } = it;
      return explain ? { ...product, matchScore, hitCount, matchReasons } : product;
    });
    return {
      items: pageItems, total, page: +page, pageSize: +pageSize,
      query: q,
      // 零结果兜底建议，前端渲染成可点击的放宽条件
      suggestions: total === 0 ? suggestions : [],
    };
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = get(`SELECT COUNT(*) AS c FROM products ${clause}`, params).c;
  const offset = (Math.max(1, +page) - 1) * pageSize;
  const rows = all(`SELECT * FROM products ${clause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`, [...params, +pageSize, offset]);
  return { items: rows.map(map), total, page: +page, pageSize: +pageSize };
}

/** 榜单：热销 / 好评 / 降价，首页右侧与分类页共用 */
export function rankings() {
  const hot = all("SELECT * FROM products WHERE status='active' ORDER BY sales DESC LIMIT 6").map(map);
  const rated = all("SELECT * FROM products WHERE status='active' ORDER BY rating DESC, sales DESC LIMIT 6").map(map);
  const deals = all(
    `SELECT * FROM products WHERE status='active' AND compare_at_cents IS NOT NULL AND compare_at_cents > price_cents
      ORDER BY (compare_at_cents - price_cents) * 1.0 / compare_at_cents DESC LIMIT 6`,
  ).map((p) => ({ ...map(p), dropPercent: Math.round(((p.compare_at_cents - p.price_cents) / p.compare_at_cents) * 100) }));
  return { hot, rated, deals };
}

export function listShops() {
  return all('SELECT * FROM shops ORDER BY is_self DESC, id').map((s) => ({
    id: s.id, name: s.name, logo: s.logo, rating: s.rating,
    isSelf: !!s.is_self, description: s.description,
    productCount: get("SELECT COUNT(*) c FROM products WHERE shop_id = ? AND status='active'", [s.id]).c,
  }));
}

export function getProduct(id, userId = null) {
  const p = get('SELECT * FROM products WHERE id = ?', [+id]);
  if (!p) throw new AppError('NOT_FOUND', '商品不存在', 404);

  // SKU：有规格的商品必须选规格，价格区间由最便宜/最贵规格决定
  const skus = all("SELECT * FROM product_skus WHERE product_id = ? AND status = 'active' ORDER BY id", [p.id])
    .map((s) => ({
      id: s.id,
      spec: (() => { try { return JSON.parse(s.spec_json || '{}'); } catch { return {}; } })(),
      price: +(s.price_cents / 100).toFixed(2),
      priceCents: s.price_cents,
      stock: s.stock,
      image: s.image,
      code: s.sku_code,
      buyable: s.stock > 0,
    }));
  const shop = p.shop_id ? get('SELECT id, name, logo, rating, is_self, description FROM shops WHERE id = ?', [p.shop_id]) : null;
  const priceRange = skus.length
    ? { min: Math.min(...skus.map((s) => s.price)), max: Math.max(...skus.map((s) => s.price)) }
    : null;

  const base = map(p);
  return {
    ...base,
    shop: shop ? { ...shop, isSelf: !!shop.is_self } : null,
    skus,
    priceRange,
    totalStock: skus.length ? skus.reduce((s, x) => s + x.stock, 0) : p.stock,
    images: p.images ? String(p.images).split(',').filter(Boolean) : [p.image],
    video: p.video || '',
    favorite: userId ? !!get('SELECT 1 AS x FROM favorites WHERE user_id = ? AND product_id = ?', [userId, p.id]) : false,
    reviewSummary: reviewSummary(p.id),
    // 同类对比：价格区间与关键差异，支撑"AI 比价"入口
    compare: compareSameCategory(p),
  };
}

function reviewSummary(productId) {
  const rows = all('SELECT rating, content FROM reviews WHERE product_id = ?', [productId]);
  if (!rows.length) return { total: 0, average: 0, goodRate: 0, preview: [] };
  const total = rows.length;
  const avg = +(rows.reduce((s, r) => s + r.rating, 0) / total).toFixed(1);
  const good = rows.filter((r) => r.rating >= 4).length;
  return {
    total, average: avg, goodRate: +((good / total) * 100).toFixed(1),
    preview: rows.filter((r) => r.content).slice(0, 2).map((r) => ({ rating: r.rating, content: r.content })),
  };
}

/** 同品类最多 4 件可对比商品，价格/评分/销量三项对齐 */
function compareSameCategory(p) {
  return all(
    `SELECT id, title, price_cents, rating, sales, stock FROM products
      WHERE category = ? AND id != ? AND status = 'active' ORDER BY sales DESC LIMIT 4`,
    [p.category, p.id],
  ).map((x) => ({
    id: x.id,
    title: x.title,
    price: +(x.price_cents / 100).toFixed(2),
    rating: x.rating,
    sales: x.sales,
    inStock: x.stock > 0,
  }));
}

export function categories() {
  return all("SELECT category, COUNT(*) AS count FROM products WHERE status='active' GROUP BY category ORDER BY count DESC")
    .map((r) => ({ name: r.category, count: r.count }));
}

export function createProduct(input, { admin = false } = {}) {
  if (!admin) throw new AppError('FORBIDDEN', '无权限', 403);
  const { title, subtitle = '', description = '', price, stock = 0, category = '其他', tags = [], image = '', compareAt = null, status = 'active' } = input;
  if (!title || typeof title !== 'string') throw new AppError('INVALID', '商品标题必填');
  const priceCents = Math.round(Number(price) * 100);
  if (!Number.isFinite(priceCents) || priceCents <= 0) throw new AppError('INVALID', '价格必须大于 0');
  const { lastId } = run(
    `INSERT INTO products (title, subtitle, description, price_cents, compare_at_cents, stock, category, tags, image, status)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [title.trim(), subtitle, description, priceCents, compareAt ? Math.round(compareAt * 100) : null,
      +stock || 0, category, Array.isArray(tags) ? tags.join(',') : tags, image, status],
  );
  return getProduct(lastId);
}

export function updateProduct(id, patch, { admin = false } = {}) {
  if (!admin) throw new AppError('FORBIDDEN', '无权限', 403);
  const p = get('SELECT * FROM products WHERE id = ?', [+id]);
  if (!p) throw new AppError('NOT_FOUND', '商品不存在', 404);
  const fields = [];
  const params = [];
  const set = (col, val) => { fields.push(`${col} = ?`); params.push(val); };

  if (patch.title !== undefined) set('title', String(patch.title).trim());
  if (patch.subtitle !== undefined) set('subtitle', patch.subtitle);
  if (patch.description !== undefined) set('description', patch.description);
  if (patch.price !== undefined) {
    const c = Math.round(Number(patch.price) * 100);
    if (!Number.isFinite(c) || c <= 0) throw new AppError('INVALID', '价格不合法');
    set('price_cents', c);
  }
  if (patch.compareAt !== undefined) set('compare_at_cents', patch.compareAt ? Math.round(patch.compareAt * 100) : null);
  if (patch.stock !== undefined) set('stock', Math.max(0, +patch.stock || 0));
  if (patch.category !== undefined) set('category', patch.category);
  if (patch.tags !== undefined) set('tags', Array.isArray(patch.tags) ? patch.tags.join(',') : patch.tags);
  if (patch.image !== undefined) set('image', patch.image);
  if (patch.status !== undefined) {
    if (!['active', 'inactive'].includes(patch.status)) throw new AppError('INVALID', '状态不合法');
    set('status', patch.status);
  }
  if (!fields.length) return map(p);
  params.push(+id);
  run(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`, params);
  return getProduct(id);
}

export function deleteProduct(id, { admin = false } = {}) {
  if (!admin) throw new AppError('FORBIDDEN', '无权限', 403);
  const r = run('DELETE FROM products WHERE id = ?', [+id]);
  if (!r.changes) throw new AppError('NOT_FOUND', '商品不存在', 404);
  return { deleted: true };
}
