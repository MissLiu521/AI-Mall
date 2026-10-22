/**
 * AI 工具集（Function Calling）
 * 每个工具：{ name, description, parameters, scenes[], run(ctx, args) }
 * ctx = { userId, scene }
 */
import { all, get, run } from '../db/index.js';
import { listProducts, getProduct } from '../services/products.js';
import { myOrders, findOrderByNo, checkReturnEligibility, createRefund, previewOrder } from '../services/orders.js';
import { searchProducts } from '../services/search.js';
import { AppError } from '../services/users.js';

const TOOL_TIMEOUT = 3000;
const MAX_RESULT = 4000;

function withTimeout(promise, ms = TOOL_TIMEOUT) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('工具执行超时')), ms)),
  ]);
}

function clip(obj) {
  const s = JSON.stringify(obj);
  return s.length > MAX_RESULT ? JSON.parse(JSON.stringify({ truncated: true, preview: s.slice(0, MAX_RESULT) })) : obj;
}

export const TOOLS = [
  {
    name: 'search_products',
    description: '按用户需求搜索在售商品。支持自然语言描述（如"送女朋友的礼物 200 元以内"）。',
    scenes: ['shopping', 'support'],
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词或需求描述' },
        category: { type: 'string', description: '可选分类过滤' },
        limit: { type: 'integer', description: '返回数量，默认 5' },
      },
      required: ['query'],
    },
    run: async (_ctx, args) => {
      const rows = all("SELECT * FROM products WHERE status = 'active'");
      const { items } = searchProducts(rows, args.query || '', { limit: Math.min(8, args.limit || 5) });
      // 让模型能说清"为什么推荐它"，而不是只报商品名
      const shaped = items.map((i) => ({
        id: i.id, title: i.title, price: i.price, category: i.category,
        tags: i.tags, stock: i.stock, rating: i.rating,
        matchReason: (i.matchReasons || []).map((r) => r.text).join('；') || '综合相关',
      }));
      if (args.category) {
        const f = shaped.filter((i) => i.category === args.category);
        return clip({ total: f.length, items: f.length ? f : shaped, note: f.length ? undefined : '该品类下无完全匹配，已返回最相关的跨品类结果' });
      }
      return clip({ total: shaped.length, items: shaped, empty: shaped.length === 0 });
    },
  },
  {
    name: 'get_product_detail',
    description: '获取单个商品的完整信息（价格、库存、卖点、描述）。',
    scenes: ['shopping', 'support'],
    parameters: {
      type: 'object',
      properties: { productId: { type: 'integer' } },
      required: ['productId'],
    },
    run: async (_ctx, args) => clip(getProduct(args.productId)),
  },
  {
    name: 'compare_products',
    description: '同品类商品对比：按商品 ID 或需求描述找出基准商品，返回它与竞品的价格、评分、销量对齐表，并直接给出「最便宜」「口碑最好」结论。用户问"哪个好""有什么区别""帮我比一下"时使用。',
    scenes: ['shopping', 'support'],
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'integer', description: '基准商品 ID（可选）' },
        query: { type: 'string', description: '没有 ID 时用需求描述找基准商品' },
      },
      required: [],
    },
    run: async (_ctx, args) => {
      let base = null;
      if (args.productId) base = getProduct(args.productId);
      else if (args.query) {
        const rows = all("SELECT * FROM products WHERE status = 'active'");
        const { items } = searchProducts(rows, args.query, { limit: 1 });
        if (items[0]) base = getProduct(items[0].id);
      }
      if (!base) return clip({ found: false, message: '没找到可用于对比的商品，请给一个商品 ID 或更具体的描述' });

      const rows = [base, ...(base.compare || [])]
        .filter((p) => p && p.price != null)
        .map((p) => ({
          id: p.id,
          title: p.title,
          price: p.price,
          rating: p.rating,
          sales: p.sales,
          inStock: p.inStock !== undefined ? p.inStock : (p.totalStock ?? p.stock) > 0,
        }));
      if (rows.length < 2) return clip({ found: false, message: '该商品暂时没有同品类竞品可对比' });

      // 结论在工具层算好，模型只负责组织语言，避免它编造"最便宜"
      const cheapest = rows.reduce((a, b) => (b.price < a.price ? b : a));
      const bestRated = rows.reduce((a, b) => (b.rating > a.rating ? b : a));
      const hottest = rows.reduce((a, b) => (b.sales > a.sales ? b : a));
      return clip({
        found: true,
        category: base.category,
        baseId: base.id,
        rows,
        verdict: {
          cheapestId: cheapest.id,
          bestRatedId: bestRated.id,
          hottestId: hottest.id,
          note: `最便宜：${cheapest.title}（¥${cheapest.price}）；口碑最好：${bestRated.title}（${bestRated.rating} 分）；卖得最多：${hottest.title}（${hottest.sales} 件）`,
        },
      });
    },
  },
  {
    name: 'quote_order',
    description: '按当前用户的会员等级、优惠券、跨店满减与积分，算出这笔订单最终实付多少，并返回可用券、积分上限与"再买多少能享下一档满减"。用户问"能便宜多少""怎么买最省""用哪张券""还差多少满减"时使用。',
    scenes: ['shopping', 'support'],
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'integer' },
        skuId: { type: 'integer', description: '规格 ID（可选，不传用默认规格）' },
        qty: { type: 'integer', description: '数量，默认 1' },
        usePoints: { type: 'integer', description: '想用的积分数（可选）' },
        userCouponId: { type: 'integer', description: '想用的券 ID（可选）' },
      },
      required: ['productId'],
    },
    run: async (ctx, args) => {
      if (!ctx.userId) return clip({ needLogin: true, message: '登录后才能按会员等级与券包算价' });
      const r = previewOrder(ctx.userId, {
        productId: args.productId,
        skuId: args.skuId || null,
        qty: Math.max(1, Number(args.qty) || 1),
        userCouponId: args.userCouponId || null,
        usePoints: Math.max(0, Number(args.usePoints) || 0),
      });
      const usable = (r.coupons || []).filter((c) => c.usable);
      const best = usable.slice().sort((a, b) => b.discount - a.discount)[0] || null;
      return clip({
        login: true,
        lines: r.items.map((i) => ({ title: i.title, specText: i.specText, unitPrice: +(i.priceCents / 100).toFixed(2), qty: i.qty })),
        subtotal: r.display.subtotal,
        total: r.display.total,
        saved: r.display.saved,
        level: r.level.label,
        steps: r.steps.map((s) => ({ label: s.label, amount: +(s.cents / 100).toFixed(2), note: s.note })),
        bestCoupon: best ? { userCouponId: best.userCouponId, title: best.title, discount: best.discount } : null,
        usableCoupons: usable.map((c) => ({ userCouponId: c.userCouponId, title: c.title, discount: c.discount, freeShip: c.freeShip })),
        points: { balance: r.pointsBalance, used: r.pointsUsed },
        nextFullCut: r.next,
      });
    },
  },
  {
    name: 'get_my_orders',
    description: '查询当前登录用户自己的订单列表。用户问"我的订单""我买的东西"时使用。',
    scenes: ['support'],
    permissions: 'customer',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'integer', description: '默认 5' } },
    },
    run: async (ctx, args) => {
      if (!ctx.userId) throw new AppError('NEED_LOGIN', '需要登录后才能查询订单');
      const list = myOrders(ctx.userId).slice(0, Math.min(10, args.limit || 5));
      return clip(list.map((o) => ({
        orderId: o.id, orderNo: o.orderNo, status: o.status, statusLabel: o.statusLabel,
        total: o.total, items: o.items.map((i) => `${i.title}×${i.qty}`), createdAt: o.createdAt,
      })));
    },
  },
  {
    name: 'get_order_detail',
    description: '按订单号查询订单详情，包含物流状态与商品明细。',
    scenes: ['support'],
    permissions: 'customer',
    parameters: {
      type: 'object',
      properties: { orderNo: { type: 'string', description: '订单号，如 AIM20261001001' } },
      required: ['orderNo'],
    },
    run: async (ctx, args) => {
      if (!ctx.userId) throw new AppError('NEED_LOGIN', '需要登录后才能查询订单');
      const o = findOrderByNo(ctx.userId, String(args.orderNo).trim().toUpperCase());
      if (!o) return { found: false, message: '未找到该订单号，请确认后重试' };
      return clip({
        found: true, orderNo: o.orderNo, status: o.statusLabel, total: o.total,
        address: o.address, createdAt: o.createdAt, shippedAt: o.shippedAt,
        items: o.items, aiAssisted: o.aiAssisted, orderId: o.id,
      });
    },
  },
  {
    name: 'check_return_eligibility',
    description: '判断某订单是否可以退换货，返回是否可退及原因。',
    scenes: ['support'],
    permissions: 'customer',
    parameters: {
      type: 'object',
      properties: { orderId: { type: 'integer' } },
      required: ['orderId'],
    },
    run: async (ctx, args) => {
      if (!ctx.userId) throw new AppError('NEED_LOGIN', '需要登录');
      const r = checkReturnEligibility(ctx.userId, args.orderId);
      return { eligible: r.eligible, reason: r.reason, amount: r.amount ? +(r.amount / 100).toFixed(2) : undefined };
    },
  },
  {
    name: 'create_refund_request',
    description: '为订单创建退款申请。仅当用户明确要求退款、且资格校验通过时调用。',
    scenes: ['support'],
    permissions: 'customer',
    parameters: {
      type: 'object',
      properties: {
        orderId: { type: 'integer' },
        reason: { type: 'string', description: '用户给出的退款原因' },
      },
      required: ['orderId', 'reason'],
    },
    run: async (ctx, args) => {
      if (!ctx.userId) throw new AppError('NEED_LOGIN', '需要先登录');
      const cfg = get("SELECT value FROM ai_config WHERE key = 'allow_refund'");
      if (cfg?.value === 'false') return { ok: false, message: '当前未开启 AI 自助退款，请转人工客服' };
      try {
        const r = createRefund(ctx.userId, args.orderId, args.reason);
        return { ok: true, refundId: r.id, amount: r.amount, status: '待商家审核', message: '退款申请已提交，1-3 个工作日内审核' };
      } catch (e) {
        if (e instanceof AppError) return { ok: false, message: e.message };
        throw e;
      }
    },
  },
  {
    name: 'search_kb',
    description: '搜索客服知识库，获取运费、发货、发票、会员等政策类问题的标准答案。',
    scenes: ['support'],
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
    run: async (_ctx, args) => {
      const entries = all('SELECT * FROM kb_entries');
      const q = String(args.query || '');
      // 用 2-gram 命中数打分：单字匹配会让"金卡会员生日有什么礼物"命中所有条目，
      // 新加的知识永远排在最后被截断
      const norm = (s) => String(s || '').replace(/[\s，。！？、,.!?：:；;（）()【】\[\]]/g, '');
      const grams = (s) => {
        const t = norm(s);
        const out = new Set();
        if (t.length === 1) out.add(t);
        for (let i = 0; i < t.length - 1; i += 1) out.add(t.slice(i, i + 2));
        return out;
      };
      const qg = grams(q);
      const nq = norm(q);
      const scored = entries.map((e) => {
        const text = norm(`${e.question} ${e.tags || ''}`);
        let score = 0;
        for (const g of qg) if (text.includes(g)) score += 1;
        const nQuestion = norm(e.question);
        if (nQuestion === nq) score += 100;
        else if (nQuestion.includes(nq) || (nq.length > 3 && nq.includes(nQuestion))) score += 20;
        return { e, score };
      }).sort((a, b) => b.score - a.score);
      const pool = scored.some((x) => x.score > 0) ? scored.filter((x) => x.score > 0) : scored;
      const picked = pool.slice(0, 3).map((x) => ({ q: x.e.question, a: x.e.answer }));
      return clip({ entries: picked });
    },
  },
  {
    name: 'get_sales_insight',
    description: '获取店铺销售洞察：滞销商品、爆款、库存预警、GMV 概览。',
    scenes: ['ops'],
    permissions: 'merchant',
    parameters: { type: 'object', properties: { focus: { type: 'string', description: 'slow_moving | hot | low_stock | overview' } } },
    run: async (ctx, args) => {
      if (ctx.role !== 'merchant') throw new AppError('FORBIDDEN', '仅商家可访问经营数据');
      const focus = args.focus || 'overview';
      const prods = all('SELECT * FROM products ORDER BY sales ASC');
      const slow = prods.slice(0, 5).map((p) => ({ id: p.id, title: p.title, sales: p.sales, stock: p.stock, price: p.price_cents / 100 }));
      const hot = prods.slice(-5).reverse().map((p) => ({ id: p.id, title: p.title, sales: p.sales, stock: p.stock }));
      const low = prods.filter((p) => p.stock < 20).map((p) => ({ id: p.id, title: p.title, stock: p.stock }));
      const gmv = get("SELECT COALESCE(SUM(total_cents),0) AS s, COUNT(*) AS c FROM orders WHERE status IN ('paid','shipped','completed')");
      return clip({
        gmv: +(gmv.s / 100).toFixed(2),
        paidOrders: gmv.c,
        focus,
        slowMoving: slow, hot: hot, lowStock: low,
      });
    },
  },
  {
    name: 'generate_product_copy',
    description: '为指定商品生成营销文案（标题、副标题、3-5 条卖点、详情描述）。',
    scenes: ['ops'],
    permissions: 'merchant',
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'integer' },
        style: { type: 'string', description: '风格：简洁 / 种草 / 专业' },
        highlight: { type: 'string', description: '希望强调的卖点' },
      },
      required: ['productId'],
    },
    run: async (ctx, args) => {
      if (ctx.role !== 'merchant') throw new AppError('FORBIDDEN', '仅商家可访问');
      const p = getProduct(args.productId);
      return {
        productId: p.id,
        currentTitle: p.title,
        currentSubtitle: p.subtitle,
        price: p.price,
        highlights: p.tags,
        style: args.style || '简洁',
        highlight: args.highlight || '',
        // 真模型场景下由 LLM 生成；本地模式下由 opsAgent 复用该事实数据产出结构化文案
        facts: {
          title: p.title, category: p.category, tags: p.tags,
          rating: p.rating, sales: p.sales, stock: p.stock, desc: p.description,
        },
      };
    },
  },
  {
    name: 'update_product_copy',
    description: '将生成的文案写回商品（更新副标题与描述）。用户确认后调用。',
    scenes: ['ops'],
    permissions: 'merchant',
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'integer' },
        subtitle: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['productId'],
    },
    run: async (ctx, args) => {
      if (ctx.role !== 'merchant') throw new AppError('FORBIDDEN', '仅商家可访问');
      const p = get('SELECT * FROM products WHERE id = ?', [+args.productId]);
      if (!p) throw new AppError('NOT_FOUND', '商品不存在', 404);
      run('UPDATE products SET subtitle = ?, description = ? WHERE id = ?',
        [String(args.subtitle || p.subtitle).slice(0, 120), String(args.description || p.description).slice(0, 2000), p.id]);
      return { ok: true, productId: p.id, updated: true };
    },
  },
];

export const toolsForScene = (scene, role) => TOOLS.filter((t) => {
  if (!t.scenes.includes(scene)) return false;
  if (t.permissions === 'merchant' && role !== 'merchant') return false;
  return true;
});

export async function executeTool(name, args, ctx) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { error: `未知工具 ${name}` };
  if (!tool.scenes.includes(ctx.scene)) return { error: `工具 ${name} 不适用于当前场景` };
  if (tool.permissions === 'merchant' && ctx.role !== 'merchant') return { error: '无权限使用该工具' };
  try {
    const started = Date.now();
    const result = await withTimeout(Promise.resolve(tool.run(ctx, args || {})));
    return { result, ms: Date.now() - started };
  } catch (e) {
    return { error: e.message || '工具执行失败', code: e.code };
  }
}

/** 兼容导出：老调用方仍在用 semanticSearch，内部复用统一的可解释检索 */
export function semanticSearch(query, limit = 5) {
  const rows = all("SELECT * FROM products WHERE status = 'active'");
  return searchProducts(rows, query, { limit }).items;
}
