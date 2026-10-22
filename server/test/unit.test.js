import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// 使用独立临时数据库，避免污染开发库
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aimall-unit-'));
process.env.DB_FILE = path.join(TMP, 'unit.db');
process.env.DATA_DIR = TMP;

const { migrate, seed } = await import('../src/db/seed.js');
const { hashPassword, verifyPassword, signToken, verifyToken } = await import('../src/services/auth.js');
const products = await import('../src/services/products.js');
const cart = await import('../src/services/cart.js');
const orders = await import('../src/services/orders.js');
const { semanticSearch, executeTool, toolsForScene } = await import('../src/ai/tools.js');
const { detectIntent, localAgent } = await import('../src/ai/local-engine.js');
const { get } = await import('../src/db/index.js');

before(() => {
  migrate();
  seed();
});

describe('鉴权', () => {
  test('密码哈希不可逆且可校验', () => {
    const h = hashPassword('secret123');
    assert.notEqual(h, 'secret123');
    assert.ok(verifyPassword('secret123', h));
    assert.ok(!verifyPassword('wrong', h));
  });

  test('错误密码不通过', () => {
    const h = hashPassword('abc');
    assert.ok(!verifyPassword('', h));
    assert.ok(!verifyPassword('abc ', h));
  });

  test('JWT 签名与校验', () => {
    const t = signToken({ sub: 1, role: 'customer' });
    const p = verifyToken(t);
    assert.equal(p.sub, 1);
    assert.equal(p.role, 'customer');
  });

  test('篡改的 token 被拒绝', () => {
    const t = signToken({ sub: 1 });
    const parts = t.split('.');
    const forged = [parts[0], parts[1], 'x'.repeat(43)].join('.');
    assert.equal(verifyToken(forged), null);
  });

  test('过期 token 被拒绝', () => {
    const t = signToken({ sub: 1 }, -10);
    assert.equal(verifyToken(t), null);
  });
});

describe('商品服务', () => {
  test('列表分页与总数', () => {
    const r = products.listProducts({ pageSize: 5 });
    assert.equal(r.items.length, 5);
    assert.ok(r.total >= 12);
  });

  test('按分类过滤', () => {
    const r = products.listProducts({ category: '家居', pageSize: 50 });
    assert.ok(r.items.length > 0);
    assert.ok(r.items.every((p) => p.category === '家居'));
  });

  test('关键词搜索命中标题', () => {
    const r = products.listProducts({ q: '耳机', pageSize: 20 });
    assert.ok(r.items.length > 0);
    assert.ok(r.items.some((p) => p.title.includes('耳机')));
  });

  test('不存在商品抛 404', () => {
    assert.throws(() => products.getProduct(999999), (e) => e.code === 'NOT_FOUND');
  });

  test('非管理员不可创建商品', () => {
    assert.throws(() => products.createProduct({ title: 'x', price: 1 }), (e) => e.code === 'FORBIDDEN');
  });

  test('价格必须大于 0', () => {
    assert.throws(() => products.createProduct({ title: 'x', price: 0 }, { admin: true }), (e) => e.code === 'INVALID');
  });

  test('创建后可按 id 读回', () => {
    const p = products.createProduct({ title: '测试商品', price: 12.5, stock: 3, category: '其他' }, { admin: true });
    assert.equal(p.title, '测试商品');
    assert.equal(p.price, 12.5);
    assert.equal(products.getProduct(p.id).id, p.id);
    products.deleteProduct(p.id, { admin: true });
  });
});

describe('购物车', () => {
  const uid = () => get("SELECT id FROM users WHERE email='demo@mall.dev'").id;

  test('加入购物车并累加数量', () => {
    const u = uid();
    cart.clearCart(u);
    const p = products.listProducts({ pageSize: 1 }).items[0];
    cart.addToCart(u, { productId: p.id, qty: 1 });
    const c = cart.addToCart(u, { productId: p.id, qty: 2 });
    assert.equal(c.count, 3);
    assert.equal(c.items.length, 1);
  });

  test('超过库存被拒绝', () => {
    const u = uid();
    const p = products.listProducts({ pageSize: 1 }).items[0];
    assert.throws(() => cart.addToCart(u, { productId: p.id, qty: p.stock + 1 }), (e) => e.code === 'OUT_OF_STOCK');
  });

  test('小计与运费计算正确', () => {
    const u = uid();
    cart.clearCart(u);
    const p = products.listProducts({ q: '燕麦' }).items[0];
    const c = cart.addToCart(u, { productId: p.id, qty: 1 });
    assert.equal(c.subtotal, p.price);
    assert.equal(c.shipping, p.price >= 99 ? 0 : 8);
  });

  test('清空购物车', () => {
    const u = uid();
    assert.equal(cart.clearCart(u).count, 0);
  });
});

describe('订单', () => {
  const uid = () => get("SELECT id FROM users WHERE email='demo@mall.dev'").id;
  const ADDR = '北京市朝阳区建国路 88 号 1203';

  test('下单扣减库存并生成订单号', () => {
    const u = uid();
    const p = products.listProducts({ q: '燕麦' }).items[0];
    const before = products.getProduct(p.id).stock;
    const o = orders.createOrder(u, { address: ADDR, productId: p.id, qty: 2 });
    assert.match(o.orderNo, /^AIM\d{8}[A-Z0-9]{4}$/);
    assert.equal(o.items[0].qty, 2);
    assert.equal(products.getProduct(p.id).stock, before - 2);
  });

  test('幂等键重复提交只生成一单', () => {
    const u = uid();
    const p = products.listProducts({ q: '燕麦' }).items[0];
    const k = 'test-idem-' + Date.now();
    const a = orders.createOrder(u, { address: ADDR, productId: p.id, qty: 1, idemKey: k });
    const b = orders.createOrder(u, { address: ADDR, productId: p.id, qty: 1, idemKey: k });
    assert.equal(a.id, b.id);
  });

  test('空地址被拒绝', () => {
    const u = uid();
    const p = products.listProducts({ pageSize: 1 }).items[0];
    assert.throws(() => orders.createOrder(u, { address: '  ', productId: p.id }), (e) => e.code === 'INVALID_ADDRESS');
  });

  test('购物车为空时下单报错', () => {
    const u = uid();
    cart.clearCart(u);
    assert.throws(() => orders.createOrder(u, { address: ADDR }), (e) => e.code === 'EMPTY_CART');
  });

  test('支付状态流转', () => {
    const u = uid();
    const p = products.listProducts({ pageSize: 1 }).items[0];
    const o = orders.createOrder(u, { address: ADDR, productId: p.id, qty: 1 });
    const paid = orders.payOrder(u, o.id);
    assert.equal(paid.status, 'paid');
    assert.ok(paid.paidAt);
  });

  test('未支付订单不能退款', () => {
    const u = uid();
    const p = products.listProducts({ pageSize: 1 }).items[0];
    const o = orders.createOrder(u, { address: ADDR, productId: p.id, qty: 1 });
    const r = orders.checkReturnEligibility(u, o.id);
    assert.equal(r.eligible, false);
  });

  test('已支付订单可退款并回补库存', () => {
    const u = uid();
    const p = products.listProducts({ q: '燕麦' }).items[0];
    const o = orders.createOrder(u, { address: ADDR, productId: p.id, qty: 1 });
    orders.payOrder(u, o.id);

    const stockAfterOrder = products.getProduct(p.id).stock;
    const r = orders.checkReturnEligibility(u, o.id);
    assert.equal(r.eligible, true);

    const refund = orders.createRefund(u, o.id, '不想要了');
    assert.equal(refund.status, 'pending');
    assert.equal(get('SELECT status FROM orders WHERE id = ?', [o.id]).status, 'refunding');

    orders.decideRefund(refund.id, true);
    assert.equal(get('SELECT status FROM orders WHERE id = ?', [o.id]).status, 'refunded');
    assert.equal(products.getProduct(p.id).stock, stockAfterOrder + 1);
  });

  test('同一订单不能重复申请退款', () => {
    const u = uid();
    const p = products.listProducts({ pageSize: 1 }).items[0];
    const o = orders.createOrder(u, { address: ADDR, productId: p.id, qty: 1 });
    orders.payOrder(u, o.id);
    orders.createRefund(u, o.id, '第一次');
    // 二选一：资格校验拦截（订单已进入退款流程）或重复校验拦截
    assert.throws(() => orders.createRefund(u, o.id, '第二次'),
      (e) => e.code === 'DUPLICATE' || e.code === 'NOT_ELIGIBLE');
    assert.equal(get("SELECT COUNT(*) c FROM refunds WHERE order_id = ?", [o.id]).c, 1);
  });

  test('不能支付他人订单', () => {
    const u = uid();
    const other = get("SELECT id FROM users WHERE email='amy@mall.dev'").id;
    const p = products.listProducts({ pageSize: 1 }).items[0];
    const o = orders.createOrder(u, { address: ADDR, productId: p.id, qty: 1 });
    assert.throws(() => orders.payOrder(other, o.id), (e) => e.code === 'NOT_FOUND');
  });

  test('已发货订单不能再支付', () => {
    const u = uid();
    const p = products.listProducts({ pageSize: 1 }).items[0];
    const o = orders.createOrder(u, { address: ADDR, productId: p.id, qty: 1 });
    orders.payOrder(u, o.id);
    orders.shipOrder(o.id);
    assert.throws(() => orders.payOrder(u, o.id), (e) => e.code === 'BAD_STATUS');
  });
});

describe('AI 工具', () => {
  test('语义检索能按预算过滤', () => {
    const r = semanticSearch('200元以内 礼物', 5);
    assert.ok(r.length > 0);
    assert.ok(r.every((i) => i.price <= 200 || i.reason));
  });

  test('语义检索命中品类词', () => {
    const r = semanticSearch('降噪耳机', 3);
    assert.ok(r.length > 0);
    assert.ok(r[0].title.includes('耳机'));
  });

  test('场景隔离：导购场景不能调退款工具', async () => {
    const r = await executeTool('create_refund_request', { orderId: 1, reason: 'x' }, { userId: 2, role: 'customer', scene: 'shopping' });
    assert.ok(r.error);
  });

  test('权限隔离：普通用户不能用商家工具', async () => {
    const r = await executeTool('get_sales_insight', {}, { userId: 2, role: 'customer', scene: 'ops' });
    assert.ok(r.error);
  });

  test('商家工具白名单按角色过滤', () => {
    const asCustomer = toolsForScene('ops', 'customer');
    const asMerchant = toolsForScene('ops', 'merchant');
    assert.equal(asCustomer.length, 0);
    assert.ok(asMerchant.length >= 3);
  });

  test('订单查询只能查到自己的数据', async () => {
    const amy = get("SELECT id FROM users WHERE email='amy@mall.dev'").id;
    const r = await executeTool('get_my_orders', {}, { userId: amy, role: 'customer', scene: 'support' });
    assert.ok(Array.isArray(r.result));
    assert.equal(r.result.length, 0);
  });
});

describe('本地意图识别', () => {
  const cases = [
    ['我上一个订单到哪了', 'support', 'order'],
    ['这个订单我要退款', 'support', 'refund'],
    ['运费怎么算', 'support', 'policy'],
    ['推荐个耳机', 'shopping', 'recommend'],
    ['看下滞销品', 'ops', 'ops_insight'],
    ['给 3 号商品写文案', 'ops', 'ops_copy'],
  ];
  for (const [text, scene, expect] of cases) {
    test(`「${text}」→ ${expect}`, () => {
      assert.equal(detectIntent(text, scene), expect);
    });
  }
});

describe('本地 Agent 端到端', () => {
  test('客服查询订单返回真实数据', async () => {
    const u = get("SELECT id FROM users WHERE email='demo@mall.dev'").id;
    const exec = (n, a, c) => executeTool(n, a, c);
    const out = await localAgent({
      scene: 'support',
      text: '我上一个订单到哪了',
      ctx: { userId: u, role: 'customer', scene: 'support' },
      exec,
    });
    assert.ok(out.content.includes('订单'));
    assert.ok(out.toolTrace.some((t) => t.name === 'get_my_orders'));
    assert.ok(out.toolTrace.some((t) => t.name === 'get_order_detail'));
  });

  test('未登录查询订单给出登录提示', async () => {
    const exec = (n, a, c) => executeTool(n, a, c);
    const out = await localAgent({
      scene: 'support', text: '我的订单在哪', ctx: { userId: null, role: 'guest', scene: 'support' }, exec,
    });
    assert.ok(out.content.includes('登录'));
  });

  test('政策问题命中知识库原文', async () => {
    const exec = (n, a, c) => executeTool(n, a, c);
    const out = await localAgent({
      scene: 'support', text: '运费怎么算', ctx: { userId: null, role: 'guest', scene: 'support' }, exec,
    });
    assert.ok(out.content.includes('包邮'));
  });
});

// ── 体验改进：可解释搜索 / 信息透明 / 退款时间轴 ──────────
describe('可解释搜索', () => {
  test('每条结果都附带命中理由', () => {
    const r = products.listProducts({ q: '降噪耳机', explain: true, pageSize: 5 });
    assert.ok(r.items.length > 0);
    const first = r.items[0];
    assert.ok(Array.isArray(first.matchReasons) && first.matchReasons.length > 0);
    assert.ok(first.matchReasons.some((x) => x.text.includes('降噪') || x.text.includes('耳机')));
    assert.ok(typeof first.matchScore === 'number' && first.matchScore > 0);
  });

  test('不带 explain 时不污染商品字段', () => {
    const r = products.listProducts({ q: '耳机', pageSize: 5 });
    assert.equal(r.items[0].matchReasons, undefined);
  });

  test('价格意图被识别为预算理由', () => {
    const r = products.listProducts({ q: '礼物 200 元以内', explain: true, pageSize: 5 });
    assert.ok(r.items.length > 0);
    const hasPriceReason = r.items.some((i) => i.matchReasons.some((x) => x.field === 'price'));
    assert.ok(hasPriceReason, '应至少有一条价格相关理由');
  });

  test('零结果给出兜底建议而非死路', () => {
    const r = products.listProducts({ q: 'zzz不存在的商品zzz', explain: true });
    assert.equal(r.total, 0);
    assert.ok(Array.isArray(r.suggestions) && r.suggestions.length > 0);
  });

  test('有结果时不下发空建议', () => {
    const r = products.listProducts({ q: '耳机' });
    assert.equal(r.suggestions.length, 0);
  });
});

describe('商品信息透明化', () => {
  test('详情返回规格实测表', () => {
    const p = products.getProduct(1);
    assert.ok(p.specs && Object.keys(p.specs).length >= 3);
  });

  test('库存语义分档', () => {
    assert.equal(products.stockStatus(0).level, 'out');
    assert.equal(products.stockStatus(3).level, 'low');
    assert.equal(products.stockStatus(15).level, 'limited');
    assert.equal(products.stockStatus(100).level, 'enough');
    assert.equal(products.stockStatus(0).buyable, false);
  });

  test('价格构成可算清', () => {
    const p = products.getProduct(1);
    const b = p.priceBreakdown;
    assert.equal(b.final, p.price);
    assert.equal(b.saving, +(b.origin - b.final).toFixed(2));
    assert.ok(b.shipping.text.includes('免运费'));
  });

  test('食品类不可无理由退货，服饰类可以', () => {
    assert.equal(products.returnPolicy('食品').returnable, false);
    assert.equal(products.returnPolicy('服饰').returnable, true);
    assert.equal(products.returnPolicy('数码').days, 7);
  });
});

describe('退款时间轴', () => {
  test('提交退款后生成三步时间轴', () => {
    const list = orders.myOrders(2);
    const target = list.find((o) => o.status === 'completed') || list[0];
    const r = orders.createRefund(2, target.id, '尺寸不合适');
    assert.ok(r.id > 0);
    const fresh = orders.getOrderForUser(target.id, 2);
    assert.ok(fresh.refund, '订单应带 refund 时间轴');
    assert.equal(fresh.refund.nodes.length, 3);
    assert.equal(fresh.refund.currentIndex, 1);
    assert.equal(fresh.refund.currentNode.owner, '商家');
    assert.ok(fresh.refund.nextAction.length > 0);
  });

  test('商家通过后时间轴推进到已退款', () => {
    const pend = orders.listRefunds().find((r) => r.status === 'pending');
    orders.decideRefund(pend.id, true);
    const after = orders.listRefunds().find((r) => r.id === pend.id);
    assert.equal(after.status, 'approved');
    assert.ok(after.timeline.nodes.every((n) => n.done));
  });

  test('驳回时记录原因并提示申诉路径', () => {
    const list = orders.myOrders(2);
    const target = list.find((o) => o.status === 'shipped') || list[0];
    const r = orders.createRefund(2, target.id, '不想要了');
    orders.decideRefund(r.id, false, '已拆封影响二次销售');
    const after = orders.listRefunds().find((x) => x.id === r.id);
    assert.equal(after.status, 'rejected');
    assert.equal(after.rejectReason, '已拆封影响二次销售');
    assert.ok(after.timeline.nextAction.includes('人工'));
  });

  test('签收天数计算不出现 NaN', () => {
    const list = orders.myOrders(2);
    const shipped = list.find((o) => o.shippedAt);
    const el = orders.checkReturnEligibility(2, shipped.id);
    assert.ok(!String(el.reason).includes('NaN'), `理由不应含 NaN：${el.reason}`);
  });
});
