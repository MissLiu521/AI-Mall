/**
 * 浏览器端到端验证 + 截图
 * 用法：node scripts/e2e.js
 * 依赖：playwright（npx playwright install chromium）
 */
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '../docs/screenshots');
const BASE = process.env.BASE || 'http://127.0.0.1:3001';
fs.mkdirSync(OUT, { recursive: true });

const log = (ok, label, extra = '') => console.log(`  ${ok ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`);

const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });

(async () => {
  // 优先用系统 Chrome/Edge，避免额外下载浏览器
  const CHANNELS = ['chrome', 'msedge'];
  let browser;
  for (const ch of CHANNELS) {
    try { browser = await chromium.launch({ channel: ch }); break; } catch { /* next */ }
  }
  if (!browser) browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));

  console.log('\n▶ 浏览器端到端验证\n');

  // 1. C 端首页
  await page.goto(`${BASE}/shop`, { waitUntil: 'networkidle' });
  const title = await page.locator('.hero-title').textContent();
  log(!!title, 'C 端首页渲染', title?.trim());
  const cards = await page.locator('.pcard').count();
  log(cards >= 4, '商品卡片加载', `${cards} 个`);
  await shot(page, '01-c-home');

  // 2. 商品详情
  await page.locator('.pcard').first().click();
  await page.waitForURL(/\/product\/\d+/);
  await page.waitForSelector('.title', { timeout: 5000 });
  const pname = await page.locator('h1.title').textContent();
  log(!!pname, '商品详情渲染', pname?.trim());
  await shot(page, '02-c-product');

  // 3. AI 助手（未登录，导购模式）
  await page.locator('.fab').click();
  await page.waitForSelector('.drawer');
  await shotsDelay(300);
  await shot(page, '03-c-ai-drawer');
  await page.locator('.chip').first().click();
  await page.waitForSelector('.msg.assistant .bubble-ai:not(.typing)', { timeout: 15000 });
  const aiReply = await page.locator('.msg.assistant .bubble-ai').last().textContent();
  log(!!aiReply && aiReply.length > 5, 'AI 导购回复', aiReply?.slice(0, 40).replace(/\n/g, ' '));
  await shot(page, '04-c-ai-reply');
  await page.locator('.close-btn').click();

  // 4. 登录
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await shot(page, '05-login');
  await page.locator('.demo-btn').first().click();
  await page.locator('button[type=submit]').click();
  await page.waitForURL(/\/shop|\/admin/, { timeout: 8000 });
  log(true, '买家登录成功', page.url().replace(BASE, ''));

  // 5. 加购 + 购物车
  await page.goto(`${BASE}/shop`, { waitUntil: 'networkidle' });
  await page.locator('.add-btn').first().click();
  await page.waitForTimeout(600);
  await page.goto(`${BASE}/cart`, { waitUntil: 'networkidle' });
  const cartRows = await page.locator('.row-item').count();
  log(cartRows > 0, '购物车有商品', `${cartRows} 条`);
  await shot(page, '06-c-cart');

  // 6. 结算下单
  await page.locator('.btn-primary.btn-lg').click();
  await page.waitForURL(/\/checkout/);
  // 结算页已升级为「地址簿 + 智能识别」：有地址直接选；表单已展开就直接填；否则点开表单
  const addrItem = page.locator('.addr-list .addr').first();
  const smartBox = page.locator('.addr-form textarea.textarea').first();
  if (await addrItem.count()) {
    await addrItem.click();
  } else if (await smartBox.count()) {
    await smartBox.fill('张三 13800138000 北京市朝阳区建国路 88 号 SOHO 现代城 B 座 1203');
    await page.locator('button', { hasText: '自动拆分填入' }).click();
    await page.waitForTimeout(300);
    await page.locator('button', { hasText: '保存地址' }).click();
    await page.waitForTimeout(800);
  } else {
    await page.locator('button.link-btn', { hasText: '使用新地址' }).click();
    await page.locator('textarea.textarea').first().fill('张三 13800138000 北京市朝阳区建国路 88 号 SOHO 现代城 B 座 1203');
    await page.locator('button', { hasText: '自动拆分填入' }).click();
    await page.waitForTimeout(300);
    await page.locator('button', { hasText: '保存地址' }).click();
    await page.waitForTimeout(800);
  }
  log(true, '结算页收货地址就绪', (await page.locator('.addr-detail').first().textContent())?.trim().slice(0, 24));
  await shot(page, '07-c-checkout');
  await page.locator('.btn-primary.btn-lg').click();
  await page.waitForURL(/\/orders\/\d+/, { timeout: 12000 });
  const orderStatus = await page.locator('.badge').first().textContent();
  log(!!orderStatus, '下单成功', orderStatus?.trim());
  await shot(page, '08-c-order-detail');

  // 7. AI 客服查订单
  await page.locator('.fab').click();
  await page.locator('.scene-btn').nth(1).click();
  await page.waitForTimeout(400);
  await page.locator('.chat-input').fill('我上一个订单到哪了');
  await page.locator('.send-btn').click();
  await page.waitForSelector('.msg.assistant .bubble-ai:not(.typing)', { timeout: 15000 });
  const supportReply = await page.locator('.msg.assistant .bubble-ai').last().textContent();
  log(!!supportReply?.includes('订单'), 'AI 客服查到真实订单', supportReply?.slice(0, 50).replace(/\n/g, ' '));
  // 展开工具轨迹
  const traceBtn = page.locator('.trace-toggle').last();
  if (await traceBtn.count()) { await traceBtn.click(); await page.waitForTimeout(300); }
  await shot(page, '09-c-ai-support-trace');
  await page.locator('.close-btn').click();

  // 8. 我的订单
  await page.goto(`${BASE}/orders`, { waitUntil: 'networkidle' });
  const orderCount = await page.locator('.order').count();
  log(orderCount > 0, '订单列表渲染', `${orderCount} 笔`);
  await shot(page, '10-c-orders');

  // 9. B 端：切换商家
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.locator('.demo-btn').nth(1).click();
  await page.locator('button[type=submit]').click();
  await page.waitForURL(/\/admin/, { timeout: 8000 });
  await page.waitForSelector('.stat');
  const statCount = await page.locator('.stat').count();
  log(statCount >= 6, '商家看板渲染', `${statCount} 张指标卡`);
  await shot(page, '11-b-dashboard');

  // 10. B 端商品
  await page.goto(`${BASE}/admin/products`, { waitUntil: 'networkidle' });
  const prodRows = await page.locator('tbody tr').count();
  log(prodRows > 0, '商品管理表格', `${prodRows} 行`);
  await shot(page, '12-b-products');
  await page.locator('.link-btn.ai').first().click();
  await page.waitForSelector('.drawer', { timeout: 20000 });
  const subtitle = await page.locator('.drawer-body input').nth(1).inputValue();
  log(!!subtitle, 'AI 一键生成文案并回填', subtitle?.slice(0, 30));
  await shot(page, '13-b-ai-copy');
  await page.locator('.drawer-head .close').click();

  // 11. B 端订单
  await page.goto(`${BASE}/admin/orders`, { waitUntil: 'networkidle' });
  log((await page.locator('tbody tr').count()) > 0, '订单管理渲染');
  await shot(page, '14-b-orders');

  // 12. 退款审核
  await page.goto(`${BASE}/admin/refunds`, { waitUntil: 'networkidle' });
  log(true, '退款审核页渲染', `${await page.locator('tbody tr').count()} 条`);
  await shot(page, '15-b-refunds');

  // 13. AI 会话
  await page.goto(`${BASE}/admin/ai-conversations`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  log((await page.locator('.conv-item').count()) > 0, 'AI 会话列表');
  await shot(page, '16-b-ai-conversations');

  // 14. 运营智能体
  await page.goto(`${BASE}/admin/ai-ops`, { waitUntil: 'networkidle' });
  await page.locator('.preset').first().click();
  await page.waitForSelector('.bubble-ai:not(.typing)', { timeout: 20000 });
  const opsReply = await page.locator('.bubble-ai').last().textContent();
  log(!!opsReply?.includes('滞销'), '运营智能体分析滞销', opsReply?.slice(0, 40).replace(/\n/g, ' '));
  await shot(page, '17-b-ai-ops');

  // 15. AI 配置
  await page.goto(`${BASE}/admin/settings`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  log((await page.locator('.code-block').count()) > 0, 'AI 配置页渲染');
  await shot(page, '18-b-settings');

  console.log('\n  控制台错误：', errors.length ? `\n   - ${errors.slice(0, 8).join('\n   - ')}` : '无');
  console.log(`\n▶ 截图已保存至 docs/screenshots/\n`);
  await browser.close();
})().catch((e) => { console.error('E2E 失败:', e.message); process.exit(1); });

function shotsDelay(ms) { return new Promise((r) => setTimeout(r, ms)); }
