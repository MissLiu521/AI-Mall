/**
 * 页面级冒烟：真实浏览器打开每个页面，确认能渲染、无 JS 报错、关键内容出现。
 * 接口测试全绿但页面白屏的情况，只有这里能抓到。
 *
 * 用法：BASE=http://127.0.0.1:5176 API=http://127.0.0.1:3001 node scripts/e2e-flows.js
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:3001';
const API = process.env.API || 'http://127.0.0.1:3001';

let pass = 0; let fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) { pass += 1; console.log(`✅ ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail += 1; console.log(`❌ ${name}${extra ? ' — ' + extra : ''}`); }
};

async function apiCall(p, { method = 'GET', token, body } = {}) {
  const r = await fetch(API + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
}

/** 等到页面上出现某段文字（SPA 异步渲染，直接取 textContent 会拿到空） */
async function waitText(page, kw, timeout = 10_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const txt = await page.locator('body').innerText().catch(() => '');
    if (txt.includes(kw)) return txt;
    await page.waitForTimeout(300);
  }
  return null;
}

(async () => {
  const buyer = (await apiCall('/api/auth/login', { method: 'POST', body: { email: 'demo@mall.dev', password: 'demo123' } })).data.token;
  const admin = (await apiCall('/api/auth/login', { method: 'POST', body: { email: 'admin@mall.dev', password: 'admin123' } })).data.token;
  const prod = (await apiCall('/api/products/1')).data;
  const skuId = prod.skus?.[0]?.id;
  // 先加购，购物车/结算页才有内容
  await apiCall('/api/cart', { method: 'POST', token: buyer, body: { productId: 1, skuId, qty: 1 } });

  // 造一个"正在凑"的团，否则拼团详情页的参团区块不会出现（此时不出现才是对的）
  const tmpUser = (await apiCall('/api/auth/register', {
    method: 'POST',
    body: { email: `e2e_${Date.now().toString(36)}@test.dev`, password: 'test123', name: '页面验证' },
  })).data.token;
  const gbList = (await apiCall('/api/group-buys')).data;
  const gb = gbList.find((g) => g.productId === 2) || gbList[0];
  await apiCall('/api/orders/group', {
    method: 'POST', token: tmpUser,
    body: { groupBuyId: gb.id, address: '上海市浦东新区世纪大道 100 号 32 层', idemKey: 'e2e-g-' + Date.now() },
  });

  let browser;
  for (const ch of ['chrome', 'msedge']) {
    try { browser = await chromium.launch({ channel: ch }); break; } catch { /* next */ }
  }
  if (!browser) browser = await chromium.launch();

  const errors = [];
  async function newPage(token) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    if (token) await ctx.addInitScript(([k, t]) => localStorage.setItem(k, t), ['aimall_token', token]);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const t = m.text();
      // 忽略浏览器噪音：favicon、网络层偶发 502
      if (/favicon|net::ERR|Failed to load resource/i.test(t)) return;
      errors.push(t);
    });
    return page;
  }

  const shop = await newPage(buyer);
  const ops = await newPage(admin);

  async function visit(page, path, kws, label) {
    const before = errors.length;
    try {
      await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
      const txt = await waitText(page, kws[0]);
      const missing = kws.filter((k) => !txt || !txt.includes(k));
      check(`${label} 渲染正常`, !!txt && missing.length === 0,
        missing.length ? `缺少「${missing.join('、')}」` : kws[0]);
      const fresh = errors.slice(before);
      check(`${label} 无 JS 报错`, fresh.length === 0, fresh[0]?.slice(0, 120) || '');
    } catch (e) {
      check(`${label} 渲染正常`, false, e.message.slice(0, 120));
    }
  }

  console.log('\n▶ C 端页面\n');
  await visit(shop, '/shop', ['秒杀', '热销榜', '逛逛'], '首页');
  await visit(shop, '/product/1', ['选择规格', '评价', '加入购物车'], '商品详情');
  await visit(shop, `/product/2?group=${gb.id}`, ['拼团价', '正在凑的团', '参团'], '拼团商品详情');
  await visit(shop, '/cart', ['全选', '合计'], '购物车');
  await visit(shop, `/checkout?productId=1&skuId=${skuId}&qty=1`, ['应付金额', '优惠券', '积分抵扣'], '确认订单');
  await visit(shop, '/orders', ['订单'], '订单列表');
  await visit(shop, '/promo', ['领券中心', '限时秒杀', '拼团'], '领券中心');
  await visit(shop, '/feed', ['逛逛'], '逛逛');
  await visit(shop, '/mine', ['积分', '收藏', '足迹'], '我的资产');

  console.log('\n▶ B 端页面\n');
  await visit(ops, '/admin/dashboard', ['数据看板'], '看板');
  await visit(ops, '/admin/products', ['商品'], '商品管理');
  await visit(ops, '/admin/orders', ['订单'], '订单管理');
  await visit(ops, '/admin/refunds', ['退款'], '退款审核');
  await visit(ops, '/admin/marketing', ['优惠券'], '营销中心');
  await visit(ops, '/admin/reviews', ['评价'], '评价管理');
  await visit(ops, '/admin/content', ['内容'], '内容管理');
  await visit(ops, '/admin/tickets', ['工单'], '人工工单');
  await visit(ops, '/admin/settings', ['AI'], 'AI 配置');

  // 交互：从首页点进商品详情
  console.log('\n▶ 关键交互\n');
  await shop.goto(BASE + '/shop', { waitUntil: 'domcontentloaded' });
  await shop.waitForTimeout(1500);
  const card = shop.locator('a[href^="/product/"], [class*="pcard"]').first();
  if (await card.count()) {
    await card.click();
    await shop.waitForTimeout(1200);
    check('首页点商品能跳详情', /\/product\/\d+/.test(shop.url()), shop.url().replace(BASE, ''));
  } else {
    check('首页点商品能跳详情', false, '没找到商品卡');
  }

  await browser.close();
  console.log(`\n▶ 结果：${pass} 通过 / ${fail} 失败`);
  if (errors.length) console.log('页面报错：\n' + [...new Set(errors)].slice(0, 8).map((e) => '  · ' + e.slice(0, 160)).join('\n'));
  console.log('');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('脚本异常:', e); process.exit(1); });
