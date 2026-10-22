// 商城 2.0 主干链路验证：领券 → Preview → 下单 → 支付 → 发货 → 物流 → 评价
const BASE = process.env.B || 'http://127.0.0.1:3010';

async function call(path, { method = 'GET', token, body } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ok: j.ok, data: j.data, error: j.error };
}

let pass = 0; let fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass += 1; console.log(`✅ ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail += 1; console.log(`❌ ${name}${extra ? ' — ' + extra : ''}`); }
}

const login = async (email, password) => {
  const r = await call('/api/auth/login', { method: 'POST', body: { email, password } });
  if (!r.ok) throw new Error('登录失败 ' + JSON.stringify(r.error));
  return r.data.token;
};

(async () => {
  const buyer = await login('demo@mall.dev', 'demo123');
  const admin = await login('admin@mall.dev', 'admin123');

  // 1. 券中心 + 领取
  const coupons = await call('/api/coupons', { token: buyer });
  check('券中心可用', coupons.ok && coupons.data.length >= 5, `${coupons.data?.length} 张`);

  const target = coupons.data.find((c) => c.type === 'reduce' && c.threshold <= 199 && c.canClaim);
  const claim = await call(`/api/coupons/${target.id}/claim`, { method: 'POST', token: buyer });
  check('领取优惠券', claim.ok, claim.data?.title);
  const again = await call(`/api/coupons/${target.id}/claim`, { method: 'POST', token: buyer });
  check('超出每人限领被拒', !again.ok, again.error?.code);

  const myCoupons = await call('/api/my/coupons?status=unused', { token: buyer });
  const userCouponId = myCoupons.data?.find((c) => c.couponId === target.id)?.id;
  check('我的券包可见', !!userCouponId, `userCoupon #${userCouponId}`);

  // 2. 商品详情（SKU / 店铺 / 评价摘要 / 同类对比）
  const prod = await call('/api/products/2', { token: buyer });
  check('商品详情含 SKU', prod.data?.skus?.length > 0, `${prod.data.skus.length} 个规格`);
  check('商品详情含店铺', !!prod.data?.shop?.name, prod.data.shop?.name);
  check('商品详情含评价摘要', prod.data?.reviewSummary != null, `均分 ${prod.data.reviewSummary.average}`);
  check('商品详情含同类对比', prod.data?.compare?.length > 0, `${prod.data.compare.length} 件`);
  check('收藏状态字段存在', prod.data?.favorite === false);

  const skuId = prod.data.skus[0].id;

  // 3. 预览：券 + 积分
  const preview = await call('/api/orders/preview', {
    method: 'POST', token: buyer,
    body: { productId: 2, skuId, qty: 1, userCouponId, usePoints: 500 },
  });
  check('结算预览可用', preview.ok, `实付 ¥${preview.data?.display?.total}`);
  check('预览有优惠明细', preview.data?.steps?.length > 0, preview.data?.steps?.map((s) => s.label).join(' / '));
  check('券在预览中生效', preview.data?.couponDiscountCents > 0, `-¥${(preview.data?.couponDiscountCents / 100).toFixed(2)}`);
  check('积分在预览中抵扣', preview.data?.pointsDiscountCents > 0, `-¥${(preview.data?.pointsDiscountCents / 100).toFixed(2)}`);
  check('实付不为负', preview.data?.totalCents >= 0);

  // 4. 下单，校验与预览逐分一致
  const addr = '北京市朝阳区建国路 88 号 SOHO 现代城 B 座 1203';
  const order = await call('/api/orders', {
    method: 'POST', token: buyer,
    body: { address: addr, productId: 2, skuId, qty: 1, userCouponId, usePoints: 500, idemKey: 'verify-' + Date.now() },
  });
  check('下单成功', order.ok, order.data?.orderNo);
  check('下单金额 == 预览金额',
    order.data?.total === preview.data?.display?.total,
    `订单 ¥${order.data?.total} / 预览 ¥${preview.data?.display?.total}`);
  check('订单记录券优惠', order.data?.pricing?.couponDiscount > 0, `-¥${order.data?.pricing?.couponDiscount}`);
  check('订单记录积分抵扣', order.data?.pricing?.pointsUsed === 500, `${order.data?.pricing?.pointsUsed} 积分`);
  check('订单记录规格', !!order.data?.items?.[0]?.specText, order.data?.items?.[0]?.specText);

  // 5. 券不能重复使用
  const reuse = await call('/api/orders', {
    method: 'POST', token: buyer,
    body: { address: addr, productId: 2, skuId, qty: 1, userCouponId, idemKey: 'verify2-' + Date.now() },
  });
  check('券重复使用被拒', !reuse.ok, reuse.error?.code);

  // 6. 支付 → 积分返还与消耗
  const before = await call('/api/points', { token: buyer });
  const pay = await call(`/api/orders/${order.data.id}/pay`, { method: 'POST', token: buyer });
  check('模拟支付成功', pay.ok && pay.data.status === 'paid', pay.data?.statusLabel);
  const after = await call('/api/points', { token: buyer });
  check('支付后积分变化正确',
    after.data.points === before.data.points + Math.floor(pay.data.total * 100 / 100) - 0,
    `${before.data.points} → ${after.data.points}（消费返 ${Math.floor(pay.data.total)}）`);

  // 7. 发货 + 物流轨迹
  const ship = await call(`/api/admin/orders/${order.data.id}/ship`, {
    method: 'PATCH', token: admin, body: { carrier: '顺丰速运', trackingNo: 'SF' + Date.now().toString().slice(-10) },
  });
  check('后台发货成功', ship.ok && ship.data.status === 'shipped');
  check('发货生成物流节点', ship.data.shipment?.events?.length >= 1, ship.data.shipment?.events?.[0]?.status);

  const adv1 = await call(`/api/admin/orders/${order.data.id}/shipment`, { method: 'PATCH', token: admin });
  check('推进物流 → 运输中', adv1.data?.shipment?.events?.some((e) => e.status === '运输中'));
  await call(`/api/admin/orders/${order.data.id}/shipment`, { method: 'PATCH', token: admin });
  const adv3 = await call(`/api/admin/orders/${order.data.id}/shipment`, { method: 'PATCH', token: admin });
  check('物流签收自动完成订单', adv3.data?.status === 'completed', adv3.data?.statusLabel);

  // 8. 评价
  const itemId = adv3.data.items[0].id;
  const review = await call('/api/reviews', {
    method: 'POST', token: buyer,
    body: { orderId: order.data.id, orderItemId: itemId, rating: 5, content: '台灯很好用，自动调光很省心。', anonymous: false },
  });
  check('提交评价成功', review.ok, `+${review.data?.pointsEarned} 积分`);
  const dup = await call('/api/reviews', {
    method: 'POST', token: buyer,
    body: { orderId: order.data.id, orderItemId: itemId, rating: 4, content: '再评一次' },
  });
  check('重复评价被拒', !dup.ok, dup.error?.code);

  const reviews = await call('/api/products/2/reviews');
  check('评价列表含评分分布', reviews.data?.breakdown?.dist?.length === 5,
    `好评率 ${reviews.data?.breakdown?.goodRate}%`);
  check('AI 评价摘要生成', !!reviews.data?.summary?.oneLine, reviews.data?.summary?.oneLine?.slice(0, 40) + '…');

  // 9. 秒杀下单
  const flash = await call('/api/flash-sales');
  const f = flash.data?.[0];
  const flashOrder = await call('/api/orders', {
    method: 'POST', token: buyer,
    body: { address: addr, productId: f.productId, flashSaleId: f.id, qty: 1, idemKey: 'flash-' + Date.now() },
  });
  check('秒杀价下单成功', flashOrder.ok, `¥${flashOrder.data?.total}（原价 ¥${f.origin}）`);
  check('秒杀价已生效', flashOrder.data?.pricing && flashOrder.data?.subtotal <= f.origin,
    `小计 ¥${flashOrder.data?.subtotal}`);

  // 10. 拼团
  const gb = await call('/api/group-buys');
  const g = gb.data?.[0];
  const team = await call('/api/orders/group', {
    method: 'POST', token: buyer,
    body: { groupBuyId: g.id, address: addr, idemKey: 'group-' + Date.now() },
  });
  check('开团成功', team.ok, `团 #${team.data?.team?.id}，还差 ${team.data?.team?.need} 人`);
  // 拼团价体现在成交单价上；实付还会叠加会员折扣与满减，所以不能直接拿 total 比
  check('拼团订单使用拼团价',
    team.data?.order?.items?.[0]?.price === g.price,
    `单价 ¥${team.data?.order?.items?.[0]?.price}（拼团价 ¥${g.price}），实付 ¥${team.data?.order?.total}`);

  // 11. 收藏 / 足迹 / 积分
  const fav = await call('/api/favorites/2', { method: 'POST', token: buyer });
  check('收藏切换', fav.ok && fav.data.favorited === false || fav.data.favorited === true, `favorited=${fav.data?.favorited}`);
  const favList = await call('/api/favorites', { token: buyer });
  check('收藏列表可读', favList.ok, `${favList.data?.total} 件`);
  const fp = await call('/api/footprints', { token: buyer });
  check('足迹按天分组', fp.ok && Array.isArray(fp.data?.groups), `${fp.data?.total} 条`);

  // 12. 内容流
  const feed = await call('/api/feed', { token: buyer });
  check('逛逛内容流', feed.ok && feed.data.items.length > 0, `${feed.data.items.length} 条`);
  check('内容挂商品', feed.data.items[0].products.length > 0, feed.data.items[0].products[0].title);

  // 13. 购物车按店铺分组
  await call('/api/cart', { method: 'POST', token: buyer, body: { productId: 2, skuId, qty: 1 } });
  const cart = await call('/api/cart', { token: buyer });
  check('购物车按店铺分组', cart.data?.groups?.length > 0, cart.data.groups.map((x) => x.shopName).join(' / '));
  check('购物车记录规格', !!cart.data?.items?.[0]?.specText, cart.data?.items?.[0]?.specText);

  // 14. AI 比价与算价（工具层真的被调到）
  const aiCmp = await call('/api/ai/chat', {
    method: 'POST', token: buyer, body: { scene: 'shopping', text: '第2个商品和同类比一下，哪个更值' },
  });
  const cmpTools = (aiCmp.data?.toolTrace || []).map((t) => t.name);
  check('AI 比价调用 compare_products', aiCmp.ok && cmpTools.includes('compare_products'), aiCmp.data?.content?.split('\n')[0]);
  check('AI 比价给出结论', /最便宜|口碑最好/.test(aiCmp.data?.content || ''));

  const aiQuote = await call('/api/ai/chat', {
    method: 'POST', token: buyer, body: { scene: 'shopping', text: '降噪耳机能便宜多少，有券吗' },
  });
  const quoteTools = (aiQuote.data?.toolTrace || []).map((t) => t.name);
  check('AI 算价调用 quote_order', aiQuote.ok && quoteTools.includes('quote_order'), aiQuote.data?.content?.split('\n')[0]);
  check('AI 算价给出实付与省钱', /实付/.test(aiQuote.data?.content || '') && /省/.test(aiQuote.data?.content || ''));

  // 15. 越权
  const forbidden = await call('/api/admin/stats', { token: buyer });
  check('买家访问后台被拒', !forbidden.ok, forbidden.error?.code);

  console.log(`\n▶ 结果：${pass} 通过 / ${fail} 失败\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('脚本异常:', e); process.exit(1); });
