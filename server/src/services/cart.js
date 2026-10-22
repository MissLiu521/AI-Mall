import { all, get, run, tx } from '../db/index.js';
import { AppError } from './users.js';
import { mapProduct } from './products.js';

const specText = (json) => {
  try {
    const o = JSON.parse(json || '{}');
    const t = Object.entries(o).map(([k, v]) => `${k}：${v}`).join(' / ');
    return t;
  } catch { return ''; }
};

/** 购物车：按店铺分组 + SKU 单价 + 失效商品单独拎出来 */
export function getCart(userId) {
  const rows = all(
    `SELECT c.id AS cart_id, c.qty, c.sku_id, c.selected,
            p.*, s.spec_json AS sku_spec, s.price_cents AS sku_price,
            s.stock AS sku_stock, s.image AS sku_image,
            sh.name AS shop_name, sh.is_self AS shop_self
       FROM cart_items c
       JOIN products p ON p.id = c.product_id
       LEFT JOIN product_skus s ON s.id = c.sku_id AND c.sku_id > 0
       LEFT JOIN shops sh ON sh.id = p.shop_id
      WHERE c.user_id = ? ORDER BY c.created_at DESC`,
    [userId],
  );

  const items = rows.map((r) => {
    const p = mapProduct(r);
    const hasSku = r.sku_id > 0 && r.sku_price != null;
    const unitCents = hasSku ? r.sku_price : p.priceCents;
    const stock = hasSku ? r.sku_stock : p.stock;
    const invalid = p.status !== 'active' || stock <= 0;
    return {
      cartId: r.cart_id,
      qty: r.qty,
      selected: !!r.selected,
      skuId: r.sku_id || null,
      specText: hasSku ? specText(r.sku_spec) : '',
      image: hasSku && r.sku_image ? r.sku_image : p.image,
      product: p,
      unitPrice: +(unitCents / 100).toFixed(2),
      subtotal: +((unitCents * r.qty) / 100).toFixed(2),
      stock,
      stockEnough: stock >= r.qty,
      invalid,
      invalidReason: p.status !== 'active' ? '商品已下架' : '库存不足',
      shopName: r.shop_name || 'AI Mall',
      isSelf: !!r.shop_self,
    };
  });

  // 按店铺分组：淘宝/京东的购物车都是这个结构，便于"凑单"和"整店结算"
  const groups = [];
  for (const it of items) {
    const key = it.shopName;
    let g = groups.find((x) => x.shopName === key);
    if (!g) { g = { shopName: key, isSelf: it.isSelf, items: [], subtotal: 0 }; groups.push(g); }
    g.items.push(it);
    if (!it.invalid && it.selected) g.subtotal += it.subtotal;
  }
  groups.forEach((g) => { g.subtotal = +g.subtotal.toFixed(2); });

  const valid = items.filter((i) => !i.invalid && i.selected);
  const subtotal = +valid.reduce((s, i) => s + i.subtotal, 0).toFixed(2);
  return {
    items,
    groups,
    count: items.reduce((s, i) => s + i.qty, 0),
    selectedCount: valid.reduce((s, i) => s + i.qty, 0),
    subtotal,
    shipping: subtotal === 0 || subtotal >= 99 ? 0 : 8,
    invalidCount: items.filter((i) => i.invalid).length,
  };
}

export function addToCart(userId, { productId, skuId = 0, qty = 1 }) {
  const p = get('SELECT * FROM products WHERE id = ?', [+productId]);
  if (!p) throw new AppError('NOT_FOUND', '商品不存在', 404);
  if (p.status !== 'active') throw new AppError('OFF_SHELF', '商品已下架');

  const skus = all("SELECT * FROM product_skus WHERE product_id = ? AND status = 'active'", [p.id]);
  let sku = null;
  if (skus.length) {
    sku = skuId ? get('SELECT * FROM product_skus WHERE id = ? AND product_id = ?', [+skuId, p.id]) : null;
    if (skuId && !sku) throw new AppError('SKU_NOT_FOUND', '所选规格不存在', 400);
    // 未指定规格时落到默认规格，前端也会默认选中第一个
    if (!sku) sku = skus.find((s) => s.stock > 0) || skus[0];
  }

  const requested = Math.max(1, +qty || 1);
  const key = { productId: +productId, skuId: sku ? sku.id : 0 };
  const exist = get('SELECT * FROM cart_items WHERE user_id = ? AND product_id = ? AND sku_id = ?',
    [userId, key.productId, key.skuId]);
  const next = (exist?.qty || 0) + requested;
  const stock = sku ? sku.stock : p.stock;
  if (next > stock) throw new AppError('OUT_OF_STOCK', `库存不足，仅剩 ${stock} 件`);
  if (exist) run('UPDATE cart_items SET qty = ? WHERE id = ?', [Math.min(99, next), exist.id]);
  else {
    run('INSERT INTO cart_items (user_id, product_id, sku_id, qty) VALUES (?,?,?,?)',
      [userId, key.productId, key.skuId, Math.min(99, next)]);
  }
  return getCart(userId);
}

export function updateCartItem(userId, cartId, qty) {
  const row = get(
    `SELECT c.*, p.stock AS p_stock, s.stock AS sku_stock FROM cart_items c
       JOIN products p ON p.id = c.product_id
       LEFT JOIN product_skus s ON s.id = c.sku_id AND c.sku_id > 0
      WHERE c.id = ? AND c.user_id = ?`, [+cartId, userId],
  );
  if (!row) throw new AppError('NOT_FOUND', '购物车项不存在', 404);
  const n = +qty;
  if (!Number.isFinite(n) || n <= 0) return removeCartItem(userId, cartId);
  const stock = row.sku_id > 0 ? row.sku_stock : row.p_stock;
  if (n > stock) throw new AppError('OUT_OF_STOCK', `库存不足，仅剩 ${stock} 件`);
  run('UPDATE cart_items SET qty = ? WHERE id = ?', [Math.min(99, n), row.id]);
  return getCart(userId);
}

/** 勾选/取消勾选：结算只算勾选的，和淘宝一致 */
export function toggleSelect(userId, cartId, selected) {
  const row = get('SELECT * FROM cart_items WHERE id = ? AND user_id = ?', [+cartId, userId]);
  if (!row) throw new AppError('NOT_FOUND', '购物车项不存在', 404);
  run('UPDATE cart_items SET selected = ? WHERE id = ?', [selected ? 1 : 0, row.id]);
  return getCart(userId);
}

export function selectAll(userId, selected) {
  run('UPDATE cart_items SET selected = ? WHERE user_id = ?', [selected ? 1 : 0, userId]);
  return getCart(userId);
}

export function removeCartItem(userId, cartId) {
  run('DELETE FROM cart_items WHERE id = ? AND user_id = ?', [+cartId, userId]);
  return getCart(userId);
}

export function clearCart(userId) {
  run('DELETE FROM cart_items WHERE user_id = ?', [userId]);
  return getCart(userId);
}

/** 清理失效商品（下架/无库存），一次删掉 */
export function removeInvalid(userId) {
  const rows = all(
    `SELECT c.id, c.sku_id, p.stock AS p_stock, p.status, s.stock AS sku_stock
       FROM cart_items c JOIN products p ON p.id = c.product_id
       LEFT JOIN product_skus s ON s.id = c.sku_id AND c.sku_id > 0
      WHERE c.user_id = ?`, [userId],
  );
  let removed = 0;
  for (const r of rows) {
    const stock = r.sku_id > 0 ? r.sku_stock : r.p_stock;
    if (r.status !== 'active' || !stock) { run('DELETE FROM cart_items WHERE id = ?', [r.id]); removed += 1; }
  }
  return { removed, cart: getCart(userId) };
}

export { tx };
