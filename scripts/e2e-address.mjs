/**
 * 地址表单真实交互验证（CDP + 系统 Edge，无需下载浏览器）
 * 运行：node scripts/e2e-address.mjs
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const req = createRequire('C:/Users/liubi/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = req('playwright-core');

const BASE = process.env.BASE || 'http://localhost:5173';
const API = process.env.API || 'http://127.0.0.1:3001';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const SHOT_DIR = 'docs/screenshots/address';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const results = [];
const check = (name, pass, extra = '') => {
  results.push({ name, pass });
  console.log(`${pass ? '✅' : '❌'} ${name}${extra ? '  —  ' + extra : ''}`);
};

// 1. 直接调 API 拿 token，跳过登录页
const loginRes = await fetch(`${API}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'demo@mall.dev', password: 'demo123' }),
}).then((r) => r.json());
const token = loginRes.data.token;

const browser = await chromium.launch({
  executablePath: EDGE, headless: true,
  args: ['--no-proxy-server'], // 绕过系统代理，本地服务直连
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
await ctx.addInitScript((t) => localStorage.setItem('aimall_token', t), token);
const page = await ctx.newPage();

const errors = [];
const IGNORE = /favicon|ResizeObserver|DevTools|sourcemap/i;
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  if (IGNORE.test(m.text()) || IGNORE.test(m.location()?.url || '')) return;
  errors.push('console: ' + m.text());
});
// 记录 404 的具体 URL，避免只看到一句 "Failed to load resource"
const failed404 = [];
page.on('response', (r) => { if (r.status() === 404) failed404.push(r.url()); });

// 先进结算页前清空已有地址，保证表单可见
const existing = await fetch(`${API}/api/addresses`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
for (const a of existing.data || []) {
  await fetch(`${API}/api/addresses/${a.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
}

await page.goto(`${BASE}/checkout?productId=2&qty=1`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('text=智能识别', { timeout: 20000 });
check('结算页渲染出「智能识别」区', true);
await page.screenshot({ path: path.join(SHOT_DIR, '1-empty.png') });

// 2. 智能识别：整段粘贴 → 自动拆分
const smartInput = page.locator('textarea').first();
await smartInput.fill('收货人：张三，电话 138-0013-8000，北京市朝阳区建国路 88 号 SOHO 现代城 B 座 1203');
await page.click('text=自动拆分填入');
await page.waitForTimeout(400);

const nameVal = await page.locator('input[placeholder="姓名"]').inputValue();
const phoneVal = await page.locator('input[placeholder="11 位手机号"]').inputValue();
const selectVals = await page.locator('.cascade select').evaluateAll((els) => els.map((e) => e.value));
const detailVal = await page.locator('textarea[placeholder*="街道"]').inputValue();

check('识别出收件人', nameVal === '张三', nameVal);
check('识别出手机号（去掉分隔符）', phoneVal === '13800138000', phoneVal);
check('识别出省市区', selectVals.join('/') === '北京市/北京市/朝阳区', selectVals.join('/'));
check('识别出详细地址', detailVal.includes('建国路') && detailVal.includes('1203'), detailVal);

const hint = await page.locator('.hint').textContent().catch(() => '');
check('给出识别结果提示', /已自动填好|需要手动补全/.test(hint || ''), hint?.trim());
await page.screenshot({ path: path.join(SHOT_DIR, '2-parsed.png') });

// 3. 必填校验：清空手机号 → 失焦
const phoneBox = page.locator('input[placeholder="11 位手机号"]');
await phoneBox.fill('');
await page.locator('input[placeholder="姓名"]').click();
await page.waitForTimeout(200);
const phoneErr = await page.locator('.err').first().textContent().catch(() => '');
check('手机号为空时显示红字错误', /手机号/.test(phoneErr || ''), phoneErr?.trim());

// 4. 详址过短
const detailBox = page.locator('textarea[placeholder*="街道"]');
await detailBox.fill('88号');
await page.locator('input[placeholder="姓名"]').click();
await page.waitForTimeout(200);
const detailErr = await page.locator('.err').allTextContents();
check('详址少于 5 字时提示', detailErr.some((t) => /详细地址/.test(t)), detailErr.join(' / '));

const submitDisabled = await page.locator('button:has-text("提交订单")').isDisabled();
check('表单不完整时「提交订单」置灰', submitDisabled);
await page.screenshot({ path: path.join(SHOT_DIR, '3-errors.png') });

// 5. 补全后可保存
await phoneBox.fill('13800138000');
await detailBox.fill('建国路 88 号 SOHO 现代城 B 座 1203');
await page.locator('input[placeholder="姓名"]').click();
await page.waitForTimeout(200);
await page.click('text=保存地址');
await page.waitForTimeout(1200);

const cards = await page.locator('.addr').count();
check('保存后出现在地址列表', cards >= 1, `${cards} 条`);
const cardText = await page.locator('.addr').first().textContent().catch(() => '');
check('列表展示姓名与完整地址', /张三/.test(cardText || '') && /朝阳区/.test(cardText || ''), cardText?.replace(/\s+/g, ' ').trim().slice(0, 60));
await page.screenshot({ path: path.join(SHOT_DIR, '4-saved.png') });

check('页面无 JS 报错', errors.length === 0, (errors.slice(0, 2).join(' | ') || '') + (failed404.length ? ` [404: ${failed404.slice(0, 2).join(', ')}]` : ''));
if (failed404.length) console.log('   404 资源：' + failed404.slice(0, 3).join('\n   '));

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${failed.length ? '❌' : '✅'} 地址表单交互：${results.length - failed.length} 通过 / ${failed.length} 失败`);
process.exit(failed.length ? 1 : 0);
