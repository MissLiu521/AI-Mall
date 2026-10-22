/**
 * 全接口连通性巡检：逐一调用 97 个已注册路由，验证都能返回 2xx 且不出现 5xx。
 *
 * 用法（需先启动一个隔离实例）：
 *   DATA_DIR=C:/tmp/mall-qa2 PORT=3030 node server/src/index.js
 *   B=http://localhost:3030 node scripts/audit-endpoints.js
 *
 * 说明：本脚本只做"接口存在 + 鉴权正确 + 入参合法时可跑通"的判定，
 *      业务语义的深度断言由 verify-flows / verify-v2 / verify-review-* 等脚本负责。
 */
import fs from 'node:fs';

const B = process.env.B || 'http://localhost:3030';

let pass = 0;
let fail = 0;
const rows = [];

async function raw(method, path, { token, body, form, expect } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(B + path, { method, headers, body: payload });
  const text = await res.text();
  let json = {};
  try { json = JSON.parse(text); } catch { /* 非 JSON（如静态文件） */ }
  const exp = expect || [200, 201];
  const okStatus = exp.includes(res.status);
  if (okStatus) pass += 1; else fail += 1;
  rows.push({ method, path, status: res.status, expect: exp.join('/'), ok: okStatus, code: json.error?.code || '' });
  console.log(`${okStatus ? '✅' : '❌'} ${method.padEnd(6)} ${path}  ${res.status}${json.error?.code ? ' ' + json.error.code : ''}`);
  if (!okStatus) console.log(`     期望 ${exp.join('/')}，实际 ${res.status} ${json.error?.message || text.slice(0, 120)}`);
  return { status: res.status, ok: !!json.ok, data: json.data, error: json.error, text };
}

const call = (path, opts) => raw('GET', path, opts);

const login = async (email, password) => {
  const r = await raw('POST', '/api/auth/login', { body: { email, password } });
  if (!r.ok) throw new Error(`登录失败 ${email}: ${JSON.stringify(r.error)}`);
  return r.data.token;
};

(async () => {
  const ts = Date.now();
  const H = { 'Content-Type': 'application/json' };

  // ── 0. 无鉴权基础接口 ────────────────────────────────
  await call('/api/health');
  await call('/api/meta');
  const products = await call('/api/products?page=1&pageSize=6');
  const productId = products.data.items[0].id;
  const p1 = await call(`/api/products/${productId}`);
  const skuId = p1.data.skus[0]?.id;
  await call(`/api/products/${productId}/reviews?page=1`);
  await call(`/api/products/${productId}/review-tags`);
  await call(`/api/reviews/tag-options?productId=${productId}`);
  await call('/api/reviews/rules');
  const feeds = await call('/api/feed?page=1');
  const feedId = feeds.data.items?.[0]?.id || feeds.data[0]?.id;
  if (feedId) await call(`/api/feed/${feedId}`);
  await call('/api/flash-sales');
  const gbs = await call('/api/group-buys');
  const gbId = (gbs.data.items || gbs.data)[0]?.id;
  if (gbId) await call(`/api/group-buys/${gbId}`);
  await call('/api/rankings');
  await call('/api/shops');
  await call('/api/meta');

  // ── 1. 账号 ─────────────────────────────────────────
  const admin = await login('admin@mall.dev', 'admin123');
  const buyer = await login('demo@mall.dev', 'demo123');
  const qaEmail = `qa${ts}@mall.dev`;
  await raw('POST', '/api/auth/register', { body: { email: qaEmail, password: 'qa123456', name: '巡检用户' } });
  const qa = await login(qaEmail, 'qa123456');
  await call('/api/auth/me', { token: qa });

  // ── 2. 地址簿 ───────────────────────────────────────
  const addr1 = await raw('POST', '/api/addresses', {
    token: qa,
    body: { name: '巡检', phone: '13800138000', region: '北京市 北京市 朝阳区', detail: '建国路 88 号 SOHO 现代城 B 座 1203', isDefault: true },
  });
  const addrId = addr1.data.id;
  const addr2 = await raw('POST', '/api/addresses', {
    token: qa,
    body: { name: '临时', phone: '13900139000', region: '广东省 深圳市 南山区', detail: '科技园南路 18 号 A 栋 502' },
  });
  await call('/api/addresses', { token: qa });
  await raw('PATCH', `/api/addresses/${addr2.data.id}`, { token: qa, body: { name: '临时改' } });
  await raw('POST', `/api/addresses/${addr2.data.id}/default`, { token: qa });
  await raw('POST', `/api/addresses/${addrId}/default`, { token: qa });
  await raw('DELETE', `/api/addresses/${addr2.data.id}`, { token: qa });

  // ── 3. 购物车 ───────────────────────────────────────
  const cartAdd = await raw('POST', '/api/cart', { token: qa, body: { productId, skuId, qty: 1 } });
  const cartNow = await call('/api/cart', { token: qa });
  const cartItemId = cartNow.data?.items?.slice(-1)[0]?.cartId || cartNow.data?.items?.slice(-1)[0]?.id
    || cartAdd.data?.items?.slice(-1)[0]?.cartId || cartAdd.data?.id;
  await call('/api/cart', { token: qa });
  if (cartItemId) {
    await raw('PATCH', `/api/cart/${cartItemId}`, { token: qa, body: { qty: 2 } });
    await raw('PATCH', `/api/cart/${cartItemId}/select`, { token: qa, body: { selected: true } });
  }
  await raw('PATCH', '/api/cart/select-all', { token: qa, body: { selected: true } });
  await raw('DELETE', '/api/cart/invalid', { token: qa });
  if (cartItemId) await raw('DELETE', `/api/cart/${cartItemId}`, { token: qa });
  await raw('DELETE', '/api/cart', { token: qa });

  // ── 4. 收藏 / 足迹 / 券 / 资产 ────────────────────────
  await raw('POST', `/api/favorites/${productId}`, { token: qa });
  await call('/api/favorites', { token: qa });
  if (feedId) await raw('POST', `/api/feed/${feedId}/like`, { token: qa });
  await call('/api/footprints', { token: qa });
  await raw('DELETE', '/api/footprints', { token: qa });
  const coupons = await call('/api/coupons');
  const couponId = (coupons.data.items || coupons.data)[0]?.id;
  if (couponId) await raw('POST', `/api/coupons/${couponId}/claim`, { token: qa });
  await call('/api/my/coupons', { token: qa });
  await call('/api/wallet', { token: qa });
  await call('/api/points', { token: qa });
  await call('/api/my/teams', { token: qa });

  // ── 5. 下单全链路：预览 → 下单 → 支付 → 发货 → 收货 → 评价 ──
  await raw('POST', '/api/orders/preview', { token: qa, body: { productId, skuId, qty: 1 } });
  const order = await raw('POST', '/api/orders', {
    token: qa, body: { address: '北京市朝阳区建国路 88 号 SOHO B 座 1203（巡检 13800138000）', productId, skuId, qty: 1, idemKey: 'audit-' + ts },
  });
  const orderId = order.data.id;
  await call(`/api/orders/${orderId}`, { token: qa });
  await call(`/api/orders/${orderId}/eligibility`, { token: qa });
  await call(`/api/orders/${orderId}/reviews`, { token: qa });
  await raw('POST', `/api/orders/${orderId}/pay`, { token: qa, body: { method: 'wechat' } });
  await call(`/api/orders/${orderId}`, { token: qa });
  await raw('PATCH', `/api/admin/orders/${orderId}/ship`, { token: admin, body: { carrier: '顺丰速运', trackingNo: 'SF' + ts } });
  await raw('PATCH', `/api/admin/orders/${orderId}/shipment`, { token: admin, body: { carrier: '顺丰速运', trackingNo: 'SF' + ts + 'A' } });
  await raw('POST', `/api/orders/${orderId}/confirm`, { token: qa });
  const done = await call(`/api/orders/${orderId}`, { token: qa });
  const orderItemId = done.data.items[0].id;
  await call('/api/orders/mine', { token: qa });

  // 另一单：取消
  const orderX = await raw('POST', '/api/orders', {
    token: qa, body: { address: '北京市朝阳区建国路 88 号（巡检 13800138000）', productId, skuId, qty: 1, idemKey: 'audit-x-' + ts },
  });
  await raw('POST', `/api/orders/${orderX.data.id}/cancel`, { token: qa, body: { reason: '巡检取消' } });

  // 第三单：退款（买家申请 → 商家同意）
  const orderR = await raw('POST', '/api/orders', {
    token: qa, body: { address: '北京市朝阳区建国路 88 号（巡检 13800138000）', productId, skuId, qty: 1, idemKey: 'audit-r-' + ts },
  });
  await raw('POST', `/api/orders/${orderR.data.id}/pay`, { token: qa, body: { method: 'alipay' } });
  const rf = await raw('POST', `/api/orders/${orderR.data.id}/refund`, { token: qa, body: { reason: '巡检退款' } });
  await call('/api/admin/refunds', { token: admin });
  if (rf.data?.id) await raw('PATCH', `/api/admin/refunds/${rf.data.id}`, { token: admin, body: { approve: true, reason: '巡检通过' } });

  // 拼团下单
  if (gbId) {
    const grp = await raw('POST', '/api/orders/group', {
      token: qa, body: { groupBuyId: gbId, address: '北京市朝阳区建国路 88 号（巡检 13800138000）', idemKey: 'audit-g-' + ts },
    });
    if (grp.data?.order?.id) await raw('POST', `/api/orders/${grp.data.order.id}/cancel`, { token: qa, body: { reason: '巡检关闭' } });
  }

  // ── 6. 评价（含标签 / 分项 / 有用） ────────────────────
  const tagOpts = await call(`/api/reviews/tag-options?productId=${productId}`, { token: qa });
  const officialTag = tagOpts.data.tags?.[0];
  const review = await raw('POST', '/api/reviews', {
    token: qa,
    body: {
      orderId, orderItemId, rating: 5, content: '巡检提交：做工扎实，颜色正，物流很快，整体很满意。',
      media: [], dimensions: tagOpts.data.dimensions?.length ? { [tagOpts.data.dimensions[0].key]: 5 } : {},
      tags: officialTag ? [{ id: officialTag.id }] : [],
    },
  });
  const reviewId = review.data?.id;
  const list = await call(`/api/products/${productId}/reviews?page=1`);
  const anyReview = (list.data.items || [])[0]?.id || reviewId;
  if (anyReview) await raw('POST', `/api/reviews/${anyReview}/useful`, { token: qa });
  await call('/api/admin/reviews', { token: admin });
  if (reviewId) await raw('PATCH', `/api/admin/reviews/${reviewId}`, { token: admin, body: { reply: '感谢巡检用户的反馈！' } });

  // ── 7. 评价标签词库（后台） ────────────────────────────
  const tagAdmin = await call('/api/admin/review-tags', { token: admin });
  const targetTagId = officialTag?.id || (tagAdmin.data.items || tagAdmin.data || [])[0]?.id;
  const newTag = await raw('POST', '/api/admin/review-tags', {
    token: admin, body: { name: '巡检标签' + String(ts).slice(-3), dimension: 'quality', polarity: 'good', category: '' },
  });
  const tagId = newTag.data?.id;
  if (tagId) {
    await raw('PATCH', `/api/admin/review-tags/${tagId}`, { token: admin, body: { name: '巡检标签改' + String(ts).slice(-3) } });
    if (targetTagId) await raw('POST', `/api/admin/review-tags/${tagId}/merge`, { token: admin, body: { targetId: targetTagId } });
    await raw('DELETE', `/api/admin/review-tags/${tagId}`, { token: admin });
  }

  // ── 8. AI：对话 → 会话 → 消息 → 评分 → 转人工 ──────────
  const chat = await raw('POST', '/api/ai/chat', { token: qa, body: { scene: 'support', text: '我的订单到哪了？' } });
  const convId = chat.data?.conversationId;
  const msgId = chat.data?.messageId;
  await call('/api/ai/conversations', { token: qa });
  if (convId) await call(`/api/ai/conversations/${convId}/messages`, { token: qa });
  if (msgId) await raw('POST', `/api/ai/messages/${msgId}/rate`, { token: qa, body: { rating: 5 } });
  const ticket = await raw('POST', '/api/ai/handoff', {
    token: qa, body: { conversationId: convId, summary: '巡检转人工', contact: qaEmail },
  });
  await call('/api/admin/tickets', { token: admin });
  if (ticket.data?.id) await raw('PATCH', `/api/admin/tickets/${ticket.data.id}`, { token: admin, body: { reply: '已收到，马上处理。' } });
  await call('/api/admin/notify', { token: admin });

  // 后台 AI
  await call('/api/admin/ai/config', { token: admin });
  const cfg = await call('/api/admin/ai/config', { token: admin });
  await raw('PUT', '/api/admin/ai/config', { token: admin, body: { ...(cfg.data || {}), enabledScenes: cfg.data?.enabledScenes || ['shopping', 'support', 'ops'] } });
  await call('/api/admin/ai/stats', { token: admin });
  await call('/api/admin/ai/conversations', { token: admin });
  if (convId) await call(`/api/admin/ai/conversations/${convId}/messages`, { token: admin });
  await raw('POST', '/api/admin/ai/ops', { token: admin, body: { text: '看一下本月滞销商品' }, expect: [200, 201] });
  await raw('POST', '/api/admin/ai/product-draft', { token: admin, body: { hint: '巡检测试商品 99 元', seed: 0 }, expect: [200, 201] });
  await raw('POST', '/api/ai/draft/apply', { token: admin, body: { productId, subtitle: '巡检副标题', description: '巡检生成描述' } });

  // ── 9. 上传 ─────────────────────────────────────────
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const fd = new FormData();
  fd.append('file', new Blob([png], { type: 'image/png' }), 'qa.png');
  const up = await raw('POST', '/api/uploads', { token: qa, form: fd });
  if (up.data?.name) await call(`/api/uploads/${up.data.name}`);

  // ── 10. 后台商品 / 券 / 内容 / 知识库 / 看板 ───────────
  await call('/api/admin/products', { token: admin });
  const np = await raw('POST', '/api/admin/products', {
    token: admin, body: { title: '巡检商品' + ts, price: 99, stock: 10, category: '家居', subtitle: '巡检', description: '巡检用商品' },
  });
  if (np.data?.id) {
    await raw('PATCH', `/api/admin/products/${np.data.id}`, { token: admin, body: { price: 88 } });
    await raw('DELETE', `/api/admin/products/${np.data.id}`, { token: admin });
  }
  await call('/api/admin/orders', { token: admin });
  await call('/api/admin/coupons', { token: admin });
  await raw('POST', '/api/admin/coupons', {
    token: admin, body: { title: '巡检券' + String(ts).slice(-4), type: 'reduce', threshold: 100, value: 10, total: 10, days: 7 },
  });
  await call('/api/admin/feeds', { token: admin });
  const nf = await raw('POST', '/api/admin/feeds', {
    token: admin, body: { title: '巡检内容' + ts, body: '巡检内容正文', type: 'image', productIds: [productId] },
  });
  if (nf.data?.id) await raw('DELETE', `/api/admin/feeds/${nf.data.id}`, { token: admin });
  await call('/api/admin/kb', { token: admin });
  const kb = await raw('POST', '/api/admin/kb', { token: admin, body: { question: '巡检问题' + ts, answer: '巡检答案内容', tags: '巡检' } });
  if (kb.data?.id) {
    await raw('PATCH', `/api/admin/kb/${kb.data.id}`, { token: admin, body: { answer: '巡检答案已更新' } });
    await raw('DELETE', `/api/admin/kb/${kb.data.id}`, { token: admin });
  }
  await call('/api/admin/stats', { token: admin });

  // ── 汇总 ────────────────────────────────────────────
  console.log('\n════════ 全接口巡检结果 ════════');
  const bad = rows.filter((r) => !r.ok);
  console.log(`接口调用 ${rows.length} 次，通过 ${pass}，失败 ${fail}`);
  if (bad.length) {
    console.log('失败明细：');
    for (const b of bad) console.log(`  ❌ ${b.method} ${b.path} → ${b.status} ${b.code}（期望 ${b.expect}）`);
    process.exitCode = 1;
  }

  // 路由覆盖率：把源码里注册的路由与本次实际调用的路由做模式匹配
  const src = fs.readFileSync(new URL('../server/src/routes/index.js', import.meta.url), 'utf8');
  const declared = [...src.matchAll(/app\.(get|post|patch|put|delete)\('([^']+)'/g)]
    .map((m) => ({ method: m[1].toUpperCase(), path: m[2] }));
  const covered = (d) => {
    const re = new RegExp('^' + d.path.replace(/:[a-zA-Z]+/g, '[^/]+') + '$');
    return rows.some((r) => r.method === d.method && re.test(r.path.replace(/\?.*$/, '')));
  };
  const missing = declared.filter((d) => !covered(d));
  console.log(`路由覆盖：${declared.length - missing.length}/${declared.length}`);
  if (missing.length) {
    console.log('未覆盖路由：');
    for (const m of missing) console.log(`  ⚠️ ${m.method} ${m.path}`);
    process.exitCode = 1;
  }
})().catch((e) => {
  console.error('巡检异常终止：', e);
  process.exitCode = 1;
});
