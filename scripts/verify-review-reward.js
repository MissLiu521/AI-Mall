/**
 * 评价 3.0 验证：图片/视频上传 → 图文返现 → 余额入账 → 下单抵扣 → 取消回补
 *
 * 用法：先起一个临时实例，再跑本脚本
 *   DATA_DIR=/tmp/mall-review PORT=3011 node server/src/index.js
 *   B=http://127.0.0.1:3011 node scripts/verify-review-reward.js
 */
const BASE = process.env.B || 'http://127.0.0.1:3011';

async function call(path, { method = 'GET', token, body } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ok: j.ok, data: j.data, error: j.error };
}

async function upload(token, buffer, filename, type) {
  const fd = new FormData();
  fd.append('file', new Blob([buffer], { type }), filename);
  const r = await fetch(BASE + '/api/uploads', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd,
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ok: j.ok, data: j.data, error: j.error };
}

let pass = 0; let fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass += 1; console.log(`✅ ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail += 1; console.log(`❌ ${name}${extra ? ' — ' + extra : ''}`); }
}

// 1x1 透明 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
// 最小 mp4 头：size + ftyp + isom + 填充（服务端按魔数识别为 video/mp4）
function mp4() {
  const head = Buffer.from([0x00, 0x00, 0x00, 0x18]);
  const body = Buffer.from('ftypisomisomiso2', 'ascii');
  return Buffer.concat([head, body, Buffer.alloc(2048, 0)]);
}

const login = async (email, password) => {
  const r = await call('/api/auth/login', { method: 'POST', body: { email, password } });
  if (!r.ok) throw new Error('登录失败 ' + JSON.stringify(r.error));
  return r.data.token;
};

const ADDR = '北京市朝阳区建国路 88 号 SOHO 现代城 B 座 1203';

/** 造一笔已完成订单，返回订单详情（走真实链路：下单 → 支付 → 发货 → 收货） */
async function makeCompletedOrder(buyer, admin) {
  const order = await call('/api/orders', {
    method: 'POST', token: buyer,
    body: { address: ADDR, productId: 2, qty: 1, idemKey: 'rev-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6) },
  });
  if (!order.ok) throw new Error('下单失败 ' + JSON.stringify(order.error));
  await call(`/api/orders/${order.data.id}/pay`, { method: 'POST', token: buyer });
  await call(`/api/admin/orders/${order.data.id}/ship`, {
    method: 'PATCH', token: admin, body: { carrier: '顺丰速运', trackingNo: 'SF' + Date.now() },
  });
  const done = await call(`/api/orders/${order.data.id}/confirm`, { method: 'POST', token: buyer });
  if (done.data?.status !== 'completed') throw new Error('确认收货失败：' + done.data?.status);
  return done.data;
}

(async () => {
  const buyer = await login('demo@mall.dev', 'demo123');
  const admin = await login('admin@mall.dev', 'admin123');

  // ── 1. 规则 ──
  const rules = await call('/api/reviews/rules');
  check('返现规则可读', rules.ok && rules.data.tiers.length >= 2, rules.data?.tiers?.map((t) => t.tip).join(' / '));
  check('默认提示为 1 图 15 字', /1 张图 \+ 15 字/.test(rules.data?.defaultHint || ''), rules.data?.defaultHint);
  check('视频加码规则存在', rules.data?.video?.cashCents === 200);

  // ── 2. 上传 ──
  const anon = await upload('', PNG, 'a.png', 'image/png');
  check('未登录不能上传', anon.status === 401, anon.error?.code);

  const img1 = await upload(buyer, PNG, 'a.png', 'image/png');
  check('图片上传成功', img1.ok && img1.data.type === 'image', img1.data?.url);
  const img2 = await upload(buyer, PNG, 'b.png', 'image/png');
  const img3 = await upload(buyer, PNG, 'c.png', 'image/png');
  check('可以连续上传多张', img2.ok && img3.ok);

  const video = await upload(buyer, mp4(), 'v.mp4', 'video/mp4');
  check('视频上传成功', video.ok && video.data.type === 'video', video.data?.url);

  const fake = await upload(buyer, Buffer.from('<script>alert(1)</script>'), 'evil.png', 'image/png');
  check('伪装成图片的脚本被拒', fake.status === 415, fake.error?.code);

  // 静态响应 + Range（视频拖动依赖 206）
  const imgRes = await fetch(BASE + img1.data.url);
  check('上传图片可访问', imgRes.status === 200 && imgRes.headers.get('content-type') === 'image/png');
  const rangeRes = await fetch(BASE + video.data.url, { headers: { Range: 'bytes=0-99' } });
  check('视频支持 Range 播放', rangeRes.status === 206, `${rangeRes.headers.get('content-range')}`);
  const traversal = await fetch(BASE + '/api/uploads/..%2F..%2Fmall.db');
  check('目录穿越被拒', traversal.status === 404);

  // ── 3. 评价 1：1 图 + 15 字 → ¥1.00 ──
  const wallet0 = await call('/api/wallet', { token: buyer });
  const o1 = await makeCompletedOrder(buyer, admin);
  const r1 = await call('/api/reviews', {
    method: 'POST', token: buyer,
    body: {
      orderId: o1.id, orderItemId: o1.items[0].id, rating: 5,
      content: '做工扎实，细节处理到位，用了三天很满意，推荐购买，物流也很快。',
      images: [img1.data.url],
    },
  });
  check('图文评价发布成功', r1.ok, r1.data?.reward?.message);
  check('15 字 + 1 图返现 ¥1.00', r1.data?.reward?.cashCents === 100, `实得 ¥${r1.data?.reward?.cash}`);
  check('返现同时给 50 积分（基础 20 + 图文 30）', r1.data?.reward?.points === 50, `${r1.data?.reward?.points}`);
  const wallet1 = await call('/api/wallet', { token: buyer });
  check('余额真实入账', wallet1.data.balanceCents === wallet0.data.balanceCents + 100,
    `¥${wallet0.data.balance} → ¥${wallet1.data.balance}`);
  check('流水有评价返现记录', wallet1.data.items[0]?.reason === '评价返现', wallet1.data.items[0]?.reason);

  const dup = await call('/api/reviews', {
    method: 'POST', token: buyer,
    body: { orderId: o1.id, orderItemId: o1.items[0].id, rating: 5, content: '重复评价测试' },
  });
  check('同一订单行不能重复评价', !dup.ok && dup.error.code === 'ALREADY_REVIEWED', dup.error?.code);

  // ── 4. 评价 2：3 图 + 60 字 + 视频 → 封顶 ¥5.00 ──
  const o2 = await makeCompletedOrder(buyer, admin);
  const longText = '收到货就迫不及待拆开了，包装很严实，外观和图片一致，没有色差。'.repeat(2);
  const r2 = await call('/api/reviews', {
    method: 'POST', token: buyer,
    body: {
      orderId: o2.id, orderItemId: o2.items[0].id, rating: 5,
      content: longText,
      images: [img1.data.url, img2.data.url, img3.data.url],
      video: video.data.url,
      anonymous: true,
    },
  });
  check('优质长图文 + 视频发布成功', r2.ok, r2.data?.reward?.message);
  check('档位为 gold 且视频加码', r2.data?.reward?.tier === 'gold' && r2.data?.reward?.videoBonusCents === 200,
    `tier=${r2.data?.reward?.tier}`);
  check('返现封顶 ¥5.00', r2.data?.reward?.cashCents === 500, `实得 ¥${r2.data?.reward?.cash}`);

  // ── 5. 商品页展示 ──
  const list = await call('/api/products/2/reviews?pageSize=20', { token: buyer });
  const mine = list.data?.items?.find((x) => x.id === r2.data.id);
  check('评价列表返回图片与视频', mine?.images?.length === 3 && !!mine?.video, `图 ${mine?.images?.length} / 视频 ${mine?.video ? '有' : '无'}`);
  check('匿名评价昵称打码', mine?.userName === '匿***', mine?.userName);
  const media = await call('/api/products/2/reviews?withMedia=1&pageSize=20');
  check('有图/视频筛选只返回媒体评价',
    media.data.items.length >= 2 && media.data.items.every((x) => x.images.length > 0 || x.video));
  check('评价列表带返现标记', mine?.rewardCents === 500, `返 ¥${(mine?.rewardCents / 100).toFixed(2)}`);

  // ── 6. 余额抵扣：预览 → 下单 → 取消回补 ──
  const wallet2 = await call('/api/wallet', { token: buyer });
  const previewNo = await call('/api/orders/preview', { method: 'POST', token: buyer, body: { productId: 3, qty: 1 } });
  const previewUse = await call('/api/orders/preview', {
    method: 'POST', token: buyer, body: { productId: 3, qty: 1, useBalance: 100000 },
  });
  check('余额抵扣在预览中生效', previewUse.data.balanceDiscountCents > 0,
    `-¥${(previewUse.data.balanceDiscountCents / 100).toFixed(2)}`);
  check('抵扣不超过可用余额', previewUse.data.balanceDiscountCents <= wallet2.data.balanceCents);
  check('预览金额随抵扣下降', previewUse.data.totalCents < previewNo.data.totalCents,
    `¥${previewNo.data.display.total} → ¥${previewUse.data.display.total}`);

  const order2 = await call('/api/orders', {
    method: 'POST', token: buyer,
    body: {
      address: ADDR, productId: 3, qty: 1,
      useBalance: previewUse.data.balanceUsed,
      idemKey: 'bal-' + Date.now(),
    },
  });
  check('余额抵扣下单成功', order2.ok, order2.data?.orderNo);
  check('下单金额 == 预览金额', order2.data.total === previewUse.data.display.total,
    `订单 ¥${order2.data.total} / 预览 ¥${previewUse.data.display.total}`);
  check('订单记录余额抵扣', order2.data.pricing.balanceDiscount > 0, `-¥${order2.data.pricing.balanceDiscount}`);

  const wallet3 = await call('/api/wallet', { token: buyer });
  check('余额已扣减', wallet3.data.balanceCents === wallet2.data.balanceCents - previewUse.data.balanceUsed,
    `¥${wallet2.data.balance} → ¥${wallet3.data.balance}`);

  const cancel = await call(`/api/orders/${order2.data.id}/cancel`, { method: 'POST', token: buyer, body: { reason: '验证余额回补' } });
  check('取消订单成功', cancel.ok && cancel.data.status === 'cancelled');
  const wallet4 = await call('/api/wallet', { token: buyer });
  check('取消后余额全额回补', wallet4.data.balanceCents === wallet2.data.balanceCents,
    `¥${wallet3.data.balance} → ¥${wallet4.data.balance}`);
  check('回补有流水记录', wallet4.data.items.some((x) => x.reason === '订单关闭退回余额'));

  console.log(`\n${fail ? '❌' : '✅'} 评价返现验证：${pass} 通过 / ${fail} 失败\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('脚本异常：', e);
  process.exit(1);
});
