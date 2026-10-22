/**
 * 评价 4.0 验证：分项评分 + 印象标签（词库 / 自定义 / 聚合 / 筛选 / 审核）
 *
 * 用法：
 *   DATA_DIR=/tmp/mall-tags PORT=3021 node server/src/index.js
 *   B=http://127.0.0.1:3021 node scripts/verify-review-tags.js
 */
const BASE = process.env.B || 'http://127.0.0.1:3021';

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

const ADDR = '北京市朝阳区建国路 88 号 SOHO 现代城 B 座 1203';

async function makeCompletedOrder(buyer, admin, productId = 2) {
  const order = await call('/api/orders', {
    method: 'POST', token: buyer,
    body: {
      address: ADDR, productId, qty: 1,
      idemKey: 'tag-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    },
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

const suffix = String(Date.now()).slice(-4);
const uniq = (prefix) => `${prefix}${suffix}`.slice(0, 8);

(async () => {
  const buyer = await login('demo@mall.dev', 'demo123');
  const admin = await login('admin@mall.dev', 'admin123');

  // ── 1. 词库按类目下发 ──
  const optDigital = await call('/api/reviews/tag-options?productId=1'); // 数码
  const dimKeys = (optDigital.data?.dimensions || []).map((d) => d.key);
  check('数码商品有 6 个评分维度', dimKeys.length === 6, dimKeys.join('/'));
  check('维度包含外观 / 性能 / 颜色',
    ['appearance', 'performance', 'color'].every((k) => dimKeys.includes(k)));
  check('候选标签按维度分组', (optDigital.data?.groups || []).length >= 5,
    `${optDigital.data?.groups?.length} 组`);
  check('标签总量足够（>= 30）', (optDigital.data?.groups || []).reduce((s, g) => s + g.tags.length, 0) >= 30);
  check('限额随接口下发', optDigital.data?.limits?.maxTags === 8 && optDigital.data?.limits?.maxCustom === 3);

  const optCloth = await call('/api/reviews/tag-options?productId=3'); // 服饰
  const clothDims = (optCloth.data?.dimensions || []).map((d) => d.key);
  check('服饰商品出现「尺码」维度', clothDims.includes('fit'), clothDims.join('/'));
  check('服饰商品不出现「性能」维度', !clothDims.includes('performance'));

  const optFood = await call('/api/reviews/tag-options?productId=8'); // 食品
  const foodDims = (optFood.data?.dimensions || []).map((d) => d.key);
  check('食品商品出现「口感 / 新鲜度」', foodDims.includes('taste') && foodDims.includes('fresh'), foodDims.join('/'));

  // ── 2. 种子评价已有标签云与维度均分 ──
  const stats0 = await call('/api/products/1/review-tags');
  check('商品页返回标签云分组', (stats0.data?.groups || []).length > 0, `${stats0.data?.groups?.length} 组`);
  check('标签带使用人数', (stats0.data?.tags || []).every((t) => t.count > 0),
    `首个：${stats0.data?.tags?.[0]?.name} ${stats0.data?.tags?.[0]?.count}`);
  const scored = (stats0.data?.dimensions || []).filter((d) => d.count > 0);
  check('维度均分已聚合', scored.length > 0 && scored.every((d) => d.avg >= 1 && d.avg <= 5),
    scored.map((d) => `${d.label} ${d.avg}`).join(' / '));

  const pick = (opt, dim, name) => opt.data.groups.find((g) => g.key === dim)?.tags.find((t) => t.name === name);
  const tAppear = pick(optDigital, 'appearance', '颜值在线');
  const tPerf = pick(optDigital, 'performance', '运行流畅');
  const tOther = pick(optDigital, 'color', '无色差');
  check('可从词库取到指定标签', !!tAppear?.id && !!tPerf?.id && !!tOther?.id,
    `${tAppear?.name}/${tPerf?.name}/${tOther?.name}`);

  // ── 3. 发布带分项评分与标签的评价 ──
  const o1 = await makeCompletedOrder(buyer, admin, 2);
  const customName = uniq('屏幕通透');
  const r1 = await call('/api/reviews', {
    method: 'POST', token: buyer,
    body: {
      orderId: o1.id, orderItemId: o1.items[0].id, rating: 5,
      content: '外观很有质感，运行也很流畅，屏幕看起来通透，整体超出预期。',
      dimensions: { appearance: 5, performance: 4, color: 5, quality: 4, bogus: 5 },
      tags: [tAppear.id, tPerf.id, { name: customName }, { name: customName }],
    },
  });
  check('带标签评价发布成功', r1.ok, r1.data?.reward?.message);
  check('分项评分已保存且过滤未知维度',
    r1.data?.dimensions?.appearance === 5 && r1.data?.dimensions?.performance === 4
    && r1.data?.dimensions?.bogus === undefined,
    JSON.stringify(r1.data?.dimensions));
  check('标签去重后共 3 个', r1.data?.tags?.length === 3, r1.data?.tags?.map((t) => t.name).join('/'));
  check('自定义标签进入待审核', r1.data?.tags?.some((t) => t.name === customName && t.pending), customName);
  check('官方标签不带待审标记', r1.data?.tags?.find((t) => t.id === tAppear.id)?.pending === false);

  // ── 4. 商品页聚合与筛选 ──
  const stats1 = await call('/api/products/2/review-tags');
  const appearCount = stats1.data?.tags?.find((t) => t.id === tAppear.id)?.count || 0;
  check('官方标签计数 +1', appearCount >= 1, `${tAppear.name} × ${appearCount}`);
  check('待审核自定义标签不进入公共标签云',
    !(stats1.data?.tags || []).some((t) => t.name === customName));

  const byTag = await call(`/api/products/2/reviews?tagId=${tAppear.id}&pageSize=50`);
  check('按标签可筛出该评价', byTag.data?.items?.some((x) => x.id === r1.data.id), `${byTag.data?.total} 条`);
  const byOther = await call(`/api/products/2/reviews?tagId=${tOther.id}&pageSize=50`);
  check('按无关标签筛不出该评价', !byOther.data?.items?.some((x) => x.id === r1.data.id));
  const byDim = await call('/api/products/2/reviews?dimension=appearance&pageSize=50');
  check('按维度可筛选', byDim.data?.items?.some((x) => x.id === r1.data.id));
  const byRating = await call('/api/products/2/reviews?rating=1&pageSize=50');
  check('标签筛选与星级筛选可叠加', !byRating.data?.items?.some((x) => x.id === r1.data.id));
  const listItem = (byTag.data?.items || []).find((x) => x.id === r1.data.id);
  check('列表返回分项评分与标签', listItem?.dimensions?.appearance === 5 && listItem?.tags?.length >= 3);
  check('列表返回标签云数据', (listItem ? byTag.data.tagStats?.tags?.length : 0) > 0);

  // ── 5. 限额与非法输入 ──
  const o2 = await makeCompletedOrder(buyer, admin, 2);
  const distinct = (optDigital.data.groups || []).flatMap((g) => g.tags.map((t) => t.id)).slice(0, 9);
  const many = await call('/api/reviews', {
    method: 'POST', token: buyer,
    body: {
      orderId: o2.id, orderItemId: o2.items[0].id, rating: 5, content: '限额测试',
      tags: distinct,
    },
  });
  check('超过 8 个标签被拒', !many.ok && many.error?.code === 'TAG_LIMIT', many.error?.code);

  const c1 = uniq('甲词'); const c2 = uniq('乙词'); const c3 = uniq('丙词'); const c4 = uniq('丁词');
  const tooCustom = await call('/api/reviews', {
    method: 'POST', token: buyer,
    body: {
      orderId: o2.id, orderItemId: o2.items[0].id, rating: 5, content: '自定义限额测试',
      tags: [c1, c2, c3, c4],
    },
  });
  check('自定义标签超过 3 个被拒', !tooCustom.ok && tooCustom.error?.code === 'TAG_CUSTOM_LIMIT',
    tooCustom.error?.code);

  const badId = await call('/api/reviews', {
    method: 'POST', token: buyer,
    body: {
      orderId: o2.id, orderItemId: o2.items[0].id, rating: 5, content: '非法标签测试',
      tags: [999999],
    },
  });
  check('不存在的标签 id 被拒', !badId.ok && badId.error?.code === 'TAG_NOT_FOUND', badId.error?.code);

  const shortTag = await call('/api/reviews', {
    method: 'POST', token: buyer,
    body: {
      orderId: o2.id, orderItemId: o2.items[0].id, rating: 5, content: '短标签测试',
      tags: ['好'],
    },
  });
  check('自定义标签至少 2 字', !shortTag.ok && shortTag.error?.code === 'TAG_TOO_SHORT', shortTag.error?.code);

  // ── 6. 后台审核自定义标签 ──
  const pending = await call('/api/admin/review-tags?status=pending&pageSize=100', { token: admin });
  const customTag = (pending.data?.items || []).find((t) => t.name === customName);
  check('后台待审核列表能看到自定义标签', !!customTag, `#${customTag?.id} ${customTag?.name}`);
  check('待审核标签带来源与使用次数',
    customTag?.source === 'user' && customTag?.useCount === 1,
    `${customTag?.source} / ${customTag?.useCount}`);

  const approve = await call(`/api/admin/review-tags/${customTag.id}`, {
    method: 'PATCH', token: admin, body: { status: 'active' },
  });
  check('审核通过成功', approve.ok && approve.data.status === 'active');
  const stats2 = await call('/api/products/2/review-tags');
  check('审核通过后进入公共标签云',
    (stats2.data?.tags || []).some((t) => t.name === customName && t.dimension === 'custom'),
    '买家自创分组');

  const block = await call(`/api/admin/review-tags/${customTag.id}`, {
    method: 'PATCH', token: admin, body: { status: 'blocked' },
  });
  check('屏蔽标签成功', block.ok && block.data.status === 'blocked');
  const stats3 = await call('/api/products/2/review-tags');
  check('屏蔽后从公共标签云消失', !(stats3.data?.tags || []).some((t) => t.name === customName));
  const listAfterBlock = await call(`/api/products/2/reviews?tagId=${tAppear.id}&pageSize=50`);
  check('屏蔽后历史评价不再展示该标签',
    !(listAfterBlock.data?.items?.find((x) => x.id === r1.data.id)?.tags || []).some((t) => t.name === customName));
  await call(`/api/admin/review-tags/${customTag.id}`, {
    method: 'PATCH', token: admin, body: { status: 'active' },
  });

  // ── 7. 后台词库 CRUD ──
  const newTagName = uniq('验收标签');
  const created = await call('/api/admin/review-tags', {
    method: 'POST', token: admin,
    body: { name: newTagName, dimension: 'appearance', polarity: 'good', category: '' },
  });
  check('后台可新增词条', created.ok && created.data.name === newTagName, `#${created.data?.id}`);

  const dup = await call('/api/admin/review-tags', {
    method: 'POST', token: admin,
    body: { name: newTagName, dimension: 'appearance', polarity: 'good', category: '' },
  });
  check('同维度同名不可重复创建', !dup.ok && dup.error?.code === 'TAG_EXISTS', dup.error?.code);

  const updated = await call(`/api/admin/review-tags/${created.data.id}`, {
    method: 'PATCH', token: admin, body: { polarity: 'bad', sort: 5 },
  });
  check('后台可修改褒贬与排序', updated.ok && updated.data.polarity === 'bad' && updated.data.sort === 5);

  const removed = await call(`/api/admin/review-tags/${created.data.id}`, { method: 'DELETE', token: admin });
  check('未被使用的词条可直接删除', removed.ok && removed.data.deleted === true);

  const deleteUsed = await call(`/api/admin/review-tags/${tAppear.id}`, { method: 'DELETE', token: admin });
  check('已被引用的词条改为屏蔽', deleteUsed.ok && deleteUsed.data.blocked === true, `引用 ${deleteUsed.data?.used}`);
  await call(`/api/admin/review-tags/${tAppear.id}`, {
    method: 'PATCH', token: admin, body: { status: 'active' },
  });

  // 改名后历史评价要跟着变（评价不存标签快照）
  const renamed = uniq('颜值很高');
  await call(`/api/admin/review-tags/${tAppear.id}`, {
    method: 'PATCH', token: admin, body: { name: renamed },
  });
  const afterRename = await call(`/api/products/2/reviews?tagId=${tAppear.id}&pageSize=50`);
  check('标签改名后历史评价同步显示新名',
    (afterRename.data?.items?.find((x) => x.id === r1.data.id)?.tags || []).some((t) => t.name === renamed),
    renamed);
  await call(`/api/admin/review-tags/${tAppear.id}`, {
    method: 'PATCH', token: admin, body: { name: tAppear.name },
  });

  // 合并
  const mA = await call('/api/admin/review-tags', {
    method: 'POST', token: admin, body: { name: uniq('合并甲'), dimension: 'appearance', category: '' },
  });
  const mB = await call('/api/admin/review-tags', {
    method: 'POST', token: admin, body: { name: uniq('合并乙'), dimension: 'appearance', category: '' },
  });
  const merged = await call(`/api/admin/review-tags/${mA.data.id}/merge`, {
    method: 'POST', token: admin, body: { targetId: mB.data.id },
  });
  check('同义词可合并', merged.ok && merged.data.sourceId === mA.data.id, `迁移 ${merged.data?.merged} 条`);
  const mergedList = await call(`/api/admin/review-tags?q=${encodeURIComponent(mA.data.name)}`, { token: admin });
  check('合并来源被屏蔽', mergedList.data?.items?.[0]?.status === 'blocked');
  await call(`/api/admin/review-tags/${mB.data.id}`, { method: 'DELETE', token: admin });

  // ── 8. 权限 ──
  const anon = await call('/api/admin/review-tags');
  check('未登录不能管理词库', anon.status === 401, anon.error?.code);
  const notMerchant = await call('/api/admin/review-tags', { token: buyer });
  check('普通用户不能管理词库', notMerchant.status === 403, notMerchant.error?.code);

  // ── 9. 订单里的评价也能取到标签 ──
  const mine = await call(`/api/orders/${o1.id}/reviews`, { token: buyer });
  const myReview = (mine.data || []).find((x) => x.id === r1.data.id);
  check('订单评价带标签与分项评分',
    (myReview?.tags?.length || 0) >= 2 && myReview?.dimensions?.appearance === 5,
    `${myReview?.tags?.length} 个标签`);

  console.log(`\n${fail ? '❌' : '✅'} 评价标签验证：${pass} 通过 / ${fail} 失败\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('脚本异常：', e);
  process.exit(1);
});
