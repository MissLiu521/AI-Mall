// 冒烟测试脚本：node scripts/smoke.js
// 用 127.0.0.1 而不是 localhost：Node 18+ 会把 localhost 解析成 IPv6 ::1，
// 后端未监听 IPv6 时连接会被拒，误判为"接口挂了"
const BASE = process.env.BASE || 'http://127.0.0.1:3001';

const j = async (r) => {
  const t = await r.text();
  try { return JSON.parse(t); } catch { throw new Error(`非 JSON 响应 [${r.status}]: ${t.slice(0, 200)}`); }
};

const call = (path, { method = 'GET', body, token } = {}) =>
  fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  }).then(j);

let pass = 0;
let fail = 0;
const log = (label, ok, extra = '') => {
  if (ok) pass += 1; else fail += 1;
  console.log(`${ok ? '  ✅' : '  ❌'} ${label}${extra ? ' — ' + extra : ''}`);
};

(async () => {
  console.log('\n▶ 冒烟测试 ' + BASE + '\n');

  const login = await call('/api/auth/login', { method: 'POST', body: { email: 'demo@mall.dev', password: 'demo123' } });
  log('买家登录', login.ok, login.data?.user?.name);
  const t = login.data.token;

  const admin = await call('/api/auth/login', { method: 'POST', body: { email: 'admin@mall.dev', password: 'admin123' } });
  log('商家登录', admin.ok, admin.data?.user?.role);
  const at = admin.data.token;

  const plist = await call('/api/products?pageSize=4');
  log('商品列表', plist.ok, `${plist.data.total} 个商品`);

  const p = plist.data.items[0];
  const cart = await call('/api/cart', { method: 'POST', token: t, body: { productId: p.id, qty: 2 } });
  log('加入购物车', cart.ok, `共 ${cart.data?.count} 件`);

  const order = await call('/api/orders', { method: 'POST', token: t, body: { address: '北京市朝阳区建国路 88 号', remark: '冒烟' } });
  log('创建订单', order.ok, order.data?.orderNo + ' ¥' + order.data?.total);

  const idemKey = 'idem-' + Date.now();
  const a1 = await call('/api/orders', { method: 'POST', token: t, body: { address: '北京市朝阳区建国路 88 号', productId: p.id, qty: 1, idemKey } });
  const a2 = await call('/api/orders', { method: 'POST', token: t, body: { address: '北京市朝阳区建国路 88 号', productId: p.id, qty: 1, idemKey } });
  log('幂等下单（同 key 只生成 1 单）', a1.ok && a2.ok && a1.data.id === a2.data.id, a1.data?.orderNo || a1.error?.message);

  const paid = await call(`/api/orders/${order.data.id}/pay`, { method: 'POST', token: t });
  log('支付订单', paid.ok, paid.data?.statusLabel);

  const mine = await call('/api/orders/mine', { token: t });
  log('我的订单', mine.ok, `${mine.data.length} 笔`);

  const c1 = await call('/api/ai/chat', { method: 'POST', token: t, body: { scene: 'support', text: '我上一个订单到哪了' } });
  log('AI 客服·订单查询', c1.ok && c1.data.toolTrace.length > 0, `工具 ${c1.data?.toolTrace?.map((x) => x.name).join(',')}`);

  const c2 = await call('/api/ai/chat', { method: 'POST', token: t, body: { scene: 'support', text: '运费怎么算' } });
  log('AI 客服·知识库', c2.ok && c2.data.content.includes('包邮'), '命中运费政策');

  const c3 = await call('/api/ai/chat', { method: 'POST', token: t, body: { scene: 'shopping', text: '300元以内适合通勤的耳机' } });
  log('AI 导购·语义检索', c3.ok && c3.data.toolTrace.some((x) => x.name === 'search_products'), `本地模式 ${c3.data?.mode}`);

  const c4 = await call('/api/ai/chat', { method: 'POST', token: t, body: { scene: 'support', text: '这个订单我要退款' } });
  log('AI 客服·退款（工具落库）', c4.ok, c4.data?.content?.split('\n')[0]);

  const c5 = await call('/api/ai/chat', { method: 'POST', token: t, body: { scene: 'ops', text: '看下滞销品' } });
  log('越权：买家调运营智能体应 403', !c5.ok, c5.error?.code);

  const c6 = await call('/api/ai/chat', { method: 'POST', token: at, body: { scene: 'ops', text: '看下滞销品' } });
  log('运营智能体·销售洞察', c6.ok && c6.data.content.includes('滞销'), `工具 ${c6.data?.toolTrace?.length} 次`);

  const stats = await call('/api/admin/stats', { token: at });
  log('商家看板', stats.ok, `GMV ¥${stats.data?.gmv}，AI 会话 ${stats.data?.ai?.conversations}`);

  const toShip = await call('/api/orders', { method: 'POST', token: t, body: { address: '北京市朝阳区建国路 88 号', productId: p.id, qty: 1 } });
  await call(`/api/orders/${toShip.data.id}/pay`, { method: 'POST', token: t });
  const shipCheck = await call(`/api/admin/orders/${toShip.data.id}/ship`, {
    method: 'PATCH', token: at, body: { carrier: '顺丰速运', trackingNo: 'SF' + Date.now() },
  });
  log('商家发货（含运单）', shipCheck.ok && shipCheck.data?.trackingNo, `${shipCheck.data?.carrier} ${shipCheck.data?.trackingNo}`);

  const confirm = await call(`/api/orders/${toShip.data.id}/confirm`, { method: 'POST', token: t });
  log('买家确认收货', confirm.ok && confirm.data?.status === 'completed', confirm.data?.statusLabel);

  // 取消订单应回补库存
  const beforeStock = (await call(`/api/products/${p.id}`)).data?.stock;
  const toCancel = await call('/api/orders', { method: 'POST', token: t, body: { address: '北京市朝阳区建国路 88 号', productId: p.id, qty: 2 } });
  const afterOrderStock = (await call(`/api/products/${p.id}`)).data?.stock;
  const cancelled = await call(`/api/orders/${toCancel.data.id}/cancel`, { method: 'POST', token: t, body: { reason: '冒烟-取消' } });
  const afterCancelStock = (await call(`/api/products/${p.id}`)).data?.stock;
  log('取消订单回补库存', cancelled.ok && afterCancelStock === beforeStock,
    `${beforeStock} → ${afterOrderStock} → ${afterCancelStock}`);
  const reCancel = await call(`/api/orders/${toCancel.data.id}/cancel`, { method: 'POST', token: t, body: {} });
  log('已取消订单不可重复取消', !reCancel.ok, reCancel.error?.code);

  // 地址簿
  const addr = await call('/api/addresses', { method: 'POST', token: t, body: { name: '张三', phone: '13800138000', region: '北京市 朝阳区', detail: '建国路 88 号 1 单元' } });
  log('新增地址', addr.ok && addr.data?.full, addr.data?.full);
  await call(`/api/addresses/${addr.data.id}/default`, { method: 'POST', token: t });
  const addrList = await call('/api/addresses', { token: t });
  log('地址簿列表 + 默认地址', addrList.ok && addrList.data.some((x) => x.id === addr.data.id && x.isDefault),
    `${addrList.data?.length} 条`);
  const badPhone = await call('/api/addresses', { method: 'POST', token: t, body: { name: '李四', phone: 'abc', region: '上海市', detail: '南京路 1 号' } });
  log('非法手机号被拒', !badPhone.ok && badPhone.error?.code === 'INVALID', badPhone.error?.code);
  const delAddr = await call(`/api/addresses/${addr.data.id}`, { method: 'DELETE', token: t });
  log('删除地址', delAddr.ok);

  // AI 转人工
  const conv = await call('/api/ai/chat', { method: 'POST', token: t, body: { scene: 'support', text: '我要人工客服' } });
  const tk = await call('/api/ai/handoff', { method: 'POST', token: t, body: { conversationId: conv.data?.conversationId, summary: '冒烟-转人工', contact: 'demo@mall.dev' } });
  log('AI 转人工建单', tk.ok && tk.data?.id, `工单 #${tk.data?.id}`);
  const tkDup = await call('/api/ai/handoff', { method: 'POST', token: t, body: { conversationId: conv.data?.conversationId, summary: '再次提交' } });
  log('同会话重复转人工去重', tkDup.ok && tkDup.data?.duplicate, '复用已有工单');
  const tkList = await call('/api/admin/tickets', { token: at });
  log('后台工单列表', tkList.ok, `${tkList.data?.length} 条`);
  const tkDone = await call(`/api/admin/tickets/${tk.data.id}`, { method: 'PATCH', token: at, body: { reply: '已为你接入人工客服' } });
  log('后台处理工单', tkDone.ok && tkDone.data?.status === 'resolved', tkDone.data?.status);

  const refunds = await call('/api/admin/refunds?pageSize=200', { token: at });
  log('退款单列表', refunds.ok, `${refunds.data?.length} 条`);

  const forbidden = await call('/api/admin/stats', { token: t });
  log('越权：买家访问后台应 403', !forbidden.ok, forbidden.error?.code);

  console.log(`\n▶ 冒烟测试结束：${pass} 通过 / ${fail} 失败\n`);
  if (fail) process.exitCode = 1;
})().catch((e) => { console.error('冒烟测试失败:', e.message); process.exit(1); });
