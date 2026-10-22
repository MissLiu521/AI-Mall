/**
 * 商城全流程回归：凡是用户能在界面上点到的路径，这里都要有一条对应断言。
 *
 * 覆盖：访客浏览 → 注册 → 地址簿 → 购物车（含失效清理）→ 结算/取消回补
 *      → 支付/发货/收货/评价/回复 → 退款双向 → 秒杀限购 → 拼团成团
 *      → 后台商品/券/内容/工单 → 越权与非法入参
 *
 * 用法：B=http://127.0.0.1:3020 node scripts/verify-flows.js
 */
const BASE = process.env.B || 'http://127.0.0.1:3010';

async function call(path, { method = 'GET', token, body, headers } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let j = {};
  try { j = JSON.parse(text); } catch { j = { raw: text.slice(0, 200) }; }
  return { status: r.status, ok: j.ok, data: j.data, error: j.error };
}

let pass = 0; let fail = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { pass += 1; console.log(`✅ ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail += 1; failures.push(name + (extra ? ' — ' + extra : '')); console.log(`❌ ${name}${extra ? ' — ' + extra : ''}`); }
}
function section(t) { console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 30 - t.length))}`); }

const login = async (email, password) => {
  const r = await call('/api/auth/login', { method: 'POST', body: { email, password } });
  if (!r.ok) throw new Error(`登录失败 ${email}: ${r.error?.code} ${r.error?.message}`);
  return r.data.token;
};
const ts = Date.now().toString(36);
const ADDR = '上海市浦东新区世纪大道 100 号 环球金融中心 32 层';

(async () => {
  const buyer = await login('demo@mall.dev', 'demo123');
  const admin = await login('admin@mall.dev', 'admin123');

  // ═══════════ A. 访客可浏览的内容 ═══════════
  section('A 访客浏览');
  const meta = await call('/api/meta');
  check('元信息返回分类', meta.ok && meta.data.categories.length > 3, `${meta.data.categories.length} 个分类`);

  const listAsc = await call('/api/products?sort=price_asc&pageSize=8');
  const prices = (listAsc.data?.items || []).map((p) => p.price);
  check('价格升序排序有效', listAsc.ok && prices.every((v, i) => i === 0 || prices[i - 1] <= v),
    prices.slice(0, 4).join(' ≤ '));

  const searched = await call('/api/products?q=' + encodeURIComponent('耳机'));
  check('关键词搜索有结果', searched.ok && searched.data.items.length > 0, `${searched.data?.items?.length} 件`);

  const cat = encodeURIComponent((meta.data.categories[0] && meta.data.categories[0].name) || '');
  const byCat = await call(`/api/products?category=${cat}`);
  check('分类筛选只返回该分类', byCat.ok && byCat.data.items.every((p) => p.category === meta.data.categories[0].name),
    byCat.data?.items?.length + ' 件');

  const shops = await call('/api/shops');
  check('店铺列表可用', shops.ok && shops.data.length >= 3, shops.data?.map((s) => s.name).join(' / '));
  const byShop = await call(`/api/products?shopId=${shops.data[0].id}`);
  check('按店铺筛选有效', byShop.ok && byShop.data.items.every((p) => p.shopId === shops.data[0].id),
    byShop.data?.items?.length + ' 件');

  const rank = await call('/api/rankings');
  check('三张榜单齐全', rank.ok && rank.data.hot?.length && rank.data.rated?.length && rank.data.deals?.length,
    `热销 ${rank.data?.hot?.length} / 好评 ${rank.data?.rated?.length} / 降价 ${rank.data?.deals?.length}`);
  check('降价榜带降幅', rank.data.deals[0].dropPercent > 0, `降 ${rank.data.deals[0].dropPercent}%`);

  const guestProd = await call('/api/products/1');
  check('未登录也能看详情', guestProd.ok && guestProd.data.skus.length > 0);
  check('未登录收藏态为 false', guestProd.data?.favorite === false);

  const feedList = await call('/api/feed');
  const feedDetail = await call(`/api/feed/${feedList.data.items[0].id}`);
  check('逛逛详情可打开', feedDetail.ok && feedDetail.data.products.length > 0);
  const likeGuest = await call(`/api/feed/${feedList.data.items[0].id}/like`, { method: 'POST' });
  check('未登录点赞被拒', likeGuest.status === 401, likeGuest.error?.code);

  // ═══════════ B. 注册与地址簿 ═══════════
  section('B 注册与地址簿');
  const emailA = `flow_${ts}_a@test.dev`;
  const regA = await call('/api/auth/register', { method: 'POST', body: { email: emailA, password: 'test123', name: '流程甲' } });
  check('注册成功并返回 token', regA.ok && !!regA.data.token, regA.data?.user?.name);
  const userA = regA.data.token;

  const dupReg = await call('/api/auth/register', { method: 'POST', body: { email: emailA, password: 'test123' } });
  check('重复邮箱注册被拒', !dupReg.ok && dupReg.status === 409, dupReg.error?.code);
  const weak = await call('/api/auth/register', { method: 'POST', body: { email: `w_${ts}@test.dev`, password: '123' } });
  check('弱密码被拒', !weak.ok, weak.error?.code);

  const badAddr = await call('/api/addresses', { method: 'POST', token: userA, body: { name: '张三' } });
  check('地址缺字段被拒', !badAddr.ok, badAddr.error?.code);

  const addr1 = await call('/api/addresses', {
    method: 'POST', token: userA,
    body: { name: '张三', phone: '13800138000', region: '上海市 浦东新区', detail: '世纪大道 100 号 32 层' },
  });
  check('新建地址成功且自动设默认', addr1.ok && addr1.data.isDefault, addr1.data?.full);

  const addr2 = await call('/api/addresses', {
    method: 'POST', token: userA,
    body: { name: '李四', phone: '13900139000', region: '北京市 朝阳区', detail: '建国路 88 号 SOHO B 座' },
  });
  const setDefault = await call(`/api/addresses/${addr2.data.id}/default`, { method: 'POST', token: userA });
  check('切换默认地址', setDefault.ok && setDefault.data.isDefault);
  const addrList = await call('/api/addresses', { token: userA });
  check('同一时刻只有一个默认地址', addrList.data.filter((a) => a.isDefault).length === 1);

  const edited = await call(`/api/addresses/${addr1.data.id}`, {
    method: 'PATCH', token: userA, body: { detail: '世纪大道 200 号 33 层' },
  });
  check('编辑地址生效', edited.ok && edited.data.detail.includes('200'));
  const delAddr = await call(`/api/addresses/${addr1.data.id}`, { method: 'DELETE', token: userA });
  check('删除地址', delAddr.ok);

  // ═══════════ C. 后台商品 CRUD（同时供购物车失效场景用）═══════════
  section('C 后台商品 CRUD');
  const created = await call('/api/admin/products', {
    method: 'POST', token: admin,
    body: { title: `回归测试商品 ${ts}`, subtitle: '用于流程验证', price: 88, stock: 50, category: '家居', image: '🧪' },
  });
  check('后台创建商品', created.ok && created.data.id > 0, `#${created.data?.id} ¥${created.data?.price}`);
  const newId = created.data.id;

  const found = await call('/api/products?q=' + encodeURIComponent(`回归测试商品 ${ts}`));
  check('新商品前台可搜到', found.ok && found.data.items.length === 1);

  const priced = await call(`/api/admin/products/${newId}`, { method: 'PATCH', token: admin, body: { price: 66 } });
  check('后台改价生效', priced.ok && priced.data.price === 66);
  const cmp = await call(`/api/products/${newId}`);
  check('前台价格同步', cmp.data?.price === 66);

  const off = await call(`/api/admin/products/${newId}`, { method: 'PATCH', token: admin, body: { status: 'inactive' } });
  check('后台下架商品', off.ok && off.data.status === 'inactive');
  const gone = await call('/api/products?q=' + encodeURIComponent(`回归测试商品 ${ts}`));
  check('下架后前台列表不再出现', gone.data.items.length === 0);
  const offOrder = await call('/api/orders', {
    method: 'POST', token: userA, body: { address: ADDR, productId: newId, qty: 1, idemKey: 'off-' + ts },
  });
  check('下架商品下单被拒', !offOrder.ok && offOrder.error.code === 'OFF_SHELF', offOrder.error?.message);

  // ═══════════ D. 购物车 ═══════════
  section('D 购物车');
  const p1 = await call('/api/products/1');
  const sku1 = p1.data.skus[0];
  await call('/api/cart', { method: 'POST', token: userA, body: { productId: 1, skuId: sku1.id, qty: 1 } });
  const merged = await call('/api/cart', { method: 'POST', token: userA, body: { productId: 1, skuId: sku1.id, qty: 2 } });
  const line = merged.data.items.find((i) => i.product.id === 1 && i.skuId === sku1.id);
  check('同商品同规格重复加购合并数量', line?.qty === 3, `qty=${line?.qty}`);

  // 先上架再加购，随后下架，制造"购物车里商品失效"的真实场景
  await call(`/api/admin/products/${newId}`, { method: 'PATCH', token: admin, body: { status: 'active' } });
  await call('/api/cart', { method: 'POST', token: userA, body: { productId: newId, qty: 1 } });
  await call(`/api/admin/products/${newId}`, { method: 'PATCH', token: admin, body: { status: 'inactive' } });
  const cart1 = await call('/api/cart', { token: userA });
  check('购物车标记失效商品', cart1.data.items.some((i) => i.product.id === newId && i.invalid),
    `invalidCount=${cart1.data.invalidCount}`);

  const upd = await call(`/api/cart/${line.cartId}`, { method: 'PATCH', token: userA, body: { qty: 2 } });
  check('修改购物车数量', upd.ok && upd.data.items.find((i) => i.cartId === line.cartId)?.qty === 2);

  const off1 = await call(`/api/cart/${line.cartId}/select`, { method: 'PATCH', token: userA, body: { selected: false } });
  const afterOff = await call('/api/cart', { token: userA });
  check('取消勾选后选中件数减少', afterOff.data.selectedCount === 0, `selectedCount=${afterOff.data.selectedCount}`);

  const allOn = await call('/api/cart/select-all', { method: 'PATCH', token: userA, body: { selected: true } });
  check('全选生效', allOn.ok && allOn.data.selectedCount > 0, `selectedCount=${allOn.data.selectedCount}`);

  const cleaned = await call('/api/cart/invalid', { method: 'DELETE', token: userA });
  check('一键清理失效商品', cleaned.ok && cleaned.data.removed === 1 && cleaned.data.cart.items.every((i) => !i.invalid),
    `清理 ${cleaned.data?.removed} 件，剩余 ${cleaned.data?.cart?.items?.length} 行`);

  await call('/api/cart', { method: 'DELETE', token: userA });
  const emptyPreview = await call('/api/orders/preview', {
    method: 'POST', token: userA, body: { items: [] },
  });
  check('空购物车结算被拒', !emptyPreview.ok && emptyPreview.error.code === 'EMPTY_CART', emptyPreview.error?.code);

  // ═══════════ E. 下单 / 幂等 / 取消回补 ═══════════
  section('E 下单与取消回补');
  const stockBefore = (await call('/api/products/1')).data.totalStock;
  const idem = 'idem-' + ts;
  const o1 = await call('/api/orders', {
    method: 'POST', token: userA,
    body: { address: ADDR, productId: 1, skuId: sku1.id, qty: 2, idemKey: idem },
  });
  check('下单成功', o1.ok && o1.data.status === 'pending_payment', o1.data?.orderNo || JSON.stringify(o1.error));
  const o1again = await call('/api/orders', {
    method: 'POST', token: userA,
    body: { address: ADDR, productId: 1, skuId: sku1.id, qty: 2, idemKey: idem },
  });
  check('相同幂等键不会重复下单', o1again.ok && o1again.data.id === o1.data.id, `订单 #${o1again.data?.id}`);
  const stockAfter = (await call('/api/products/1')).data.totalStock;
  check('下单扣减库存', stockAfter === stockBefore - 2, `${stockBefore} → ${stockAfter}`);

  // 领券后用券下单再取消，验证券与积分回退（用有积分余额的演示账号）
  const couponCenter = await call('/api/coupons', { token: buyer });
  const claimable = couponCenter.data.find((c) => c.canClaim && c.type === 'reduce');
  if (claimable) await call(`/api/coupons/${claimable.id}/claim`, { method: 'POST', token: buyer });
  const bag = await call('/api/my/coupons?status=unused', { token: buyer });
  const ucId = bag.data[0]?.id;
  check('演示账号有可用券', !!ucId, bag.data[0]?.title);

  const pointsBefore = (await call('/api/points', { token: buyer })).data.points;
  check('演示账号有积分余额', pointsBefore > 0, `${pointsBefore} 积分`);
  const o2 = await call('/api/orders', {
    method: 'POST', token: buyer,
    body: { address: ADDR, productId: 1, skuId: sku1.id, qty: 1, userCouponId: ucId, usePoints: 100, idemKey: 'c-' + ts },
  });
  check('用券 + 积分下单成功', o2.ok, `实付 ¥${o2.data?.total}，券 -¥${o2.data?.pricing?.couponDiscount}`);
  check('积分按上限实际抵扣', o2.data?.pricing?.pointsUsed > 0, `${o2.data?.pricing?.pointsUsed} 积分`);
  const pointsAfterOrder = (await call('/api/points', { token: buyer })).data.points;
  check('下单立即扣减抵扣积分', pointsAfterOrder === pointsBefore - o2.data.pricing.pointsUsed,
    `${pointsBefore} → ${pointsAfterOrder}`);

  const stockBeforeCancel = (await call('/api/products/1')).data.totalStock;
  const cancelled = await call(`/api/orders/${o2.data.id}/cancel`, { method: 'POST', token: buyer, body: { reason: '不想要了' } });
  check('取消订单成功', cancelled.ok && cancelled.data.status === 'cancelled');
  const stockAfterCancel = (await call('/api/products/1')).data.totalStock;
  check('取消后库存回补', stockAfterCancel === stockBeforeCancel + 1, `${stockBeforeCancel} → ${stockAfterCancel}`);
  const bagAfter = await call('/api/my/coupons?status=unused', { token: buyer });
  check('取消后优惠券退回', bagAfter.data.some((c) => c.id === ucId));
  const pointsAfterCancel = (await call('/api/points', { token: buyer })).data.points;
  check('取消后退回抵扣积分', pointsAfterCancel === pointsBefore, `${pointsAfterOrder} → ${pointsAfterCancel}`);

  const recancel = await call(`/api/orders/${o2.data.id}/cancel`, { method: 'POST', token: buyer });
  check('已取消订单不能再次取消', !recancel.ok, recancel.error?.code);

  // ═══════════ F. 支付 → 发货 → 收货 → 评价 → 回复 ═══════════
  section('F 交易完成与评价');
  const early = await call(`/api/orders/${o1.data.id}/refund`, { method: 'POST', token: userA, body: { reason: '未支付就退款' } });
  check('未支付订单不能申请退款', !early.ok && early.error.code === 'NOT_ELIGIBLE', early.error?.message);

  const paid = await call(`/api/orders/${o1.data.id}/pay`, { method: 'POST', token: userA });
  check('支付成功', paid.ok && paid.data.status === 'paid');
  const repayed = await call(`/api/orders/${o1.data.id}/pay`, { method: 'POST', token: userA });
  check('重复支付被拒', !repayed.ok && repayed.error.code === 'BAD_STATUS');

  const earlyReview = await call('/api/reviews', {
    method: 'POST', token: userA,
    body: { orderId: o1.data.id, orderItemId: paid.data.items[0].id, rating: 5, content: '还没收到就评' },
  });
  check('未完成订单不能评价', !earlyReview.ok, earlyReview.error?.code);

  const shipped = await call(`/api/admin/orders/${o1.data.id}/ship`, {
    method: 'PATCH', token: admin, body: { carrier: '京东物流', trackingNo: 'JD' + ts.toUpperCase() },
  });
  check('后台发货', shipped.ok && shipped.data.status === 'shipped');
  const reShip = await call(`/api/admin/orders/${o1.data.id}/ship`, { method: 'PATCH', token: admin, body: {} });
  check('重复发货被拒', !reShip.ok, reShip.error?.code);

  const timeline = await call(`/api/orders/${o1.data.id}`, { token: userA });
  check('用户侧可见物流轨迹', timeline.data?.shipment?.events?.length >= 1,
    timeline.data?.shipment?.events?.[0]?.description);
  check('物流给出下一步提示', !!timeline.data?.shipment?.next, timeline.data?.shipment?.next);

  const received = await call(`/api/orders/${o1.data.id}/confirm`, { method: 'POST', token: userA });
  check('用户确认收货', received.ok && received.data.status === 'completed');

  const ratingBefore = (await call('/api/products/1/reviews')).data.breakdown.total;
  const review = await call('/api/reviews', {
    method: 'POST', token: userA,
    body: { orderId: o1.data.id, orderItemId: received.data.items[0].id, rating: 4, content: '整体不错，物流很快，包装完好。', anonymous: false },
  });
  check('提交评价成功', review.ok, `+${review.data?.pointsEarned} 积分`);
  const ratingAfter = (await call('/api/products/1/reviews')).data.breakdown.total;
  check('评价计入评分分布', ratingAfter === ratingBefore + 1, `${ratingBefore} → ${ratingAfter}`);

  const reviewList = await call('/api/products/1/reviews?rating=4');
  const mine = reviewList.data.items.find((r) => r.id === review.data.id);
  check('按星级筛选能筛到', !!mine);

  const useful = await call(`/api/reviews/${review.data.id}/useful`, { method: 'POST', token: userA });
  check('标记评价有用', useful.ok && useful.data.useful >= 1, `有用 ${useful.data?.useful}`);

  const replied = await call(`/api/admin/reviews/${review.data.id}`, {
    method: 'PATCH', token: admin, body: { reply: '感谢反馈，已记录您的建议。' },
  });
  check('后台回复评价', replied.ok);
  const afterReply = await call('/api/products/1/reviews');
  const repliedItem = afterReply.data.items.find((r) => r.id === review.data.id);
  check('前台能看到商家回复', repliedItem?.reply?.includes('感谢反馈'), repliedItem?.reply);

  const orderReviewed = await call(`/api/orders/${o1.data.id}`, { token: userA });
  check('订单项标记已评价', orderReviewed.data.items[0].reviewed === true);

  // ═══════════ G. 退款全流程 ═══════════
  section('G 退款双向流程');
  const elig = await call(`/api/orders/${o1.data.id}/eligibility`, { token: userA });
  check('售后资格可查询', elig.ok && elig.data.eligible, elig.data?.reason);

  const refund = await call(`/api/orders/${o1.data.id}/refund`, { method: 'POST', token: userA, body: { reason: '尺寸不合适' } });
  check('申请退款', refund.ok && refund.data.status === 'pending', `退款单 #${refund.data?.id}`);
  const dupRefund = await call(`/api/orders/${o1.data.id}/refund`, { method: 'POST', token: userA, body: { reason: '再申请一次' } });
  check('重复申请退款被拒', !dupRefund.ok, dupRefund.error?.code);

  const refunding = await call(`/api/orders/${o1.data.id}`, { token: userA });
  check('订单进入退款中', refunding.data.status === 'refunding');
  check('退款时间轴可读', refunding.data.refund?.nodes?.length === 3,
    refunding.data.refund?.nextAction);

  const rejected = await call(`/api/admin/refunds/${refund.data.id}`, {
    method: 'PATCH', token: admin, body: { approve: false, reason: '商品已使用影响二次销售' },
  });
  check('后台驳回退款', rejected.ok && rejected.data.status === 'rejected');
  const backToCompleted = await call(`/api/orders/${o1.data.id}`, { token: userA });
  check('驳回后订单回到原状态（已完成）', backToCompleted.data.status === 'completed', backToCompleted.data.statusLabel);

  const refund2 = await call(`/api/orders/${o1.data.id}/refund`, { method: 'POST', token: userA, body: { reason: '仍要退，协商一致' } });
  check('驳回后可再次申请', refund2.ok, `退款单 #${refund2.data?.id}`);
  const stockBeforeRefund = (await call('/api/products/1')).data.totalStock;
  const approved = await call(`/api/admin/refunds/${refund2.data.id}`, { method: 'PATCH', token: admin, body: { approve: true } });
  check('后台通过退款', approved.ok && approved.data.status === 'approved');
  const refunded = await call(`/api/orders/${o1.data.id}`, { token: userA });
  check('订单变为已退款', refunded.data.status === 'refunded', refunded.data.statusLabel);
  const stockAfterRefund = (await call('/api/products/1')).data.totalStock;
  check('退款后库存回补', stockAfterRefund === stockBeforeRefund + 2, `${stockBeforeRefund} → ${stockAfterRefund}`);

  // ═══════════ H. 秒杀限购 ═══════════
  section('H 秒杀');
  const flash = (await call('/api/flash-sales')).data[0];
  check('秒杀场次可读', !!flash, `${flash?.productName} ¥${flash?.price} / 限购 ${flash?.limitPerUser}`);
  const userB = (await call('/api/auth/register', {
    method: 'POST', body: { email: `flow_${ts}_b@test.dev`, password: 'test123', name: '流程乙' },
  })).data.token;

  const flashFirst = await call('/api/orders', {
    method: 'POST', token: userB,
    body: { address: ADDR, productId: flash.productId, qty: flash.limitPerUser, flashSaleId: flash.id, idemKey: 'f1-' + ts },
  });
  check('秒杀下单成功（买满限购数）', flashFirst.ok, `¥${flashFirst.data?.total}`);
  const flashOver = await call('/api/orders', {
    method: 'POST', token: userB,
    body: { address: ADDR, productId: flash.productId, qty: 1, flashSaleId: flash.id, idemKey: 'f2-' + ts },
  });
  check('超出每人限购被拒', !flashOver.ok, flashOver.error?.code);

  // 秒杀价在结算预览中也要生效（否则预览与实付不一致）
  const flashPreview = await call('/api/orders/preview', {
    method: 'POST', token: userB, body: { productId: flash.productId, qty: 1, flashSaleId: flash.id },
  });
  check('结算预览使用秒杀价', flashPreview.ok && flashPreview.data.items[0].priceCents === Math.round(flash.price * 100),
    `预览单价 ¥${flashPreview.data?.items?.[0]?.priceCents / 100} / 秒杀价 ¥${flash.price}`);
  check('预览标注秒杀场次', flashPreview.data?.campaign?.type === 'flash', flashPreview.data?.campaign?.title);

  // ═══════════ I. 拼团 ═══════════
  section('I 拼团');
  const gb = (await call('/api/group-buys')).data[0];
  const userC = (await call('/api/auth/register', {
    method: 'POST', body: { email: `flow_${ts}_c@test.dev`, password: 'test123', name: '流程丙' },
  })).data.token;

  const pointsCBefore = (await call('/api/points', { token: userC })).data.points;
  const teamOpen = await call('/api/orders/group', {
    method: 'POST', token: userC, body: { groupBuyId: gb.id, address: ADDR, idemKey: 'g1-' + ts },
  });
  check('开团成功', teamOpen.ok && teamOpen.data.team.need > 0, `团 #${teamOpen.data?.team?.id}，还差 ${teamOpen.data?.team?.need} 人`);

  const selfJoin = await call('/api/orders/group', {
    method: 'POST', token: userC,
    body: { groupBuyId: gb.id, teamId: teamOpen.data.team.id, address: ADDR, idemKey: 'g2-' + ts },
  });
  check('同一人不能重复参团', !selfJoin.ok, selfJoin.error?.code);

  const userD = (await call('/api/auth/register', {
    method: 'POST', body: { email: `flow_${ts}_d@test.dev`, password: 'test123', name: '流程丁' },
  })).data.token;
  const join = await call('/api/orders/group', {
    method: 'POST', token: userD,
    body: { groupBuyId: gb.id, teamId: teamOpen.data.team.id, address: ADDR, idemKey: 'g3-' + ts },
  });
  check('参团并成团', join.ok && join.data.team.success === true,
    `已 ${join.data?.team?.joined}/${join.data?.team?.required} 人`);

  const teamOrderC = await call(`/api/orders/${teamOpen.data.order.id}`, { token: userC });
  check('成团后团长订单自动待发货', teamOrderC.data.status === 'paid', teamOrderC.data.statusLabel);
  const pointsCAfter = (await call('/api/points', { token: userC })).data.points;
  check('成团计入消费并返积分', pointsCAfter > pointsCBefore,
    `${pointsCBefore} → ${pointsCAfter}（应约 +${Math.floor(teamOpen.data.order.total)}）`);

  const myTeams = await call('/api/my/teams', { token: userC });
  check('我的拼团可见', myTeams.ok && myTeams.data.length >= 1, `${myTeams.data?.length} 个团`);
  const gbDetail = await call(`/api/group-buys/${gb.id}`, { token: userC });
  check('拼团详情可开', gbDetail.ok && gbDetail.data.required >= 2);

  // ═══════════ J. 后台券 / 内容 / 工单 ═══════════
  section('J 后台运营');
  const newCoupon = await call('/api/admin/coupons', {
    method: 'POST', token: admin,
    body: { title: `回归券 ${ts}`, type: 'reduce', threshold: 50, value: 10, total: 5, perUser: 1, days: 7 },
  });
  check('后台创建优惠券', newCoupon.ok && newCoupon.data.id > 0, newCoupon.data?.title);
  const center = await call('/api/coupons', { token: userB });
  const inCenter = center.data.find((c) => c.title === `回归券 ${ts}`);
  check('新券出现在领券中心', !!inCenter && inCenter.threshold === 50);
  const claimNew = await call(`/api/coupons/${newCoupon.data.id}/claim`, { method: 'POST', token: userB });
  check('新券可领取', claimNew.ok, claimNew.data?.title);

  const newFeed = await call('/api/admin/feeds', {
    method: 'POST', token: admin,
    body: { type: 'image', title: `回归内容 ${ts}`, body: '这是一条用于流程验证的内容。', cover: '🧪', media: 'linear-gradient(135deg,#6366f1,#a855f7)', productIds: [1, 2] },
  });
  check('后台发布内容', newFeed.ok && newFeed.data.id > 0);
  const feedFront = await call('/api/feed');
  check('新内容出现在逛逛', feedFront.data.items.some((f) => f.title === `回归内容 ${ts}`));
  const liked = await call(`/api/feed/${newFeed.data.id}/like`, { method: 'POST', token: userB });
  check('内容点赞', liked.ok && liked.data.liked === true, `赞 ${liked.data?.likes}`);
  const unliked = await call(`/api/feed/${newFeed.data.id}/like`, { method: 'POST', token: userB });
  check('再次点赞取消', unliked.ok && unliked.data.liked === false);
  const delFeed = await call(`/api/admin/feeds/${newFeed.data.id}`, { method: 'DELETE', token: admin });
  check('后台删除内容', delFeed.ok);

  const handoff = await call('/api/ai/handoff', {
    method: 'POST', token: userB,
    body: { summary: '用户要求人工核对订单金额', contact: 'flow@test.dev' },
  });
  check('AI 转人工落工单', handoff.ok && handoff.data.id > 0, `工单 #${handoff.data?.id}`);
  const tickets = await call('/api/admin/tickets?status=open', { token: admin });
  check('后台可见待处理工单', tickets.ok && tickets.data.some((t) => t.id === handoff.data.id));
  const resolved = await call(`/api/admin/tickets/${handoff.data.id}`, {
    method: 'PATCH', token: admin, body: { reply: '已核实，金额无误，优惠明细已发送。' },
  });
  check('后台回复工单并结单', resolved.ok && resolved.data.status === 'resolved');

  const stats = await call('/api/admin/stats', { token: admin });
  check('后台看板含营销指标', stats.ok && typeof stats.data.reviewCount === 'number' && typeof stats.data.formingTeams === 'number',
    `评价 ${stats.data?.reviewCount} / 券 ${stats.data?.couponClaimed} / 秒杀 ${stats.data?.activeFlash}`);

  // ═══════════ G2. 已支付订单取消：资产必须回滚 ═══════════
  section('G2 已支付订单取消');
  const o3 = await call('/api/orders', {
    method: 'POST', token: userA,
    body: { address: ADDR, productId: 2, skuId: (await call('/api/products/2')).data.skus[0].id, qty: 1, idemKey: 'p-' + ts },
  });
  const beforePay = (await call('/api/points', { token: userA })).data;
  await call(`/api/orders/${o3.data.id}/pay`, { method: 'POST', token: userA });
  const afterPay = (await call('/api/points', { token: userA })).data;
  check('支付后累计消费增加', afterPay.totalSpent > beforePay.totalSpent,
    `¥${beforePay.totalSpent} → ¥${afterPay.totalSpent}`);
  check('支付后返积分到账', afterPay.points > beforePay.points,
    `${beforePay.points} → ${afterPay.points}`);

  const cancelPaid = await call(`/api/orders/${o3.data.id}/cancel`, { method: 'POST', token: userA, body: { reason: '拍错了' } });
  check('已支付订单可取消（模拟原路退回）', cancelPaid.ok && cancelPaid.data.status === 'cancelled');
  const afterCancel = (await call('/api/points', { token: userA })).data;
  check('取消后累计消费回退', afterCancel.totalSpent === beforePay.totalSpent,
    `¥${afterPay.totalSpent} → ¥${afterCancel.totalSpent}`);
  check('取消后扣回消费返积分', afterCancel.points === beforePay.points,
    `${afterPay.points} → ${afterCancel.points}（不能靠下单取消刷积分）`);

  // ═══════════ G3. 券的三种类型 ═══════════
  section('G3 券类型');
  const centerA = await call('/api/coupons', { token: userA });
  const discountCoupon = centerA.data.find((c) => c.type === 'discount' && c.canClaim);
  if (discountCoupon) {
    await call(`/api/coupons/${discountCoupon.id}/claim`, { method: 'POST', token: userA });
    const bagA = await call('/api/my/coupons?status=unused', { token: userA });
    const uc = bagA.data.find((c) => c.couponId === discountCoupon.id);
    const pv = await call('/api/orders/preview', {
      method: 'POST', token: userA,
      body: { productId: 9, qty: 1, userCouponId: uc.id },
    });
    check('折扣券按比例减免', pv.ok && pv.data.couponDiscountCents > 0,
      `-¥${(pv.data?.couponDiscountCents / 100).toFixed(2)}（${discountCoupon.rule}）`);
    check('折扣券不超过封顶', pv.data.couponDiscountCents <= Math.round((discountCoupon.maxDiscount || 9999) * 100),
      `封顶 ¥${discountCoupon.maxDiscount}`);
  }

  const freeShip = centerA.data.find((c) => c.type === 'free_ship' && c.canClaim);
  if (freeShip) {
    await call(`/api/coupons/${freeShip.id}/claim`, { method: 'POST', token: userA });
    const bagA = await call('/api/my/coupons?status=unused', { token: userA });
    const uc = bagA.data.find((c) => c.couponId === freeShip.id);
    const cheap = (await call('/api/products?sort=price_asc&pageSize=1')).data.items[0];
    const noCoupon = await call('/api/orders/preview', { method: 'POST', token: userA, body: { productId: cheap.id, qty: 1 } });
    const withCoupon = await call('/api/orders/preview', {
      method: 'POST', token: userA, body: { productId: cheap.id, qty: 1, userCouponId: uc.id },
    });
    check('小额订单本来要运费', noCoupon.data.shippingCents > 0, `¥${(noCoupon.data.shippingCents / 100).toFixed(2)}`);
    check('免邮券把运费减为 0', withCoupon.ok && withCoupon.data.shippingCents === 0,
      `实付 ¥${withCoupon.data?.display?.total}`);
  }

  // ═══════════ L. AI 三个场景 + 后台 AI 配置 ═══════════
  section('L AI 能力');
  const aiShop = await call('/api/ai/chat', {
    method: 'POST', token: buyer, body: { scene: 'shopping', text: '推荐一款降噪耳机，预算 1000 以内' },
  });
  check('AI 导购能推荐商品', aiShop.ok && /耳机|推荐/.test(aiShop.data.content),
    aiShop.data?.content?.split('\n')[0]?.slice(0, 40));
  check('AI 导购调用了检索工具',
    (aiShop.data?.toolTrace || []).some((t) => t.name === 'search_products'),
    (aiShop.data?.toolTrace || []).map((t) => t.name).join(','));

  const aiSupport = await call('/api/ai/chat', {
    method: 'POST', token: buyer, body: { scene: 'support', text: '我的订单到哪了' },
  });
  check('AI 客服能查订单', aiSupport.ok && (aiSupport.data?.toolTrace || []).some((t) => t.name.includes('order')),
    aiSupport.data?.content?.split('\n')[0]?.slice(0, 40));

  const aiOps = await call('/api/admin/ai/ops', { method: 'POST', token: admin, body: { text: '最近哪些商品滞销，给点建议' } });
  check('运营智能体可回答', aiOps.ok && aiOps.data.content.length > 10, aiOps.data?.content?.slice(0, 40));
  const aiOpsByBuyer = await call('/api/admin/ai/ops', { method: 'POST', token: buyer, body: { text: '帮我看看数据' } });
  check('买家不能用运营智能体', aiOpsByBuyer.status === 403, aiOpsByBuyer.error?.code);

  const cfg = await call('/api/admin/ai/config', { token: admin });
  check('后台可读 AI 配置', cfg.ok && !!cfg.data.model, cfg.data?.model);
  const cfgPut = await call('/api/admin/ai/config', { method: 'PUT', token: admin, body: { temperature: 0.5 } });
  check('后台可改 AI 参数', cfgPut.ok);
  const cfgAfter = await call('/api/admin/ai/config', { token: admin });
  check('AI 参数已持久化', Number(cfgAfter.data.temperature) === 0.5, String(cfgAfter.data.temperature));

  const kbQ = '金卡会员生日有什么礼物';
  const kbAdd = await call('/api/admin/kb', {
    method: 'POST', token: admin, body: { question: kbQ, answer: '金卡会员生日当月可领 50 元无门槛券。', tags: '会员,生日' },
  });
  check('后台新增知识库条目', kbAdd.ok && kbAdd.data.id > 0);
  const aiKb = await call('/api/ai/chat', {
    method: 'POST', token: buyer, body: { scene: 'support', text: kbQ },
  });
  check('AI 客服命中新知识', aiKb.ok && aiKb.data.content.includes('50 元'),
    aiKb.data?.content?.slice(0, 50));
  const kbEdit = await call(`/api/admin/kb/${kbAdd.data.id}`, {
    method: 'PATCH', token: admin, body: { answer: '金卡会员生日当月可领 100 元无门槛券。' },
  });
  check('后台编辑知识库', kbEdit.ok && kbEdit.data.answer.includes('100'));
  const kbDel = await call(`/api/admin/kb/${kbAdd.data.id}`, { method: 'DELETE', token: admin });
  check('后台删除知识库', kbDel.ok);

  // ═══════════ K. 越权与非法入参 ═══════════
  section('K 安全与边界');
  const noAuth = await call('/api/cart');
  check('未登录访问购物车 401', noAuth.status === 401, noAuth.error?.code);
  const otherOrder = await call(`/api/orders/${o1.data.id}`, { token: userB });
  check('访问他人订单 404', otherOrder.status === 404, otherOrder.error?.code);
  const badId = await call('/api/products/abc');
  check('非法商品 ID 返回 400', badId.status === 400, badId.error?.code);
  const adminByBuyer = await call('/api/admin/products', { token: userB });
  check('买家访问后台 403', adminByBuyer.status === 403, adminByBuyer.error?.code);
  const negQty = await call('/api/cart', { method: 'POST', token: userB, body: { productId: 1, qty: -3 } });
  check('负数数量被拒', !negQty.ok, negQty.error?.code);
  const hugeQty = await call('/api/orders', {
    method: 'POST', token: userB, body: { address: ADDR, productId: 1, qty: 999999, idemKey: 'huge-' + ts },
  });
  check('超库存下单被拒', !hugeQty.ok && hugeQty.error.code === 'OUT_OF_STOCK', hugeQty.error?.code);
  const longName = await call('/api/addresses', {
    method: 'POST', token: userB, body: { name: 'a'.repeat(50), phone: '13800138000', region: '上海市', detail: '测试地址一二三' },
  });
  check('超长收件人被拒', !longName.ok, longName.error?.code);

  await call(`/api/admin/products/${newId}`, { method: 'DELETE', token: admin });

  console.log(`\n════════════════════════════════════════`);
  console.log(`▶ 结果：${pass} 通过 / ${fail} 失败`);
  if (failures.length) console.log('失败项：\n' + failures.map((f) => '  · ' + f).join('\n'));
  console.log('════════════════════════════════════════');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('脚本异常:', e); process.exit(1); });
