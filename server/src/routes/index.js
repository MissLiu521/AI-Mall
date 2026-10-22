import { app, parseBody, ok, match } from '../lib/http.js';
import { authOptional, requireAuth, requireMerchant } from '../middleware/auth.js';
import * as users from '../services/users.js';
import * as products from '../services/products.js';
import * as cart from '../services/cart.js';
import * as orders from '../services/orders.js';
import * as addresses from '../services/addresses.js';
import * as support from '../services/support.js';
import * as promotions from '../services/promotions.js';
import * as reviews from '../services/reviews.js';
import * as reviewTags from '../services/review-tags.js';
import * as engagement from '../services/engagement.js';
import * as content from '../services/content.js';
import * as wallet from '../services/wallet.js';
import { parseMultipart, saveUpload, serveUpload } from '../lib/upload.js';
import * as runtime from '../ai/runtime.js';
import { draftProduct } from '../ai/product-drafter.js';
import { gatewayConfig } from '../ai/gateway.js';
import { all, get, run } from '../db/index.js';
import { AppError } from '../services/users.js';
import { int, str, oneOf, pageParams } from '../lib/validate.js';
import { toIso } from '../lib/time.js';
import { createLimiter, clientIp } from '../lib/rate-limit.js';

const qp = (url, k, d = '') => url.searchParams.get(k) ?? d;

// 登录/注册与 AI 对话限流：本地单实例内存版；生产多实例需换共享存储
const authLimiter = createLimiter({ windowMs: 60_000, max: 60, message: '登录尝试过于频繁，请稍后再试' });
const aiLimiter = createLimiter({ windowMs: 60_000, max: 60, message: 'AI 请求过于频繁，请稍后再试' });
const writeLimiter = createLimiter({ windowMs: 60_000, max: 120, message: '操作过于频繁，请稍后再试' });

const statusOf = (v) => (v ? oneOf(v, Object.keys(orders.ORDER_STATUS), { field: 'status' }) : '');

// ── 健康 & 元信息 ─────────────────────────────────────────
app.get('/api/health', (_req, _p, res) => {
  let db = 'up';
  try { get('SELECT 1 AS ok'); } catch { db = 'down'; }
  ok(res, { status: db === 'up' ? 'up' : 'degraded', db, ts: Date.now() });
});
app.get('/api/meta', (_req, _p, res) => ok(res, {
  ai: { enabled: gatewayConfig().enabled, model: gatewayConfig().model },
  categories: products.categories(),
  statuses: orders.ORDER_STATUS,
}));

// ── 鉴权 ────────────────────────────────────────────────
app.post('/api/auth/register', async (req, _p, res) => {
  authLimiter(clientIp(req));
  ok(res, users.register(await parseBody(req)));
});
app.post('/api/auth/login', async (req, _p, res) => {
  authLimiter(clientIp(req));
  ok(res, users.login(await parseBody(req)));
});
app.get('/api/auth/me', (req, _p, res) => ok(res, requireAuth(req)));

// ── 商品 ────────────────────────────────────────────────
app.get('/api/products', (req, _p, res, url) => {
  const { page, pageSize } = pageParams(url, { defSize: 12, maxSize: 60 });
  ok(res, products.listProducts({
    q: str(qp(url, 'q'), { field: '搜索词', max: 60 }),
    category: str(qp(url, 'category'), { field: '分类', max: 30 }),
    shopId: int(qp(url, 'shopId', 0), { field: '店铺 ID', min: 0, def: 0 }),
    sort: oneOf(qp(url, 'sort'), ['default', 'price_asc', 'price_desc', 'rating', 'new'], { field: '排序', def: 'default' }),
    page,
    pageSize,
    // explain=1 时额外返回 matchReasons（为什么推荐这件商品）
    explain: qp(url, 'explain') === '1',
  }));
});
app.get('/api/products/:id', (req, p, res) => {
  const u = authOptional(req);
  const id = int(p.id, { field: '商品 ID', min: 1 });
  const data = products.getProduct(id, u?.id ?? null);
  // 浏览即记足迹，不发额外请求
  if (u) engagement.recordFootprint(u.id, id);
  ok(res, data);
});
app.get('/api/rankings', (_req, _p, res) => ok(res, products.rankings()));
app.get('/api/shops', (_req, _p, res) => ok(res, products.listShops()));

// ── 评价 ────────────────────────────────────────────────
app.get('/api/products/:id/reviews', (_req, p, res, url) => {
  const { page, pageSize } = pageParams(url, { defSize: 10, maxSize: 50 });
  ok(res, reviews.listReviews(int(p.id, { field: '商品 ID', min: 1 }), {
    page, pageSize,
    rating: int(qp(url, 'rating', 0), { field: '星级', min: 0, max: 5, def: 0 }),
    withImage: qp(url, 'withImage') === '1' || qp(url, 'withMedia') === '1',
    tagId: int(qp(url, 'tagId', 0), { field: '标签 ID', min: 0, def: 0 }),
    tag: str(qp(url, 'tag'), { field: '标签', max: 20, def: '' }),
    dimension: str(qp(url, 'dimension'), { field: '维度', max: 20, def: '' }),
  }));
});

// 买家印象：维度均分 + 标签云（商品页/移动端共用）
app.get('/api/products/:id/review-tags', (_req, p, res) => {
  ok(res, reviewTags.productTagStats(int(p.id, { field: '商品 ID', min: 1 })));
});

// 评价弹窗的候选标签：按商品类目给出维度与官方词库
app.get('/api/reviews/tag-options', (_req, _p, res, url) => {
  ok(res, reviewTags.tagOptions(int(qp(url, 'productId'), { field: '商品 ID', min: 1 })));
});

app.post('/api/reviews', async (req, _p, res) => {
  const u = requireAuth(req);
  const b = await parseBody(req);
  ok(res, reviews.createReview(u.id, {
    orderId: int(b.orderId, { field: '订单 ID', min: 1 }),
    orderItemId: b.orderItemId ? int(b.orderItemId, { field: '订单商品 ID', min: 1 }) : null,
    rating: int(b.rating, { field: '评分', min: 1, max: 5 }),
    content: str(b.content, { field: '评价内容', max: 1000, def: '' }),
    images: Array.isArray(b.images) ? b.images.slice(0, 9).map((x) => String(x).slice(0, 300)) : [],
    video: str(b.video, { field: '视频地址', max: 300, def: '' }),
    videoCover: str(b.videoCover, { field: '视频封面', max: 300, def: '' }),
    // 标签既可以是词库 id，也可以是 { name } 自定义；校验与去重都在服务层
    tags: Array.isArray(b.tags) ? b.tags.slice(0, 40) : [],
    dimensions: b.dimensions && typeof b.dimensions === 'object' && !Array.isArray(b.dimensions)
      ? b.dimensions : {},
    anonymous: !!b.anonymous,
  }), 201);
});
app.post('/api/reviews/:id/useful', (req, p, res) => {
  requireAuth(req);
  ok(res, reviews.markUseful(int(p.id, { field: '评价 ID', min: 1 })));
});
// 返现规则给前端渲染"还差多少字 / 几张图能多返多少"，避免前端硬编码和服务端算不一致
app.get('/api/reviews/rules', (_req, _p, res) => ok(res, { ...reviews.REVIEW_REWARD_RULES }));

// ── 文件上传（评价晒图 / 短视频）──────────────────────────
app.post('/api/uploads', async (req, _p, res) => {
  writeLimiter(clientIp(req));
  requireAuth(req); // 先鉴权再读大 body，避免匿名请求占满内存
  const { files } = await parseMultipart(req);
  const file = files.find((f) => f.field === 'file') || files[0];
  ok(res, saveUpload(file), 201);
});
app.get('/api/uploads/:name', (req, p, res) => serveUpload(req, res, p.name));

// ── 内容流（逛逛）─────────────────────────────────────────
app.get('/api/feed', (req, _p, res, url) => {
  const { page, pageSize } = pageParams(url, { defSize: 10, maxSize: 30 });
  const u = authOptional(req);
  ok(res, content.listFeeds({ page, pageSize, userId: u?.id ?? null }));
});
app.get('/api/feed/:id', (req, p, res) => {
  const u = authOptional(req);
  ok(res, content.feedDetail(int(p.id, { field: '内容 ID', min: 1 }), u?.id ?? null));
});
app.post('/api/feed/:id/like', (req, p, res) => {
  const u = requireAuth(req);
  ok(res, content.toggleLike(int(p.id, { field: '内容 ID', min: 1 }), u.id));
});

// ── 营销：优惠券 / 秒杀 / 拼团 ─────────────────────────────
app.get('/api/coupons', (req, _p, res) => {
  const u = authOptional(req);
  ok(res, promotions.listCoupons(u?.id ?? null));
});
app.post('/api/coupons/:id/claim', (req, p, res) => {
  const u = requireAuth(req);
  ok(res, promotions.claimCoupon(u.id, int(p.id, { field: '优惠券 ID', min: 1 })), 201);
});
app.get('/api/my/coupons', (req, _p, res, url) => {
  const u = requireAuth(req);
  ok(res, promotions.myCoupons(u.id,
    qp(url, 'status') ? oneOf(qp(url, 'status'), ['unused', 'used', 'expired'], { field: '券状态' }) : ''));
});
app.get('/api/flash-sales', (_req, _p, res) => ok(res, promotions.listFlashSales()));
app.get('/api/group-buys', (_req, _p, res) => ok(res, promotions.listGroupBuys()));
app.get('/api/group-buys/:id', (req, p, res) => {
  const u = authOptional(req);
  ok(res, promotions.groupDetail(int(p.id, { field: '拼团 ID', min: 1 }), u?.id ?? null));
});

// ── 用户资产：收藏 / 足迹 / 积分 ────────────────────────────
app.get('/api/favorites', (req, _p, res, url) => {
  const u = requireAuth(req);
  const { page, pageSize } = pageParams(url, { defSize: 20, maxSize: 60 });
  ok(res, engagement.listFavorites(u.id, { page, pageSize }));
});
app.post('/api/favorites/:productId', (req, p, res) => {
  const u = requireAuth(req);
  ok(res, engagement.toggleFavorite(u.id, int(p.productId, { field: '商品 ID', min: 1 })));
});
app.get('/api/footprints', (req, _p, res, url) => {
  const u = requireAuth(req);
  const { page, pageSize } = pageParams(url, { defSize: 40, maxSize: 100 });
  ok(res, engagement.listFootprints(u.id, { page, pageSize }));
});
app.delete('/api/footprints', (req, _p, res) => ok(res, engagement.clearFootprints(requireAuth(req).id)));
app.get('/api/points', (req, _p, res) => ok(res, engagement.pointsInfo(requireAuth(req).id)));
app.get('/api/wallet', (req, _p, res, url) => {
  const { page, pageSize } = pageParams(url, { defSize: 20, maxSize: 50 });
  ok(res, wallet.wallet(requireAuth(req).id, { page, pageSize }));
});

// ── 收货地址簿 ──────────────────────────────────────────
app.get('/api/addresses', (req, _p, res) => ok(res, addresses.listAddresses(requireAuth(req).id)));
app.post('/api/addresses', async (req, _p, res) =>
  ok(res, addresses.createAddress(requireAuth(req).id, await parseBody(req)), 201));
app.patch('/api/addresses/:id', async (req, p, res) =>
  ok(res, addresses.updateAddress(requireAuth(req).id, p.id, await parseBody(req))));
app.delete('/api/addresses/:id', (req, p, res) =>
  ok(res, addresses.deleteAddress(requireAuth(req).id, p.id)));
app.post('/api/addresses/:id/default', (req, p, res) =>
  ok(res, addresses.setDefaultAddress(requireAuth(req).id, p.id)));

// ── 购物车 ──────────────────────────────────────────────
app.get('/api/cart', (req, _p, res) => ok(res, cart.getCart(requireAuth(req).id)));
app.post('/api/cart', async (req, _p, res) => {
  const body = await parseBody(req);
  ok(res, cart.addToCart(requireAuth(req).id, {
    productId: int(body.productId, { field: '商品 ID', min: 1 }),
    skuId: body.skuId ? int(body.skuId, { field: '规格 ID', min: 1 }) : 0,
    qty: int(body.qty ?? 1, { field: '数量', min: 1, max: 999 }),
  }));
});
// 注意：静态段必须先于 :id 注册，否则会被 :id 吃掉
app.patch('/api/cart/select-all', async (req, _p, res) => {
  const { selected } = await parseBody(req);
  ok(res, cart.selectAll(requireAuth(req).id, selected !== false));
});
app.delete('/api/cart/invalid', (req, _p, res) => ok(res, cart.removeInvalid(requireAuth(req).id)));
app.patch('/api/cart/:id/select', async (req, p, res) => {
  const { selected } = await parseBody(req);
  ok(res, cart.toggleSelect(requireAuth(req).id, int(p.id, { field: '购物车项 ID', min: 1 }), selected !== false));
});
app.patch('/api/cart/:id', async (req, p, res) => {
  const { qty } = await parseBody(req);
  ok(res, cart.updateCartItem(requireAuth(req).id, int(p.id, { field: '购物车项 ID', min: 1 }),
    int(qty, { field: '数量', min: 1, max: 999 })));
});
app.delete('/api/cart/:id', (req, p, res) =>
  ok(res, cart.removeCartItem(requireAuth(req).id, int(p.id, { field: '购物车项 ID', min: 1 }))));
app.delete('/api/cart', (req, _p, res) => ok(res, cart.clearCart(requireAuth(req).id)));

// ── 订单（C 端）──────────────────────────────────────────
// 结算预览：只算钱不写库，和真实下单共用同一套计价引擎
app.post('/api/orders/preview', async (req, _p, res) => {
  const u = requireAuth(req);
  const b = await parseBody(req);
  ok(res, orders.previewOrder(u.id, {
    items: Array.isArray(b.items)
      ? b.items.map((i) => ({
        productId: int(i.productId, { field: '商品 ID', min: 1 }),
        skuId: i.skuId ? int(i.skuId, { field: '规格 ID', min: 1 }) : null,
        qty: int(i.qty ?? 1, { field: '数量', min: 1, max: 999 }),
      }))
      : [],
    productId: b.productId ? int(b.productId, { field: '商品 ID', min: 1 }) : undefined,
    skuId: b.skuId ? int(b.skuId, { field: '规格 ID', min: 1 }) : null,
    qty: int(b.qty ?? 1, { field: '数量', min: 1, max: 999 }),
    userCouponId: b.userCouponId ? int(b.userCouponId, { field: '优惠券 ID', min: 1 }) : null,
    usePoints: int(b.usePoints ?? 0, { field: '积分', min: 0, max: 1000000, def: 0 }),
    useBalance: int(b.useBalance ?? 0, { field: '余额', min: 0, max: 100000000, def: 0 }),
    flashSaleId: b.flashSaleId ? int(b.flashSaleId, { field: '秒杀 ID', min: 1 }) : null,
    groupBuyId: b.groupBuyId ? int(b.groupBuyId, { field: '拼团 ID', min: 1 }) : null,
  }));
});

app.post('/api/orders', async (req, _p, res) => {
  writeLimiter(clientIp(req));
  const u = requireAuth(req);
  const body = await parseBody(req);
  const idemKey = req.headers['x-idempotency-key'] || body.idemKey || null;
  ok(res, orders.createOrder(u.id, {
    address: str(body.address, { field: '收货地址', min: 5, max: 300 }),
    remark: str(body.remark, { field: '备注', max: 300, def: '' }),
    productId: body.productId ? int(body.productId, { field: '商品 ID', min: 1 }) : undefined,
    skuId: body.skuId ? int(body.skuId, { field: '规格 ID', min: 1 }) : null,
    items: Array.isArray(body.items) && body.items.length
      ? body.items.map((i) => ({
        productId: int(i.productId, { field: '商品 ID', min: 1 }),
        skuId: i.skuId ? int(i.skuId, { field: '规格 ID', min: 1 }) : null,
        qty: int(i.qty ?? 1, { field: '数量', min: 1, max: 999 }),
      }))
      : null,
    qty: int(body.qty ?? 1, { field: '数量', min: 1, max: 1000000 }),
    idemKey: idemKey ? String(idemKey).slice(0, 80) : null,
    userCouponId: body.userCouponId ? int(body.userCouponId, { field: '优惠券 ID', min: 1 }) : null,
    usePoints: int(body.usePoints ?? 0, { field: '积分', min: 0, max: 1000000, def: 0 }),
    useBalance: int(body.useBalance ?? 0, { field: '余额', min: 0, max: 100000000, def: 0 }),
    flashSaleId: body.flashSaleId ? int(body.flashSaleId, { field: '秒杀 ID', min: 1 }) : null,
    aiAssisted: !!body.aiAssisted,
  }), 201);
});

// 拼团下单：开团与参团同一入口
app.post('/api/orders/group', async (req, _p, res) => {
  writeLimiter(clientIp(req));
  const u = requireAuth(req);
  const b = await parseBody(req);
  const idemKey = req.headers['x-idempotency-key'] || b.idemKey || null;
  ok(res, orders.createGroupOrder(u.id, {
    groupBuyId: int(b.groupBuyId, { field: '拼团 ID', min: 1 }),
    teamId: b.teamId ? int(b.teamId, { field: '团 ID', min: 1 }) : null,
    address: str(b.address, { field: '收货地址', min: 5, max: 300 }),
    idemKey: idemKey ? String(idemKey).slice(0, 80) : null,
  }), 201);
});
app.get('/api/my/teams', (req, _p, res) => ok(res, orders.myTeams(requireAuth(req).id)));
app.get('/api/orders/mine', (req, _p, res, url) => {
  const { page, pageSize } = pageParams(url, { defSize: 50, maxSize: 100 });
  ok(res, orders.myOrders(requireAuth(req).id, { page, pageSize }));
});
app.get('/api/orders/:id', (req, p, res) =>
  ok(res, orders.getOrderForUser(requireAuth(req).id, int(p.id, { field: '订单 ID', min: 1 }))));
app.post('/api/orders/:id/pay', (req, p, res) =>
  ok(res, orders.payOrder(requireAuth(req).id, int(p.id, { field: '订单 ID', min: 1 }))));
app.post('/api/orders/:id/cancel', async (req, p, res) => {
  const { reason } = await parseBody(req);
  ok(res, orders.cancelOrder(requireAuth(req).id, int(p.id, { field: '订单 ID', min: 1 }),
    str(reason, { field: '取消原因', max: 200, def: '' })));
});
app.post('/api/orders/:id/confirm', (req, p, res) =>
  ok(res, orders.confirmReceipt(requireAuth(req).id, int(p.id, { field: '订单 ID', min: 1 }))));
app.post('/api/orders/:id/refund', async (req, p, res) => {
  const u = requireAuth(req);
  const { reason } = await parseBody(req);
  ok(res, orders.createRefund(u.id, int(p.id, { field: '订单 ID', min: 1 }),
    str(reason, { field: '退款原因', max: 200, def: '用户申请退款' })), 201);
});
app.get('/api/orders/:id/eligibility', (req, p, res) =>
  ok(res, orders.checkReturnEligibility(requireAuth(req).id, int(p.id, { field: '订单 ID', min: 1 }))));
// 我在这一单里写过的评价（含分项评分与标签），用于订单详情回显
app.get('/api/orders/:id/reviews', (req, p, res) =>
  ok(res, reviews.reviewOfOrder(requireAuth(req).id, int(p.id, { field: '订单 ID', min: 1 }))));

// ── AI 对话 ─────────────────────────────────────────────
app.post('/api/ai/chat', async (req, _p, res) => {
  aiLimiter(`${clientIp(req)}:${req.headers.authorization || 'guest'}`);
  const user = authOptional(req);
  const body = await parseBody(req);
  const scene = oneOf(body.scene || 'support', ['shopping', 'support', 'ops'], { field: '场景', def: 'support' });
  if (scene === 'ops' && user?.role !== 'merchant') throw new AppError('FORBIDDEN', '仅商家可用运营智能体', 403);
  const out = await runtime.runAgent({
    userId: user?.id ?? null,
    role: user?.role ?? 'guest',
    scene,
    conversationId: body.conversationId ? int(body.conversationId, { field: '会话 ID', min: 1 }) : undefined,
    text: str(body.text, { field: '消息', min: 1, max: 2000 }),
  });
  ok(res, out);
});
app.get('/api/ai/conversations', (req, _p, res, url) => {
  const u = authOptional(req);
  ok(res, runtime.conversations(u?.id ?? null, qp(url, 'scene') || null));
});
app.get('/api/ai/conversations/:id/messages', (req, p, res) => {
  const u = authOptional(req);
  ok(res, runtime.messages(int(p.id, { field: '会话 ID', min: 1 }), u?.id ?? null, u?.role ?? 'guest'));
});
app.post('/api/ai/messages/:id/rate', async (req, p, res) => {
  const u = requireAuth(req);
  const { rating } = await parseBody(req);
  const msgId = int(p.id, { field: '消息 ID', min: 1 });
  const msg = get(
    `SELECT m.id, c.user_id FROM ai_messages m
       JOIN ai_conversations c ON c.id = m.conversation_id WHERE m.id = ?`,
    [msgId],
  );
  if (!msg) throw new AppError('NOT_FOUND', '消息不存在', 404);
  if (u.role !== 'merchant' && msg.user_id !== u.id) throw new AppError('FORBIDDEN', '无权评价该消息', 403);
  run('UPDATE ai_messages SET rating = ? WHERE id = ?', [int(rating, { field: '评分', min: 1, max: 5 }), msgId]);
  ok(res, { rated: true });
});
// AI 转人工：落工单，商家后台可处理
app.post('/api/ai/handoff', async (req, _p, res) => {
  const u = requireAuth(req);
  const body = await parseBody(req);
  ok(res, support.createTicket({
    userId: u.id,
    conversationId: body.conversationId,
    summary: body.summary,
    contact: body.contact || u.email,
  }), 201);
});
app.post('/api/ai/draft/apply', async (req, _p, res) => {
  const u = requireMerchant(req);
  const body = await parseBody(req);
  ok(res, runtime.applyDraft({
    userId: u.id, role: u.role,
    productId: int(body.productId, { field: '商品 ID', min: 1 }),
    subtitle: str(body.subtitle, { field: '副标题', max: 120, def: '' }),
    description: str(body.description, { field: '描述', max: 2000, def: '' }),
  }));
});

// ── B 端：看板 ───────────────────────────────────────────
app.get('/api/admin/stats', (req, _p, res) => {
  requireMerchant(req);
  const gmv = get("SELECT COALESCE(SUM(total_cents),0) s, COUNT(*) c FROM orders WHERE status IN ('paid','shipped','completed')");
  const totalOrders = get('SELECT COUNT(*) c FROM orders').c;
  const pendingShip = get("SELECT COUNT(*) c FROM orders WHERE status='paid'").c;
  const pendingRefund = get("SELECT COUNT(*) c FROM refunds WHERE status='pending'").c;
  const sku = get("SELECT COUNT(*) c FROM products WHERE status='active'").c;
  const lowStock = get('SELECT COUNT(*) c FROM products WHERE stock < 20').c;
  const usersCount = get('SELECT COUNT(*) c FROM users').c;
  const topProducts = all('SELECT id, title, sales, stock, price_cents FROM products ORDER BY sales DESC LIMIT 5')
    .map((p) => ({ id: p.id, title: p.title, sales: p.sales, stock: p.stock, price: p.price_cents / 100 }));
  // 只统计真正成交的订单：按支付时间归日，避免未支付/已取消订单把 GMV 抬高
  const trend = all(
    `SELECT substr(COALESCE(paid_at, created_at),1,10) d, COUNT(*) c, SUM(total_cents) s FROM orders
     WHERE status IN ('paid','shipped','completed')
       AND COALESCE(paid_at, created_at) >= datetime('now','-14 days')
     GROUP BY d ORDER BY d`,
  ).map((r) => ({ date: r.d, orders: r.c, gmv: +(r.s / 100).toFixed(2) }));

  ok(res, {
    gmv: +(gmv.s / 100).toFixed(2),
    paidOrders: gmv.c,
    totalOrders,
    avgOrderValue: gmv.c ? +(gmv.s / gmv.c / 100).toFixed(2) : 0,
    pendingShip, pendingRefund, sku, lowStock, users: usersCount,
    openTickets: support.openTicketCount(),
    // 商城 2.0 经营指标
    reviewCount: get('SELECT COUNT(*) c FROM reviews').c,
    avgRating: +(get('SELECT COALESCE(AVG(rating),0) a FROM reviews').a || 0).toFixed(2),
    couponClaimed: get('SELECT COUNT(*) c FROM user_coupons').c,
    activeFlash: get("SELECT COUNT(*) c FROM flash_sales WHERE status='active' AND end_at > datetime('now')").c,
    formingTeams: get("SELECT COUNT(*) c FROM group_teams WHERE status='forming'").c,
    topProducts, trend,
    ai: runtime.aiStats(),
  });
});

// ── B 端：商品 ───────────────────────────────────────────
app.get('/api/admin/products', (req, _p, res, url) => {
  requireMerchant(req);
  const { page, pageSize } = pageParams(url, { defSize: 50, maxSize: 200 });
  ok(res, products.listProducts({
    q: str(qp(url, 'q'), { field: '搜索词', max: 60 }),
    category: str(qp(url, 'category'), { field: '分类', max: 30 }),
    page, pageSize, includeInactive: true,
  }));
});
app.post('/api/admin/products', async (req, _p, res) => {
  requireMerchant(req);
  const body = await parseBody(req);
  ok(res, products.createProduct({ ...body, title: str(body.title, { field: '商品标题', min: 1, max: 80 }) }, { admin: true }), 201);
});
app.patch('/api/admin/products/:id', async (req, p, res) => {
  requireMerchant(req);
  const body = await parseBody(req);
  if (body.title !== undefined) body.title = str(body.title, { field: '商品标题', min: 1, max: 80 });
  ok(res, products.updateProduct(int(p.id, { field: '商品 ID', min: 1 }), body, { admin: true }));
});
app.delete('/api/admin/products/:id', (req, p, res) => {
  requireMerchant(req);
  ok(res, products.deleteProduct(int(p.id, { field: '商品 ID', min: 1 }), { admin: true }));
});

// ── B 端：订单 / 退款 ────────────────────────────────────
app.get('/api/admin/orders', (req, _p, res, url) => {
  requireMerchant(req);
  const { page, pageSize } = pageParams(url, { defSize: 50, maxSize: 200 });
  ok(res, orders.allOrders({
    status: statusOf(qp(url, 'status')),
    q: str(qp(url, 'q'), { field: '搜索词', max: 60 }),
    page, pageSize,
  }));
});
app.patch('/api/admin/orders/:id/ship', async (req, p, res) => {
  requireMerchant(req);
  const body = await parseBody(req);
  ok(res, orders.shipOrder(int(p.id, { field: '订单 ID', min: 1 }), {
    carrier: str(body.carrier, { field: '承运商', max: 40, def: '' }),
    trackingNo: str(body.trackingNo, { field: '运单号', max: 60, def: '' }),
  }));
});
// 推进物流节点：本地演示用，模拟快递在途
app.patch('/api/admin/orders/:id/shipment', (req, p, res) => {
  requireMerchant(req);
  ok(res, orders.advanceShipment(int(p.id, { field: '订单 ID', min: 1 })));
});

// ── B 端：评价 / 内容 / 营销 ──────────────────────────────
app.get('/api/admin/reviews', (req, _p, res, url) => {
  requireMerchant(req);
  const { page, pageSize } = pageParams(url, { defSize: 20, maxSize: 100 });
  ok(res, reviews.adminListReviews({
    page, pageSize,
    rating: int(qp(url, 'rating', 0), { field: '星级', min: 0, max: 5, def: 0 }),
    q: str(qp(url, 'q'), { field: '搜索词', max: 60 }),
    tagId: int(qp(url, 'tagId', 0), { field: '标签 ID', min: 0, def: 0 }),
    category: str(qp(url, 'category'), { field: '商品分类', max: 20, def: '' }),
    dimension: str(qp(url, 'dimension'), { field: '维度', max: 20, def: '' }),
  }));
});
app.patch('/api/admin/reviews/:id', async (req, p, res) => {
  requireMerchant(req);
  const { reply } = await parseBody(req);
  ok(res, reviews.replyReview(int(p.id, { field: '评价 ID', min: 1 }),
    str(reply, { field: '回复', min: 1, max: 500 })));
});

// ── B 端：评价标签词库 ────────────────────────────────────
const TAG_DIMENSIONS = Object.keys(reviewTags.DIMENSIONS);
app.get('/api/admin/review-tags', (req, _p, res, url) => {
  requireMerchant(req);
  const { page, pageSize } = pageParams(url, { defSize: 30, maxSize: 100 });
  ok(res, reviewTags.adminListTags({
    page, pageSize,
    q: str(qp(url, 'q'), { field: '搜索词', max: 30, def: '' }),
    status: qp(url, 'status') ? oneOf(qp(url, 'status'), ['active', 'pending', 'blocked'], { field: '状态' }) : '',
    dimension: qp(url, 'dimension') ? str(qp(url, 'dimension'), { field: '维度', max: 60, def: '' }) : '',
    category: qp(url, 'category') === '' ? undefined : str(qp(url, 'category'), { field: '类目', max: 20, def: '' }),
  }));
});
app.post('/api/admin/review-tags', async (req, _p, res) => {
  requireMerchant(req);
  const b = await parseBody(req);
  ok(res, reviewTags.createTag({
    name: str(b.name, { field: '标签名', min: 2, max: 8 }),
    // 维度/类目均支持多选（数组或逗号分隔），由服务层归一化校验
    dimension: b.dimension ?? b.dimensions ?? 'appearance',
    polarity: oneOf(b.polarity, ['good', 'bad', 'neutral'], { field: '褒贬', def: 'good' }),
    category: b.category ?? b.categories ?? '',
    status: oneOf(b.status, ['active', 'pending', 'blocked'], { field: '状态', def: 'active' }),
    sort: int(b.sort ?? 0, { field: '排序', min: 0, max: 9999, def: 0 }),
  }), 201);
});
app.patch('/api/admin/review-tags/:id', async (req, p, res) => {
  requireMerchant(req);
  const b = await parseBody(req);
  ok(res, reviewTags.updateTag(int(p.id, { field: '标签 ID', min: 1 }), {
    ...(b.name !== undefined ? { name: str(b.name, { field: '标签名', min: 2, max: 8 }) } : {}),
    ...(b.dimension !== undefined || b.dimensions !== undefined
      ? { dimension: b.dimension ?? b.dimensions } : {}),
    ...(b.polarity !== undefined ? { polarity: oneOf(b.polarity, ['good', 'bad', 'neutral'], { field: '褒贬' }) } : {}),
    ...(b.category !== undefined || b.categories !== undefined
      ? { category: b.category ?? b.categories } : {}),
    ...(b.status !== undefined ? { status: oneOf(b.status, ['active', 'pending', 'blocked'], { field: '状态' }) } : {}),
    ...(b.sort !== undefined ? { sort: int(b.sort, { field: '排序', min: 0, max: 9999 }) } : {}),
  }));
});
app.delete('/api/admin/review-tags/:id', (req, p, res) => {
  requireMerchant(req);
  ok(res, reviewTags.deleteTag(int(p.id, { field: '标签 ID', min: 1 })));
});
app.post('/api/admin/review-tags/:id/merge', async (req, p, res) => {
  requireMerchant(req);
  const b = await parseBody(req);
  ok(res, reviewTags.mergeTag(
    int(p.id, { field: '源标签 ID', min: 1 }),
    int(b.targetId, { field: '目标标签 ID', min: 1 }),
  ));
});

app.get('/api/admin/feeds', (req, _p, res, url) => {
  requireMerchant(req);
  const { page, pageSize } = pageParams(url, { defSize: 20, maxSize: 100 });
  ok(res, content.adminListFeeds({ page, pageSize }));
});
app.post('/api/admin/feeds', async (req, _p, res) => {
  const u = requireMerchant(req);
  const b = await parseBody(req);
  ok(res, content.createFeed({
    authorId: u.id,
    authorName: u.name || '官方账号',
    type: oneOf(b.type, ['image', 'video', 'article'], { field: '内容类型', def: 'image' }),
    title: str(b.title, { field: '标题', min: 2, max: 80 }),
    body: str(b.body, { field: '正文', max: 2000, def: '' }),
    cover: str(b.cover, { field: '封面', max: 8, def: '' }),
    media: str(b.media, { field: '视觉样式', max: 200, def: '' }),
    productIds: Array.isArray(b.productIds) ? b.productIds.map((x) => int(x, { field: '商品 ID', min: 1 })) : [],
  }), 201);
});
app.delete('/api/admin/feeds/:id', (req, p, res) => {
  requireMerchant(req);
  ok(res, content.removeFeed(int(p.id, { field: '内容 ID', min: 1 })));
});

app.get('/api/admin/coupons', (req, _p, res) => {
  requireMerchant(req);
  ok(res, promotions.listCoupons(null));
});
app.post('/api/admin/coupons', async (req, _p, res) => {
  requireMerchant(req);
  const b = await parseBody(req);
  const type = oneOf(b.type, ['reduce', 'discount', 'free_ship'], { field: '券类型', def: 'reduce' });
  const threshold = int(Math.round(Number(b.threshold || 0) * 100), { field: '门槛', min: 0, max: 100000000 });
  const value = type === 'reduce'
    ? int(Math.round(Number(b.value || 0) * 100), { field: '面额', min: 1, max: 100000000 })
    : int(b.value ?? 90, { field: '折扣值', min: 1, max: 99 });
  const { lastId } = run(
    `INSERT INTO coupons (title, type, threshold_cents, value, max_discount_cents, total, per_user, category, end_at)
     VALUES (?,?,?,?,?,?,?,?, datetime('now', ?))`,
    [str(b.title, { field: '券名称', min: 2, max: 40 }), type, threshold, value,
      b.maxDiscount ? Math.round(Number(b.maxDiscount) * 100) : 0,
      int(b.total ?? 1000, { field: '总量', min: 1, max: 1000000 }),
      int(b.perUser ?? 1, { field: '每人限领', min: 1, max: 20 }),
      str(b.category, { field: '适用品类', max: 20, def: '' }),
      `+${int(b.days ?? 30, { field: '有效天数', min: 1, max: 365 })} days`],
  );
  ok(res, get('SELECT * FROM coupons WHERE id = ?', [lastId]), 201);
});
app.get('/api/admin/refunds', (req, _p, res, url) => {
  requireMerchant(req);
  const { page, pageSize } = pageParams(url, { defSize: 50, maxSize: 200 });
  ok(res, orders.listRefunds({
    status: qp(url, 'status') ? oneOf(qp(url, 'status'), ['pending', 'approved', 'rejected'], { field: '退款状态' }) : '',
    page, pageSize,
  }));
});
app.patch('/api/admin/refunds/:id', async (req, p, res) => {
  const u = requireMerchant(req);
  const { approve, reason } = await parseBody(req);
  ok(res, orders.decideRefund(int(p.id, { field: '退款单 ID', min: 1 }), !!approve,
    str(reason, { field: '驳回原因', max: 200, def: '' }), u.name || '商家'));
});

// ── B 端：商家消息提醒（新订单等）─────────────────────────
app.get('/api/admin/notify', (req, _p, res, url) => {
  requireMerchant(req);
  // since：上次已读时间（ISO 或 'YYYY-MM-DD HH:MM:SS'），缺省取最近 10 分钟
  const sinceRaw = qp(url, 'since') || '';
  const since = sinceRaw.replace('T', ' ').slice(0, 19);
  const sinceClause = since ? 'WHERE created_at > ?' : "WHERE created_at > datetime('now', '-10 minutes')";
  const newOrders = all(
    `SELECT id, order_no, total_cents, created_at FROM orders
      ${sinceClause} AND status != 'pending_payment' ORDER BY id DESC LIMIT 10`,
    since ? [since] : [],
  ).map((o) => ({ id: o.id, orderNo: o.order_no, total: +(o.total_cents / 100).toFixed(2), createdAt: toIso(o.created_at) }));
  const pendingRefunds = get("SELECT COUNT(*) c FROM refunds WHERE status = 'pending'").c;
  const pendingTags = get("SELECT COUNT(*) c FROM review_tags WHERE status = 'pending'").c;
  ok(res, { newOrders, pendingRefunds, pendingTags, now: toIso(new Date()) });
});

// ── B 端：人工工单 ──────────────────────────────────────
app.get('/api/admin/tickets', (req, _p, res, url) => {
  requireMerchant(req);
  const { page, pageSize } = pageParams(url, { defSize: 50, maxSize: 200 });
  ok(res, support.listTickets({
    status: qp(url, 'status') ? oneOf(qp(url, 'status'), ['open', 'resolved'], { field: '工单状态' }) : '',
    page, pageSize,
  }));
});
app.patch('/api/admin/tickets/:id', async (req, p, res) => {
  requireMerchant(req);
  const { reply } = await parseBody(req);
  ok(res, support.resolveTicket(p.id, str(reply, { field: '回复', max: 500, def: '' })));
});

// ── B 端：AI 管理 ────────────────────────────────────────
app.get('/api/admin/ai/conversations', (req, _p, res, url) => {
  requireMerchant(req);
  ok(res, runtime.conversations(null, qp(url, 'scene') || null));
});
app.get('/api/admin/ai/conversations/:id/messages', (req, p, res) => {
  requireMerchant(req);
  ok(res, runtime.messages(int(p.id, { field: '会话 ID', min: 1 }), null, 'merchant'));
});
app.get('/api/admin/ai/config', (req, _p, res) => {
  requireMerchant(req);
  const rows = all('SELECT key, value FROM ai_config');
  const cfg = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  ok(res, {
    ...cfg,
    keyConfigured: gatewayConfig().enabled,
    model: gatewayConfig().model,
    baseUrlHint: process.env.AI_BASE_URL ? process.env.AI_BASE_URL.replace(/\/\/[^/]+/, '//***') : '未配置',
  });
});
app.put('/api/admin/ai/config', async (req, _p, res) => {
  requireMerchant(req);
  const body = await parseBody(req);
  const allow = ['model', 'temperature', 'persona', 'allow_refund'];
  for (const k of allow) {
    if (body[k] !== undefined) {
      let value = String(body[k]);
      if (k === 'model') value = str(body[k], { field: '模型名', min: 1, max: 80 });
      if (k === 'temperature') value = String(Math.min(1.2, Math.max(0, Number(body[k]) || 0.6)));
      if (k === 'persona') value = str(body[k], { field: '人设', max: 2000, def: '' });
      if (k === 'allow_refund') value = body[k] === true || body[k] === 'true' ? 'true' : 'false';
      run('INSERT INTO ai_config (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [k, value]);
    }
  }
  ok(res, { updated: true });
});
app.get('/api/admin/ai/stats', (req, _p, res) => {
  requireMerchant(req);
  ok(res, runtime.aiStats());
});
app.get('/api/admin/kb', (req, _p, res) => { requireMerchant(req); ok(res, all('SELECT * FROM kb_entries ORDER BY id')); });
app.post('/api/admin/kb', async (req, _p, res) => {
  requireMerchant(req);
  const body = await parseBody(req);
  const question = str(body.question, { field: '问题', min: 2, max: 200 });
  const answer = str(body.answer, { field: '答案', min: 2, max: 2000 });
  const tags = str(body.tags, { field: '标签', max: 100, def: '' });
  const { lastId } = run('INSERT INTO kb_entries (question, answer, tags) VALUES (?,?,?)', [question, answer, tags]);
  ok(res, get('SELECT * FROM kb_entries WHERE id = ?', [lastId]), 201);
});
app.patch('/api/admin/kb/:id', async (req, p, res) => {
  requireMerchant(req);
  const body = await parseBody(req);
  const id = int(p.id, { field: '知识库 ID', min: 1 });
  const row = get('SELECT * FROM kb_entries WHERE id = ?', [id]);
  if (!row) throw new AppError('NOT_FOUND', '条目不存在', 404);
  run('UPDATE kb_entries SET question = ?, answer = ?, tags = ? WHERE id = ?', [
    body.question !== undefined ? str(body.question, { field: '问题', min: 2, max: 200 }) : row.question,
    body.answer !== undefined ? str(body.answer, { field: '答案', min: 2, max: 2000 }) : row.answer,
    body.tags !== undefined ? str(body.tags, { field: '标签', max: 100, def: '' }) : row.tags,
    id,
  ]);
  ok(res, get('SELECT * FROM kb_entries WHERE id = ?', [id]));
});
app.delete('/api/admin/kb/:id', (req, p, res) => {
  requireMerchant(req);
  run('DELETE FROM kb_entries WHERE id = ?', [int(p.id, { field: '知识库 ID', min: 1 })]);
  ok(res, { deleted: true });
});

// ── 运营智能体（独立入口）──────────────────────────────────
app.post('/api/admin/ai/ops', async (req, _p, res) => {
  const u = requireMerchant(req);
  aiLimiter(`${clientIp(req)}:merchant`);
  const { text, conversationId } = await parseBody(req);
  ok(res, await runtime.runAgent({
    userId: u.id, role: u.role, scene: 'ops',
    conversationId: conversationId ? int(conversationId, { field: '会话 ID', min: 1 }) : undefined,
    text: str(text, { field: '消息', min: 1, max: 2000 }),
  }));
});

// ── 商品信息智能起草（新增商品 AI 填充）────────────────────
app.post('/api/admin/ai/product-draft', async (req, _p, res) => {
  requireMerchant(req);
  const b = await parseBody(req);
  const partial = {};
  if (b.partial && typeof b.partial === 'object') {
    if (b.partial.title) partial.title = str(b.partial.title, { field: '标题', max: 40, def: '' });
    if (b.partial.category) partial.category = str(b.partial.category, { field: '分类', max: 20, def: '' });
    if (b.partial.subtitle) partial.subtitle = str(b.partial.subtitle, { field: '副标题', max: 60, def: '' });
    if (b.partial.description) partial.description = str(b.partial.description, { field: '描述', max: 1000, def: '' });
    if (b.partial.price) partial.price = int(b.partial.price, { field: '价格', min: 0, max: 999999, def: 0 });
    if (b.partial.stock) partial.stock = int(b.partial.stock, { field: '库存', min: 0, max: 999999, def: 0 });
  }
  ok(res, await draftProduct({
    hint: str(b.hint, { field: '商品描述', min: 1, max: 500 }),
    seed: int(b.seed ?? 0, { field: 'seed', min: 0, max: 9999, def: 0 }),
    partial: {
      ...partial,
      imageHint: b.imageName ? str(b.imageName, { field: '图片线索', max: 120, def: '' }) : '',
    },
  }));
});

// ── 静态资源（生产环境托管前端构建产物）────────────────────
export function serveStatic(req, res, distDir, url) {
  return import('node:fs').then(async (fs) => {
    const path = await import('node:path');
    const root = path.resolve(distDir);
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return false;
    }
    // 拒绝空字节与穿越序列；解析后必须仍位于 dist 目录内
    if (pathname.includes('\0')) return false;
    let filePath = path.resolve(root, '.' + pathname);
    if (filePath !== root && !filePath.startsWith(root + path.sep)) return false;

    const exists = fs.existsSync(filePath);
    const isDir = exists && fs.statSync(filePath).isDirectory();
    if (!exists || isDir) {
      // 只对无扩展名的前端路由回退 index.html；缺失的静态资源必须 404
      if (path.extname(pathname)) return false;
      filePath = path.join(root, 'index.html');
      if (!fs.existsSync(filePath)) return false;
    }

    const ext = path.extname(filePath).toLowerCase();
    const types = {
      '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2',
      '.ico': 'image/x-icon', '.json': 'application/json', '.map': 'application/json',
    };
    const stat = fs.statSync(filePath);
    res.writeHead(200, {
      'Content-Type': types[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      // 带指纹的 assets 可长缓存；index.html 不缓存，避免发版后拿到旧入口
      'Cache-Control': filePath.includes(`${path.sep}assets${path.sep}`)
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(filePath).pipe(res);
    return true;
  });
}

export { match };
