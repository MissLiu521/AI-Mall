import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aimall-api-'));
const PORT = 3911;
const BASE = `http://127.0.0.1:${PORT}`;

let proc;

const req = async (p, { method = 'GET', body, token, headers = {} } = {}) => {
  const res = await fetch(BASE + p, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  return { status: res.status, ...json };
};

before(async () => {
  proc = spawn(process.execPath, [path.join(__dirname, '../src/index.js')], {
    env: { ...process.env, PORT: String(PORT), DB_FILE: path.join(TMP, 'api.db'), DATA_DIR: TMP, AUTH_SECRET: 'test-secret' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // 等待服务就绪
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await fetch(BASE + '/api/health');
      if (r.ok) return;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('服务启动超时');
});

after(() => { if (proc) proc.kill('SIGKILL'); });

const login = async (email, password) => (await req('/api/auth/login', { method: 'POST', body: { email, password } })).data.token;

describe('API · 鉴权与权限', () => {
  test('健康检查', async () => {
    const r = await req('/api/health');
    assert.equal(r.status, 200);
    assert.equal(r.data.status, 'up');
  });

  test('登录成功返回 token', async () => {
    const r = await req('/api/auth/login', { method: 'POST', body: { email: 'demo@mall.dev', password: 'demo123' } });
    assert.ok(r.ok);
    assert.ok(r.data.token.includes('.'));
  });

  test('密码错误返回 401', async () => {
    const r = await req('/api/auth/login', { method: 'POST', body: { email: 'demo@mall.dev', password: 'bad' } });
    assert.equal(r.status, 401);
    assert.equal(r.error.code, 'BAD_CREDENTIALS');
  });

  test('注册重复邮箱返回 409', async () => {
    const r = await req('/api/auth/register', { method: 'POST', body: { email: 'demo@mall.dev', password: '123456', name: 'x' } });
    assert.equal(r.status, 409);
  });

  test('注册弱密码被拒', async () => {
    const r = await req('/api/auth/register', { method: 'POST', body: { email: 'weak@x.com', password: '1', name: 'x' } });
    assert.equal(r.error.code, 'WEAK_PASSWORD');
  });

  test('未登录访问购物车返回 401', async () => {
    const r = await req('/api/cart');
    assert.equal(r.status, 401);
  });

  test('买家访问商家接口返回 403', async () => {
    const t = await login('demo@mall.dev', 'demo123');
    const r = await req('/api/admin/stats', { token: t });
    assert.equal(r.status, 403);
  });

  test('买家调用运营智能体返回 403', async () => {
    const t = await login('demo@mall.dev', 'demo123');
    const r = await req('/api/ai/chat', { method: 'POST', token: t, body: { scene: 'ops', text: '看下滞销品' } });
    assert.equal(r.status, 403);
  });

  test('不存在的接口返回 404', async () => {
    const r = await req('/api/nope');
    assert.equal(r.status, 404);
  });
});

describe('API · C 端主流程', () => {
  test('浏览 → 加购 → 下单 → 支付 → 查询', async () => {
    const t = await login('demo@mall.dev', 'demo123');

    const list = await req('/api/products?pageSize=3');
    assert.ok(list.data.items.length === 3);
    const p = list.data.items[0];

    const c1 = await req('/api/cart', { method: 'POST', token: t, body: { productId: p.id, qty: 2 } });
    assert.ok(c1.ok);

    const o = await req('/api/orders', { method: 'POST', token: t, body: { address: '上海市浦东新区世纪大道 100 号' } });
    assert.equal(o.status, 201);
    assert.equal(o.data.items[0].qty, 2);

    const paid = await req(`/api/orders/${o.data.id}/pay`, { method: 'POST', token: t });
    assert.equal(paid.data.status, 'paid');

    const mine = await req('/api/orders/mine', { token: t });
    assert.ok(mine.data.some((x) => x.id === o.data.id));
  });

  test('幂等头防止重复下单', async () => {
    const t = await login('demo@mall.dev', 'demo123');
    const p = (await req('/api/products?pageSize=1')).data.items[0];
    const key = 'api-idem-' + Date.now();
    const a = await req('/api/orders', { method: 'POST', token: t, body: { address: '北京市海淀区中关村 1 号', productId: p.id, qty: 1 }, headers: { 'X-Idempotency-Key': key } });
    const b = await req('/api/orders', { method: 'POST', token: t, body: { address: '北京市海淀区中关村 1 号', productId: p.id, qty: 1 }, headers: { 'X-Idempotency-Key': key } });
    assert.equal(a.data.id, b.data.id);
  });

  test('超库存下单失败', async () => {
    const t = await login('demo@mall.dev', 'demo123');
    const p = (await req('/api/products?pageSize=1')).data.items[0];
    const r = await req('/api/orders', { method: 'POST', token: t, body: { address: '北京市海淀区中关村 1 号', productId: p.id, qty: 99999 } });
    assert.equal(r.status, 400);
    assert.equal(r.error.code, 'OUT_OF_STOCK');
  });

  test('不能查看他人订单', async () => {
    const t = await login('demo@mall.dev', 'demo123');
    const mine = await req('/api/orders/mine', { token: t });
    const target = mine.data[0];
    const amy = await login('amy@mall.dev', 'demo123');
    const r = await req(`/api/orders/${target.id}`, { token: amy });
    assert.equal(r.status, 404);
  });

  test('退款资格接口返回可退状态', async () => {
    const t = await login('demo@mall.dev', 'demo123');
    const p = (await req('/api/products?pageSize=1')).data.items[0];
    const o = await req('/api/orders', { method: 'POST', token: t, body: { address: '广州市天河区体育西路 2 号', productId: p.id, qty: 1 } });
    await req(`/api/orders/${o.data.id}/pay`, { method: 'POST', token: t });
    const r = await req(`/api/orders/${o.data.id}/eligibility`, { token: t });
    assert.equal(r.data.eligible, true);
  });
});

describe('API · AI 客服与智能体', () => {
  test('客服根据真实订单回答并留下工具轨迹', async () => {
    const t = await login('demo@mall.dev', 'demo123');
    const r = await req('/api/ai/chat', { method: 'POST', token: t, body: { scene: 'support', text: '我上一个订单到哪了' } });
    assert.ok(r.ok);
    assert.ok(r.data.toolTrace.length >= 2);
    assert.ok(r.data.content.length > 10);
    assert.equal(r.data.mode, 'local');
  });

  test('多轮对话复用同一会话', async () => {
    const t = await login('demo@mall.dev', 'demo123');
    const a = await req('/api/ai/chat', { method: 'POST', token: t, body: { scene: 'support', text: '运费怎么算' } });
    const b = await req('/api/ai/chat', { method: 'POST', token: t, body: { scene: 'support', text: '那包邮吗', conversationId: a.data.conversationId } });
    assert.equal(b.data.conversationId, a.data.conversationId);
  });

  test('AI 退款会真实落库', async () => {
    // 用新注册账号，避免历史退款单干扰资格校验
    const reg = await req('/api/auth/register', { method: 'POST', body: { email: `refund-${Date.now()}@t.com`, password: '123456', name: '退款测试' } });
    const t = reg.data.token;
    const p = (await req('/api/products?pageSize=1')).data.items[0];
    const o = await req('/api/orders', { method: 'POST', token: t, body: { address: '深圳市南山区科技园 3 号', productId: p.id, qty: 1 } });
    await req(`/api/orders/${o.data.id}/pay`, { method: 'POST', token: t });

    const r = await req('/api/ai/chat', { method: 'POST', token: t, body: { scene: 'support', text: `订单 ${o.data.orderNo} 我要退款` } });
    assert.ok(r.data.toolTrace.some((x) => x.name === 'create_refund_request'), JSON.stringify(r.data.toolTrace));

    const after = await req(`/api/orders/${o.data.id}`, { token: t });
    assert.equal(after.data.status, 'refunding');
  });

  test('导购返回商品推荐', async () => {
    const t = await login('demo@mall.dev', 'demo123');
    const r = await req('/api/ai/chat', { method: 'POST', token: t, body: { scene: 'shopping', text: '想买个降噪耳机' } });
    assert.ok(r.data.content.includes('¥'));
    assert.ok(r.data.toolTrace.some((x) => x.name === 'search_products'));
  });

  test('运营智能体返回滞销分析', async () => {
    const t = await login('admin@mall.dev', 'admin123');
    const r = await req('/api/ai/chat', { method: 'POST', token: t, body: { scene: 'ops', text: '看下滞销品' } });
    assert.ok(r.ok);
    assert.ok(r.data.toolTrace.some((x) => x.name === 'get_sales_insight'));
  });

  test('空消息被拒绝', async () => {
    const t = await login('demo@mall.dev', 'demo123');
    const r = await req('/api/ai/chat', { method: 'POST', token: t, body: { scene: 'support', text: '   ' } });
    assert.equal(r.status, 400);
  });
});

describe('API · B 端管理', () => {
  test('看板返回聚合数据', async () => {
    const t = await login('admin@mall.dev', 'admin123');
    const r = await req('/api/admin/stats', { token: t });
    assert.ok(r.data.gmv >= 0);
    assert.ok(r.data.ai.conversations > 0);
    assert.ok(Array.isArray(r.data.topProducts));
  });

  test('商品增改查删', async () => {
    const t = await login('admin@mall.dev', 'admin123');
    const created = await req('/api/admin/products', { method: 'POST', token: t, body: { title: '接口测试商品', price: 66, stock: 9, category: '其他' } });
    assert.equal(created.status, 201);
    const id = created.data.id;

    const patched = await req(`/api/admin/products/${id}`, { method: 'PATCH', token: t, body: { price: 88, status: 'inactive' } });
    assert.equal(patched.data.price, 88);
    assert.equal(patched.data.status, 'inactive');

    // 下架后 C 端不可见
    const pub = await req(`/api/products/${id}`);
    assert.equal(pub.data.status, 'inactive');

    const del = await req(`/api/admin/products/${id}`, { method: 'DELETE', token: t });
    assert.ok(del.ok);
  });

  test('发货流转', async () => {
    const t = await login('admin@mall.dev', 'admin123');
    const buyer = await login('demo@mall.dev', 'demo123');
    const p = (await req('/api/products?pageSize=1')).data.items[0];
    const o = await req('/api/orders', { method: 'POST', token: buyer, body: { address: '杭州市西湖区文三路 4 号', productId: p.id, qty: 1 } });
    await req(`/api/orders/${o.data.id}/pay`, { method: 'POST', token: buyer });

    const ship = await req(`/api/admin/orders/${o.data.id}/ship`, { method: 'PATCH', token: t });
    assert.equal(ship.data.status, 'shipped');

    const again = await req(`/api/admin/orders/${o.data.id}/ship`, { method: 'PATCH', token: t });
    assert.equal(again.error.code, 'BAD_STATUS');
  });

  test('退款审核通过后订单变已退款', async () => {
    const t = await login('admin@mall.dev', 'admin123');
    const buyer = await login('demo@mall.dev', 'demo123');
    const p = (await req('/api/products?pageSize=1')).data.items[0];
    const o = await req('/api/orders', { method: 'POST', token: buyer, body: { address: '成都市武侯区天府大道 5 号', productId: p.id, qty: 1 } });
    await req(`/api/orders/${o.data.id}/pay`, { method: 'POST', token: buyer });
    await req(`/api/orders/${o.data.id}/refund`, { method: 'POST', token: buyer, body: { reason: '接口测试' } });

    const list = await req('/api/admin/refunds', { token: t });
    const target = list.data.find((r) => r.orderId === o.data.id);
    assert.ok(target);

    const decided = await req(`/api/admin/refunds/${target.id}`, { method: 'PATCH', token: t, body: { approve: true } });
    assert.equal(decided.data.status, 'approved');

    const after = await req(`/api/orders/${o.data.id}`, { token: buyer });
    assert.equal(after.data.status, 'refunded');
  });

  test('AI 配置读写', async () => {
    const t = await login('admin@mall.dev', 'admin123');
    await req('/api/admin/ai/config', { method: 'PUT', token: t, body: { temperature: '0.3', allow_refund: 'false' } });
    const r = await req('/api/admin/ai/config', { token: t });
    assert.equal(r.data.temperature, '0.3');
    assert.equal(r.data.allow_refund, 'false');
    assert.equal(r.data.keyConfigured, false);
    // 复原
    await req('/api/admin/ai/config', { method: 'PUT', token: t, body: { temperature: '0.6', allow_refund: 'true' } });
  });

  test('关闭 AI 退款开关后工具拒绝执行', async () => {
    const t = await login('admin@mall.dev', 'admin123');
    const buyer = await login('demo@mall.dev', 'demo123');
    await req('/api/admin/ai/config', { method: 'PUT', token: t, body: { allow_refund: 'false' } });

    const p = (await req('/api/products?pageSize=1')).data.items[0];
    const o = await req('/api/orders', { method: 'POST', token: buyer, body: { address: '南京市鼓楼区中山路 6 号', productId: p.id, qty: 1 } });
    await req(`/api/orders/${o.data.id}/pay`, { method: 'POST', token: buyer });

    const r = await req('/api/ai/chat', { method: 'POST', token: buyer, body: { scene: 'support', text: `订单 ${o.data.orderNo} 我要退款` } });
    const trace = r.data.toolTrace.map((x) => x.name).join(',');
    assert.ok(r.data.content.includes('人工') || r.data.content.includes('未开启') || r.data.content.includes('不能'),
      `content=${JSON.stringify(r.data.content?.slice(0, 80))}, trace=${trace}`);

    await req('/api/admin/ai/config', { method: 'PUT', token: t, body: { allow_refund: 'true' } });
  });

  test('知识库增删', async () => {
    const t = await login('admin@mall.dev', 'admin123');
    const created = await req('/api/admin/kb', { method: 'POST', token: t, body: { question: '能开专票吗', answer: '可以，联系客服提供税号', tags: '发票' } });
    assert.equal(created.status, 201);
    const list = await req('/api/admin/kb', { token: t });
    assert.ok(list.data.some((e) => e.question === '能开专票吗'));
    await req(`/api/admin/kb/${created.data.id}`, { method: 'DELETE', token: t });
  });
});

describe('API · 体验改进能力', () => {
  test('搜索接口返回匹配理由', async () => {
    const r = await req('/api/products?q=降噪耳机&explain=1');
    assert.equal(r.status, 200);
    assert.ok(r.data.items.length > 0);
    assert.ok(Array.isArray(r.data.items[0].matchReasons));
    assert.ok(r.data.items[0].matchReasons.length > 0);
  });

  test('搜索默认不返回 matchReasons（保持接口瘦身）', async () => {
    const r = await req('/api/products?q=耳机');
    assert.equal(r.data.items[0].matchReasons, undefined);
  });

  test('零结果返回可点击的放宽建议', async () => {
    const r = await req('/api/products?q=nothingfoundzzz&explain=1');
    assert.equal(r.data.total, 0);
    assert.ok(r.data.suggestions.length > 0);
  });

  test('商品详情包含规格 / 库存分档 / 价格构成 / 退换政策', async () => {
    const r = await req('/api/products/1');
    assert.ok(Object.keys(r.data.specs).length > 0);
    assert.ok(['enough', 'limited', 'low', 'out'].includes(r.data.stockStatus.level));
    assert.ok(r.data.priceBreakdown.shipping.text);
    assert.equal(typeof r.data.returnPolicy.returnable, 'boolean');
  });

  test('退款后订单详情带时间轴，商家审核后推进', async () => {
    const buyer = await login('demo@mall.dev', 'demo123');
    const merchant = await login('admin@mall.dev', 'admin123');
    const p = (await req('/api/products?pageSize=1')).data.items[0];

    const o = await req('/api/orders', { method: 'POST', token: buyer, body: { address: '杭州市西湖区文三路 100 号', productId: p.id, qty: 1 } });
    await req(`/api/orders/${o.data.id}/pay`, { method: 'POST', token: buyer });
    const rf = await req(`/api/orders/${o.data.id}/refund`, { method: 'POST', token: buyer, body: { reason: '功能不符预期' } });
    assert.ok([200, 201].includes(rf.status), `退款提交状态码 ${rf.status}`);

    const detail = await req(`/api/orders/${o.data.id}`, { token: buyer });
    assert.ok(detail.data.refund, '应返回 refund 时间轴');
    assert.equal(detail.data.refund.nodes.length, 3);
    assert.equal(detail.data.refund.status, 'pending');

    const pend = (await req('/api/admin/refunds', { token: merchant })).data.find((x) => x.orderId === o.data.id);
    const decided = await req(`/api/admin/refunds/${pend.id}`, { method: 'PATCH', token: merchant, body: { approve: false, reason: '已拆封' } });
    assert.equal(decided.status, 200);

    const after = await req(`/api/orders/${o.data.id}`, { token: buyer });
    assert.equal(after.data.refund.status, 'rejected');
    assert.ok(after.data.refund.nextAction.includes('人工'));
  });

  test('买家无权访问退款单列表', async () => {
    const buyer = await login('demo@mall.dev', 'demo123');
    const r = await req('/api/admin/refunds', { token: buyer });
    assert.equal(r.status, 403);
  });
});

describe('API · 安全与健壮性（本轮完善）', () => {
  test('静态资源路径穿越被阻断', async () => {
    const r = await fetch(`${BASE}/..%2f..%2fpackage.json`);
    assert.equal(r.status, 404, '不得读取 dist 之外的文件');
  });

  test('非法分页参数返回 400，不泄露数据库错误', async () => {
    const r = await req('/api/products?pageSize=abc');
    assert.equal(r.status, 400);
    assert.equal(r.error.code, 'INVALID');
    assert.ok(!JSON.stringify(r).includes('SQLITE'));
  });

  test('超大 pageSize 被拒绝而不是拉全量', async () => {
    const r = await req('/api/products?pageSize=999999');
    assert.equal(r.status, 400);
    assert.equal(r.error.code, 'INVALID');
  });

  test('CORS 不反射陌生来源', async () => {
    const res = await fetch(`${BASE}/api/health`, { headers: { Origin: 'https://evil.example' } });
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });

  test('评分接口需要登录', async () => {
    const r = await req('/api/ai/messages/1/rate', { method: 'POST', body: { rating: 5 } });
    assert.equal(r.status, 401);
  });
});

describe('API · 订单闭环（本轮完善）', () => {
  test('取消待支付订单会回补库存', async () => {
    const buyer = await login('demo@mall.dev', 'demo123');
    const p = (await req('/api/products?pageSize=1')).data.items[0];
    const before = (await req(`/api/products/${p.id}`)).data.stock;

    const o = await req('/api/orders', { method: 'POST', token: buyer, body: { address: '上海市徐汇区漕溪路 9 号', productId: p.id, qty: 2 } });
    assert.equal((await req(`/api/products/${p.id}`)).data.stock, before - 2);

    const cancelled = await req(`/api/orders/${o.data.id}/cancel`, { method: 'POST', token: buyer, body: { reason: '测试取消' } });
    assert.equal(cancelled.data.status, 'cancelled');
    assert.equal((await req(`/api/products/${p.id}`)).data.stock, before);
  });

  test('已发货订单不可取消', async () => {
    const buyer = await login('demo@mall.dev', 'demo123');
    const merchant = await login('admin@mall.dev', 'admin123');
    const p = (await req('/api/products?pageSize=1')).data.items[0];
    const o = await req('/api/orders', { method: 'POST', token: buyer, body: { address: '上海市徐汇区漕溪路 10 号', productId: p.id, qty: 1 } });
    await req(`/api/orders/${o.data.id}/pay`, { method: 'POST', token: buyer });
    await req(`/api/admin/orders/${o.data.id}/ship`, { method: 'PATCH', token: merchant, body: { carrier: '顺丰', trackingNo: 'SF001' } });

    const r = await req(`/api/orders/${o.data.id}/cancel`, { method: 'POST', token: buyer });
    assert.equal(r.error.code, 'BAD_STATUS');
  });

  test('发货记录物流，确认收货后完成', async () => {
    const buyer = await login('demo@mall.dev', 'demo123');
    const merchant = await login('admin@mall.dev', 'admin123');
    const p = (await req('/api/products?pageSize=1')).data.items[0];
    const o = await req('/api/orders', { method: 'POST', token: buyer, body: { address: '杭州市余杭区文一西路 11 号', productId: p.id, qty: 1 } });
    await req(`/api/orders/${o.data.id}/pay`, { method: 'POST', token: buyer });

    const shipped = await req(`/api/admin/orders/${o.data.id}/ship`, { method: 'PATCH', token: merchant, body: { carrier: '中通', trackingNo: 'ZT123' } });
    assert.equal(shipped.data.trackingNo, 'ZT123');

    const done = await req(`/api/orders/${o.data.id}/confirm`, { method: 'POST', token: buyer });
    assert.equal(done.data.status, 'completed');
    assert.ok(done.data.completedAt);
  });

  test('退款驳回后恢复到发货状态，不会打回待发货', async () => {
    const buyer = await login('demo@mall.dev', 'demo123');
    const merchant = await login('admin@mall.dev', 'admin123');
    const p = (await req('/api/products?pageSize=1')).data.items[0];
    const o = await req('/api/orders', { method: 'POST', token: buyer, body: { address: '南京市建邺区江东中路 12 号', productId: p.id, qty: 1 } });
    await req(`/api/orders/${o.data.id}/pay`, { method: 'POST', token: buyer });
    await req(`/api/admin/orders/${o.data.id}/ship`, { method: 'PATCH', token: merchant, body: { carrier: '顺丰', trackingNo: 'SF002' } });
    await req(`/api/orders/${o.data.id}/refund`, { method: 'POST', token: buyer, body: { reason: '测试驳回' } });

    const list = await req('/api/admin/refunds', { token: merchant });
    const target = list.data.find((x) => x.orderId === o.data.id);
    await req(`/api/admin/refunds/${target.id}`, { method: 'PATCH', token: merchant, body: { approve: false, reason: '不符合' } });

    const after = await req(`/api/orders/${o.data.id}`, { token: buyer });
    assert.equal(after.data.status, 'shipped');
    assert.equal(after.data.trackingNo, 'SF002');
  });

  test('地址簿增改删与默认地址', async () => {
    const buyer = await login('demo@mall.dev', 'demo123');
    const created = await req('/api/addresses', {
      method: 'POST', token: buyer,
      body: { name: '测试收件人', phone: '13900001111', region: '广东省 深圳市 南山区', detail: '科技园路 1 号 A 座 101' },
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.name, '测试收件人');

    const patched = await req(`/api/addresses/${created.data.id}`, { method: 'PATCH', token: buyer, body: { detail: '科技园路 2 号 B 座 202' } });
    assert.ok(patched.data.detail.includes('2 号'));

    const def = await req(`/api/addresses/${created.data.id}/default`, { method: 'POST', token: buyer });
    assert.equal(def.data.isDefault, true);

    const list = await req('/api/addresses', { token: buyer });
    assert.ok(list.data.some((a) => a.id === created.data.id));

    await req(`/api/addresses/${created.data.id}`, { method: 'DELETE', token: buyer });
    const after = await req('/api/addresses', { token: buyer });
    assert.ok(!after.data.some((a) => a.id === created.data.id));
  });

  test('手机号格式非法被拒', async () => {
    const buyer = await login('demo@mall.dev', 'demo123');
    const r = await req('/api/addresses', {
      method: 'POST', token: buyer,
      body: { name: '张三', phone: 'abc', region: '北京市 朝阳区', detail: '建国路 1 号' },
    });
    assert.equal(r.status, 400);
  });

  test('缺少必填项返回 400 并指出字段名', async () => {
    const buyer = await login('demo@mall.dev', 'demo123');
    const base = { name: '张三', phone: '13900002222', region: '北京市 朝阳区', detail: '建国路 1 号 101' };

    for (const [field, label] of [['name', '收件人'], ['phone', '手机号'], ['region', '所在地区'], ['detail', '详细地址']]) {
      const body = { ...base };
      delete body[field];
      const r = await req('/api/addresses', { method: 'POST', token: buyer, body });
      assert.equal(r.status, 400, `缺少 ${field} 应返回 400`);
      assert.ok(r.error.message.includes(label), `错误信息应包含「${label}」，实际：${r.error.message}`);
    }
  });

  test('空白字符串等同于未填，同样被拒绝', async () => {
    const buyer = await login('demo@mall.dev', 'demo123');
    const r = await req('/api/addresses', {
      method: 'POST', token: buyer,
      body: { name: '   ', phone: '13900002222', region: '北京市 朝阳区', detail: '建国路 1 号 101' },
    });
    assert.equal(r.status, 400);
  });
});

describe('API · AI 转人工（本轮完善）', () => {
  test('转人工生成工单，商家可查看并处理', async () => {
    const buyer = await login('demo@mall.dev', 'demo123');
    const merchant = await login('admin@mall.dev', 'admin123');

    const chat = await req('/api/ai/chat', { method: 'POST', token: buyer, body: { scene: 'support', text: '运费怎么算' } });
    const convId = chat.data.conversationId;

    const ticket = await req('/api/ai/handoff', {
      method: 'POST', token: buyer,
      body: { conversationId: convId, summary: '需要人工核对一笔历史订单', contact: 'demo@mall.dev' },
    });
    assert.equal(ticket.status, 201);
    assert.ok(ticket.data.id);

    const list = await req('/api/admin/tickets?status=open', { token: merchant });
    assert.ok(list.data.some((t) => t.id === ticket.data.id));

    const resolved = await req(`/api/admin/tickets/${ticket.data.id}`, { method: 'PATCH', token: merchant, body: { reply: '已处理' } });
    assert.equal(resolved.data.status, 'resolved');
  });

  test('后台修改模型名后 meta 立即生效', async () => {
    const merchant = await login('admin@mall.dev', 'admin123');
    await req('/api/admin/ai/config', { method: 'PUT', token: merchant, body: { model: 'demo-model-x' } });
    const meta = await req('/api/meta');
    assert.equal(meta.data.ai.model, 'demo-model-x');
    await req('/api/admin/ai/config', { method: 'PUT', token: merchant, body: { model: 'gpt-4o-mini' } });
  });
});

