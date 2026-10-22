/**
 * 移动端 H5 真机视口 E2E
 * 以 iPhone 12 视口访问局域网地址，验证核心链路
 */
import { chromium, devices } from 'playwright';

const BASE = process.env.MOBILE_BASE || 'http://192.168.110.33:5180';
const SHOT_DIR = 'docs/screenshots/mobile';

const results = [];
const check = (name, pass, extra = '') => {
  results.push({ name, pass, extra });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  —  ' + extra : ''}`);
};

const CHANNELS = ['msedge', 'chrome'];
let browser;
for (const ch of CHANNELS) {
  try { browser = await chromium.launch({ channel: ch }); break; } catch { /* next */ }
}
if (!browser) browser = await chromium.launch();

const ctx = await browser.newContext({ ...devices['iPhone 12'] });
const page = await ctx.newPage();
const errors = [];
const IGNORE = /favicon|ResizeObserver|Vue Devtools|sourcemap/i;
page.on('console', (m) => { if (m.type() !== 'error') return; if (IGNORE.test(m.location()?.url || '')) return; errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

/** hash 路由页内跳转不会重建实例，这里用 reload 强制走真实首次加载 */
const open = async (hash) => {
  await page.goto(BASE + '/' + hash, { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
};

try {
  // 1. 首页
  await open('#/pages/index/index');
  const title = await page.title();
  check('首页加载', !!title, title);

  const cards = await page.locator('.pcard').count();
  check('首页商品卡片渲染', cards > 0, `count=${cards}`);
  await page.screenshot({ path: `${SHOT_DIR}/01-home.png` });

  // 2. 分类页
  await open('#/pages/category/category');
  const catCards = await page.locator('.pcard').count();
  check('分类页商品列表', catCards > 0, `count=${catCards}`);
  await page.screenshot({ path: `${SHOT_DIR}/02-category.png` });

  // 3. 登录
  await open('#/pages/login/login');
  await page.fill('input:not([type="password"])', 'demo@mall.dev');
  await page.fill('input[type="password"]', 'demo123');
  await page.screenshot({ path: `${SHOT_DIR}/03-login.png` });
  await page.locator('text=登录').last().click();
  await page.waitForTimeout(2200);
  const token = await page.evaluate(() => localStorage.getItem('aimall_token') || '');
  check('登录写入 token', token.length > 20, `len=${token.length}`);

  // 4. AI 导购
  await open('#/pages/ai/ai');
  await page.screenshot({ path: `${SHOT_DIR}/04-ai-empty.png` });
  await page.locator('.chip').first().click();
  await page.waitForTimeout(4000);
  const bubbles = await page.locator('.bubble.assistant').count();
  const aiText = await page.locator('.bubble.assistant').last().innerText().catch(() => '');
  check('AI 导购有回复', bubbles > 0 && aiText.length > 5, aiText.slice(0, 40).replace(/\n/g, ' '));
  await page.screenshot({ path: `${SHOT_DIR}/05-ai-shopping.png` });

  // 5. 工具轨迹展开
  const traceHead = page.locator('.trace-head').last();
  if (await traceHead.count()) {
    await traceHead.click();
    await page.waitForTimeout(500);
    const items = await page.locator('.trace-item').count();
    check('工具轨迹可展开', items > 0, `tools=${items}`);
    await page.screenshot({ path: `${SHOT_DIR}/06-ai-trace.png` });
  } else {
    check('工具轨迹可展开', false, '未出现 trace');
  }

  // 6. AI 客服（查订单 —— 需要真实登录态 + 工具调用）
  await open('#/pages/ai/ai?scene=support');
  const heroTitle = await page.locator('.hero-title').innerText().catch(() => '');
  check('AI 场景可切换为客服', heroTitle.includes('帮你'), heroTitle);
  await page.locator('.chip').first().click();
  await page.waitForTimeout(4000);
  const supportText = await page.locator('.bubble.assistant').last().innerText().catch(() => '');
  check('AI 客服能查订单', /AIM|订单|没有|未找到/.test(supportText), supportText.slice(0, 60).replace(/\n/g, ' '));
  await page.screenshot({ path: `${SHOT_DIR}/07-ai-support.png` });

  // 7. 商品详情
  await open('#/pages/category/category');
  await page.locator('.pcard').first().click();
  await page.waitForTimeout(1600);
  check('商品详情可进入', page.url().includes('detail'), page.url().split('#')[1] || '');
  const detailBody = await page.locator('body').innerText();
  check('详情页展示价格与库存', /¥/.test(detailBody) && /库存|已选/.test(detailBody), detailBody.slice(0, 40).replace(/\n/g, ' '));
  await page.screenshot({ path: `${SHOT_DIR}/08-detail.png` });

  // 8. 购物车
  await open('#/pages/cart/cart');
  const cartBody = await page.locator('body').innerText();
  check('购物车页渲染', cartBody.includes('购物车') || cartBody.includes('去结算') || cartBody.includes('空空'), cartBody.slice(0, 40).replace(/\n/g, ' '));
  await page.screenshot({ path: `${SHOT_DIR}/09-cart.png` });

  // 9. 订单列表
  await open('#/pages/orders/orders');
  const ordersBody = await page.locator('body').innerText();
  check('订单列表渲染', /AIM\d{8}/.test(ordersBody) || ordersBody.includes('暂无'), ordersBody.slice(0, 50).replace(/\n/g, ' '));
  await page.screenshot({ path: `${SHOT_DIR}/10-orders.png` });

  // 10. 我的
  await open('#/pages/mine/mine');
  const mineBody = await page.locator('body').innerText();
  check('我的页显示登录用户', mineBody.includes('demo') || mineBody.includes('体验官'), mineBody.slice(0, 50).replace(/\n/g, ' '));
  await page.screenshot({ path: `${SHOT_DIR}/11-mine.png` });

  // 11. 无 JS 运行时错误
  const realErrors = errors.filter((e) => !/favicon|ResizeObserver|Vue Devtools|sourcemap/i.test(e));
  check('无 JS 运行时错误', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

} catch (e) {
  check('脚本执行', false, String(e).slice(0, 260));
  await page.screenshot({ path: `${SHOT_DIR}/error.png` }).catch(() => {});
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} 通过`);
process.exit(passed === results.length ? 0 : 1);
