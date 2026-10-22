/**
 * 多端实测 —— H5（移动端）
 * 用 CDP 直连 Edge，逐页抓：console error / pageerror / 失败请求 / 横向溢出 / 关键交互
 * 运行：NODE_PATH=<workspace node_modules> node scripts/e2e-mobile-deep.js
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';

// playwright-core 可能装在项目里，也可能装在托管工作区：按顺序尝试
const CANDIDATES = [
  null,
  'C:/Users/liubi/.workbuddy/binaries/node/workspace',
];
let pw;
for (const root of CANDIDATES) {
  try {
    const r = root ? createRequire(root + '/package.json') : createRequire(import.meta.url);
    pw = r('playwright-core');
    break;
  } catch { /* try next */ }
}
if (!pw) throw new Error('未找到 playwright-core');
const { chromium, devices } = pw;

const BASE = process.env.MOBILE_BASE || 'http://127.0.0.1:5180';
const SHOT_DIR = 'docs/screenshots/audit';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const results = [];
const check = (name, pass, extra = '') => {
  results.push({ name, pass, extra });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  —  ' + extra : ''}`);
};

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const ctx = await browser.newContext({ ...devices['iPhone 12'] });
const page = await ctx.newPage();

const IGNORE = /favicon|ResizeObserver|Vue Devtools|sourcemap|DevTools/i;
let errs = [];
let netFails = [];
let consoleAll = [];

page.on('console', (m) => {
  consoleAll.push(`[${m.type()}] ${m.text()}`);
  if (m.type() !== 'error') return;
  if (IGNORE.test(m.text()) || IGNORE.test(m.location()?.url || '')) return;
  errs.push(m.text());
});
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e)));
page.on('requestfailed', (r) => {
  if (IGNORE.test(r.url())) return;
  netFails.push(`${r.method()} ${r.url()} :: ${r.failure()?.errorText}`);
});
page.on('response', (r) => {
  if (r.status() >= 400 && !IGNORE.test(r.url())) netFails.push(`HTTP ${r.status()} ${r.url()}`);
});

const open = async (hash) => {
  await page.goto(BASE + '/' + hash, { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
};

/** 检查横向溢出 + 页面是否白屏 */
const audit = async (label) => {
  const r = await page.evaluate(() => {
    const de = document.documentElement;
    const overflow = de.scrollWidth - de.clientWidth;
    const txt = (document.body.innerText || '').trim();
    // 找出超过视口右边界的可见元素
  const offenders = [];
    for (const el of document.querySelectorAll('body *')) {
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed') continue;
      if (b.right > de.clientWidth + 2) {
        offenders.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]} right=${Math.round(b.right)}`);
      }
    }
    return { overflow, textLen: txt.length, head: txt.slice(0, 40).replace(/\n/g, ' '), offenders: [...new Set(offenders)].slice(0, 3) };
  });
  check(`[${label}] 有内容`, r.textLen > 10, `${r.textLen}字 "${r.head}"`);
  check(`[${label}] 无横向溢出`, r.overflow <= 1, r.overflow > 1 ? `溢出${r.overflow}px: ${r.offenders.join('; ')}` : '');
  return r;
};

const PAGES = [
  ['首页', '#/pages/index/index'],
  ['分类', '#/pages/category/category'],
  ['购物车', '#/pages/cart/cart'],
  ['我的', '#/pages/mine/mine'],
  ['订单', '#/pages/orders/orders'],
  ['登录', '#/pages/login/login'],
  ['AI 助手', '#/pages/ai/ai'],
];

try {
  // ---------- 1. 逐页基线 ----------
  for (const [label, hash] of PAGES) {
    errs = []; netFails = [];
    await open(hash);
    await audit(label);
    await page.screenshot({ path: `${SHOT_DIR}/h5-${label}.png`, fullPage: false });
    check(`[${label}] 无 JS 错误`, errs.length === 0, errs.slice(0, 2).join(' | '));
    check(`[${label}] 无失败请求`, netFails.length === 0, netFails.slice(0, 2).join(' | '));
  }

  // ---------- 2. 未登录态：购物车应引导登录 ----------
  await open('#/pages/cart/cart');
  const guestCart = await page.locator('body').innerText();
  check('未登录购物车给出登录引导', /登录后查看购物车|去登录/.test(guestCart), guestCart.slice(0, 30).replace(/\n/g, ' '));

  // ---------- 3. 登录 ----------
  await open('#/pages/login/login');
  await page.fill('input:not([type="password"])', 'demo@mall.dev');
  await page.fill('input[type="password"]', 'demo123');
  await page.locator('text=登录').last().click();
  await page.waitForTimeout(2200);
  const token = await page.evaluate(() => localStorage.getItem('aimall_token') || '');
  check('登录成功并写入 token', token.length > 20, `len=${token.length}`);

  // ---------- 4. 搜索（分类页）----------
  errs = []; netFails = [];
  await open('#/pages/category/category');
  const searchInput = page.locator('input').first();
  const hasSearch = await searchInput.count();
  check('分类页有搜索框', hasSearch > 0);
  if (hasSearch) {
    await searchInput.fill('跑鞋');
    await page.waitForTimeout(1500);
    const searched = await page.locator('.pcard').count();
    check('搜索"跑鞋"有结果', searched > 0, `count=${searched}`);
    await page.screenshot({ path: `${SHOT_DIR}/h5-search-hit.png` });

    // 零结果
    await searchInput.fill('zzzz不存在商品xyz');
    await page.waitForTimeout(1500);
    const zeroTxt = await page.locator('body').innerText();
    check('零结果有兜底提示', /没有|未找到|换个|试试/.test(zeroTxt), zeroTxt.slice(0, 60).replace(/\n/g, ' '));
    await page.screenshot({ path: `${SHOT_DIR}/h5-search-zero.png` });
    await searchInput.fill('');
    await page.waitForTimeout(800);
  }
  check('[搜索] 无 JS 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  // ---------- 5. 详情页 → 加购 ----------
  errs = []; netFails = [];
  await open('#/pages/category/category');
  await page.locator('.pcard').first().click();
  await page.waitForTimeout(1500);
  check('进入商品详情', page.url().includes('detail'), '');
  const detailTxt = await page.locator('body').innerText();
  check('详情含价格', /¥\s?\d/.test(detailTxt));
  check('详情含库存/规格信息', /库存|规格|现货|发货/.test(detailTxt), detailTxt.slice(0, 50).replace(/\n/g, ' '));
  await page.screenshot({ path: `${SHOT_DIR}/h5-detail.png`, fullPage: true });

  // 加购
  const addBtn = page.locator('text=加入购物车').first();
  if (await addBtn.count()) {
    await addBtn.click();
    await page.waitForTimeout(1400);
    check('加入购物车无报错', errs.length === 0, errs.slice(0, 2).join(' | '));
  } else {
    check('详情页有加购按钮', false);
  }

  // ---------- 6. 购物车 → 底部栏与 tabBar 重叠检测 ----------
  errs = []; netFails = [];
  await open('#/pages/cart/cart');
  const cartTxt = await page.locator('body').innerText();
  check('购物车有商品', /合计|结算/.test(cartTxt), cartTxt.slice(0, 40).replace(/\n/g, ' '));
  const overlap = await page.evaluate(() => {
    const vh = window.innerHeight;
    const tab = document.querySelector('uni-tabbar');
    const bar = document.querySelector('.bottom-bar');
    const info = { hasTab: !!tab, hasBar: !!bar };
    if (tab) info.tab = tab.getBoundingClientRect().top;
    if (bar) info.bar = bar.getBoundingClientRect().bottom;
    if (tab && bar) {
      const t = tab.getBoundingClientRect();
      const b = bar.getBoundingClientRect();
      info.overlapPx = Math.max(0, Math.min(t.bottom, b.bottom) - Math.max(t.top, b.top));
    }
    info.vh = vh;
    return info;
  });
  check('购物车结算栏未被 tabBar 遮挡', !overlap.overlapPx || overlap.overlapPx < 2,
    `tabTop=${overlap.tab?.toFixed(0)} barBottom=${overlap.bar?.toFixed(0)} overlap=${overlap.overlapPx?.toFixed(0)}px`);
  await page.screenshot({ path: `${SHOT_DIR}/h5-cart.png` });
  check('[购物车] 无 JS 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  // ---------- 7. 下单 ----------
  errs = []; netFails = [];
  const checkoutBtn = page.locator('text=/结算（/').first();
  if (await checkoutBtn.count()) {
    await checkoutBtn.click();
    await page.waitForTimeout(2500);
    // 结算页：没有地址就新建，有地址则直接选中后提交
    const addrItem = page.locator('.addr').first();
    if (await addrItem.count()) {
      await addrItem.click();
    } else {
      const smart = page.locator('textarea').first();
      if (await smart.count()) {
        await smart.fill('张三 13800138000 北京市朝阳区建国路 88 号 SOHO 现代城 B 座 1203');
        const split = page.locator('text=自动拆分填入').first();
        if (await split.count()) await split.click();
        await page.waitForTimeout(500);
        const save = page.locator('text=保存地址').first();
        if (await save.count()) { await save.click(); await page.waitForTimeout(1200); }
      }
    }
    const submitBtn = page.locator('.bar-btn').last();
    if (await submitBtn.count()) { await submitBtn.click(); }
    await page.waitForTimeout(3500);
    check('下单后跳到订单详情', page.url().includes('order-detail'), page.url().split('#')[1] || '');
    const odTxt = await page.locator('body').innerText();
    check('订单详情有订单号', /AIM\d{8}/.test(odTxt), (odTxt.match(/AIM\d+/) || [''])[0]);
    await page.screenshot({ path: `${SHOT_DIR}/h5-order-detail.png`, fullPage: true });
  } else {
    check('购物车结算按钮存在', false);
  }
  check('[下单] 无 JS 错误', errs.length === 0, errs.slice(0, 2).join(' | '));
  check('[下单] 无失败请求', netFails.length === 0, netFails.slice(0, 2).join(' | '));

  // ---------- 8. 订单列表 ----------
  errs = []; netFails = [];
  await open('#/pages/orders/orders');
  const ordersTxt = await page.locator('body').innerText();
  check('订单列表有订单', /AIM\d{8}/.test(ordersTxt), ordersTxt.slice(0, 40).replace(/\n/g, ' '));
  await page.screenshot({ path: `${SHOT_DIR}/h5-orders.png` });

  // ---------- 9. AI 助手 ----------
  errs = []; netFails = [];
  await open('#/pages/ai/ai');
  const aiEmpty = await page.locator('body').innerText();
  check('AI 页有引导语/chips', aiEmpty.length > 20, aiEmpty.slice(0, 40).replace(/\n/g, ' '));
  const chip = page.locator('.chip').first();
  if (await chip.count()) {
    await chip.click();
    await page.waitForTimeout(6000);
    const bubbles = await page.locator('.bubble.assistant').count();
    const last = await page.locator('.bubble.assistant').last().innerText().catch(() => '');
    check('AI 有回复', bubbles > 0 && last.length > 3, last.slice(0, 50).replace(/\n/g, ' '));
    await page.screenshot({ path: `${SHOT_DIR}/h5-ai-reply.png`, fullPage: true });
  } else {
    check('AI 页有快捷 chip', false);
  }
  check('[AI] 无 JS 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  // ---------- 10. 我的 ----------
  errs = [];
  await open('#/pages/mine/mine');
  const mineTxt = await page.locator('body').innerText();
  check('我的页展示用户', /demo|体验官|@/.test(mineTxt), mineTxt.slice(0, 40).replace(/\n/g, ' '));
  await page.screenshot({ path: `${SHOT_DIR}/h5-mine.png` });
  check('[我的] 无 JS 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  // ---------- 11. 视口宽度适配 ----------
  for (const w of [320, 375, 414]) {
    await page.setViewportSize({ width: w, height: 844 });
    await open('#/pages/index/index');
    const r = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`首页在 ${w}px 宽无横向溢出`, r <= 1, r > 1 ? `溢出 ${r}px` : '');
  }

} catch (e) {
  check('脚本执行', false, String(e).slice(0, 300));
  await page.screenshot({ path: `${SHOT_DIR}/h5-error.png` }).catch(() => {});
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.pass).length;
console.log(`\n===== H5: ${passed}/${results.length} 通过 =====`);
const fails = results.filter((r) => !r.pass);
if (fails.length) {
  console.log('\n失败项：');
  fails.forEach((f) => console.log(`  - ${f.name} ${f.extra ? '| ' + f.extra : ''}`));
}
process.exit(0);
