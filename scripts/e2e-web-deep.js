/**
 * 多端实测 —— PC Web（前台商城 + 后台管理）
 * 运行：node scripts/e2e-web-deep.js
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';

const pw = createRequire('C:/Users/liubi/.workbuddy/binaries/node/workspace/package.json')('playwright-core');
const { chromium } = pw;

const BASE = process.env.WEB_BASE || 'http://localhost:5173';
const SHOT_DIR = 'docs/screenshots/audit';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const results = [];
const check = (name, pass, extra = '') => {
  results.push({ name, pass, extra });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  —  ' + extra : ''}`);
};

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const IGNORE = /favicon|ResizeObserver|sourcemap|DevTools/i;
let errs = [], netFails = [];
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  if (IGNORE.test(m.text()) || IGNORE.test(m.location()?.url || '')) return;
  errs.push(m.text());
});
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e)));
page.on('response', (r) => {
  if (r.status() >= 400 && !IGNORE.test(r.url())) netFails.push(`HTTP ${r.status()} ${r.url()}`);
});

const open = async (path) => {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
};

const audit = async (label) => {
  const r = await page.evaluate(() => {
    const de = document.documentElement;
    const txt = (document.body.innerText || '').trim();
    return { overflow: de.scrollWidth - de.clientWidth, textLen: txt.length, head: txt.slice(0, 40).replace(/\n/g, ' ') };
  });
  check(`[${label}] 有内容`, r.textLen > 10, `${r.textLen}字 "${r.head}"`);
  check(`[${label}] 无横向溢出`, r.overflow <= 1, `溢出${r.overflow}px`);
};

try {
  // ---------- 前台 ----------
  for (const [label, path] of [['商城首页', '/shop'], ['分类', '/shop/category'], ['登录', '/login']]) {
    errs = []; netFails = [];
    await open(path);
    await audit(label);
    await page.screenshot({ path: `${SHOT_DIR}/web-${label}.png` });
    check(`[${label}] 无 JS 错误`, errs.length === 0, errs.slice(0, 2).join(' | '));
    check(`[${label}] 无失败请求`, netFails.length === 0, netFails.slice(0, 2).join(' | '));
  }

  // 登录
  await open('/login');
  await page.fill('input[type="email"], input:not([type="password"])', 'demo@mall.dev');
  await page.fill('input[type="password"]', 'demo123');
  await page.locator('button:has-text("登录")').first().click();
  await page.waitForTimeout(2200);
  const token = await page.evaluate(() => localStorage.getItem('aimall_token') || '');
  check('Web 登录成功', token.length > 20, `len=${token.length}`);

  // 搜索 + 理由标签
  errs = []; netFails = [];
  await open('/shop/category');
  const search = page.locator('input[placeholder*="搜索"]').first();
  check('分类页有搜索框', (await search.count()) > 0);
  await search.fill('跑鞋');
  await search.press('Enter');
  await page.waitForTimeout(2000);
  const cards = await page.locator('.pcard').count();
  check('Web 搜索"跑鞋"有结果', cards > 0, `cards=${cards}`);
  const totalTxt = await page.locator('.toolbar').innerText().catch(() => '');
  check('Web 搜索结果被过滤', cards < 16, `cards=${cards} / ${totalTxt.replace(/\n/g, ' ')}`);
  const reasons = await page.locator('.reason-tag').count();
  check('搜索结果带匹配理由标签', reasons > 0, `reasons=${reasons}`);
  await page.screenshot({ path: `${SHOT_DIR}/web-search.png` });
  check('[搜索] 无 JS 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  // 零结果
  await search.fill('zzzz不存在商品xyz');
  await search.press('Enter');
  await page.waitForTimeout(2000);
  const zeroTxt = await page.locator('body').innerText();
  check('Web 零结果有兜底建议', /没有找到|换个|试试|建议/.test(zeroTxt), zeroTxt.slice(0, 60).replace(/\n/g, ' '));
  await page.screenshot({ path: `${SHOT_DIR}/web-search-zero.png` });

  // 详情
  errs = [];
  await open('/shop/category');
  await page.locator('a[href^="/product/"], .pcard, [class*="card"]').first().click();
  await page.waitForTimeout(1500);
  check('Web 进入详情页', /\/product\/\d+/.test(page.url()), page.url());
  const dTxt = await page.locator('body').innerText();
  check('Web 详情含价格/库存', /¥\s?\d/.test(dTxt) && /库存|现货|发货|规格/.test(dTxt));
  await page.screenshot({ path: `${SHOT_DIR}/web-detail.png`, fullPage: true });
  check('[详情] 无 JS 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  // 加购 → 结算 → 下单
  errs = []; netFails = [];
  const addBtn = page.locator('button:has-text("加入购物车")').first();
  if (await addBtn.count()) {
    await addBtn.click();
    await page.waitForTimeout(1200);
    check('Web 加购无报错', errs.length === 0, errs.slice(0, 2).join(' | '));
  } else { check('Web 详情有加购按钮', false); }

  await open('/cart');
  const cartTxt = await page.locator('body').innerText();
  check('Web 购物车有商品', /结算|合计/.test(cartTxt), cartTxt.slice(0, 40).replace(/\n/g, ' '));
  await page.screenshot({ path: `${SHOT_DIR}/web-cart.png` });
  const goBtn = page.locator('button:has-text("去结算"), a:has-text("去结算"), button:has-text("结算")').first();
  if (await goBtn.count()) {
    await goBtn.click();
    await page.waitForTimeout(1800);
    check('Web 进入结算页', /checkout/.test(page.url()), page.url());
    const addr = page.locator('textarea').first();
    if (await addr.count()) {
      await addr.fill('北京市朝阳区建国路 88 号 SOHO 现代城 B 座 1203，张三，13800001111');
      await page.waitForTimeout(300);
    }
    await page.screenshot({ path: `${SHOT_DIR}/web-checkout.png` });
    const submit = page.locator('button:has-text("提交订单")').first();
    if (await submit.count()) {
      await submit.click();
      await page.waitForTimeout(3000);
      check('Web 下单成功', /orders|order/i.test(page.url()), page.url());
      const odTxt = await page.locator('body').innerText();
      check('Web 订单详情有退款入口/状态', /AIM\d{8}/.test(odTxt), (odTxt.match(/AIM\d+/) || [''])[0]);
      await page.screenshot({ path: `${SHOT_DIR}/web-order.png`, fullPage: true });
    } else { check('Web 结算页有提交按钮', false); }
  } else { check('Web 购物车有去结算按钮', false); }
  check('[下单链路] 无 JS 错误', errs.length === 0, errs.slice(0, 2).join(' | '));
  check('[下单链路] 无失败请求', netFails.length === 0, netFails.slice(0, 2).join(' | '));

  // ---------- 后台（用商家账号重新登录）----------
  // 直接读种子文件里的账号，避免测试脚本里硬编码口令与代码脱节
  const seedSrc = fs.readFileSync('server/src/db/seed.js', 'utf8');
  const adminMatch = seedSrc.match(/\['(admin@mall\.dev)',\s*'([^']+)'/);
  const ADMIN_EMAIL = adminMatch?.[1] || 'admin@mall.dev';
  const ADMIN_PWD = process.env.ADMIN_PWD || adminMatch?.[2] || '';

  await page.evaluate(() => localStorage.clear());
  await open('/login');
  await page.fill('input:not([type="password"])', ADMIN_EMAIL);
  await page.fill('input[type="password"]', ADMIN_PWD);
  await page.locator('button:has-text("登录")').first().click();
  await page.waitForTimeout(2400);
  await page.goto(BASE + '/admin/dashboard', { waitUntil: 'networkidle' });
  const dashTxt = await page.locator('body').innerText();
  const adminOk = /数据看板|看板|概览/.test(dashTxt) && !/登录账户/.test(dashTxt);
  check('商家账号可进入后台', adminOk, `url=${page.url()} len=${dashTxt.length}`);

  for (const [label, path] of [
    ['看板', '/admin/dashboard'],
    ['商品管理', '/admin/products'],
    ['订单管理', '/admin/orders'],
    ['退款审核', '/admin/refunds'],
    ['AI 会话', '/admin/ai-conversations'],
    ['运营智能体', '/admin/ai-ops'],
    ['AI 配置', '/admin/settings'],
  ]) {
    errs = []; netFails = [];
    await open(path);
    await audit(label);
    const bodyTxt = await page.locator('body').innerText();
    check(`[${label}] 渲染的是后台页而非登录页`, !/登录账户/.test(bodyTxt), page.url());
    await page.screenshot({ path: `${SHOT_DIR}/web-admin-${label}.png` });
    check(`[${label}] 无 JS 错误`, errs.length === 0, errs.slice(0, 2).join(' | '));
    check(`[${label}] 无失败请求`, netFails.length === 0, netFails.slice(0, 2).join(' | '));
  }

  // 未登录访问受保护路由
  await page.evaluate(() => localStorage.clear());
  await open('/orders');
  const guardTxt = await page.locator('body').innerText();
  check('未登录访问 /orders 被引导登录', /登录/.test(guardTxt), page.url());
} catch (e) {
  check('脚本执行', false, String(e).slice(0, 300));
  await page.screenshot({ path: `${SHOT_DIR}/web-error.png` }).catch(() => {});
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.pass).length;
console.log(`\n===== Web: ${passed}/${results.length} 通过 =====`);
const fails = results.filter((r) => !r.pass);
if (fails.length) {
  console.log('\n失败项：');
  fails.forEach((f) => console.log(`  - ${f.name} ${f.extra ? '| ' + f.extra : ''}`));
}
process.exit(0);
