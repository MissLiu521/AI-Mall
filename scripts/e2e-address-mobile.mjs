/**
 * 移动端 H5 地址表单验证（iPhone 视口，CDP + 系统 Edge）
 * 运行：node scripts/e2e-address-mobile.mjs   （需先 npm run dev:mobile）
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const req = createRequire('C:/Users/liubi/.workbuddy/binaries/node/workspace/package.json');
const { chromium, devices } = req('playwright-core');

const BASE = process.env.MOBILE_BASE || 'http://localhost:5180';
const API = process.env.API || 'http://127.0.0.1:3001';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const SHOT_DIR = 'docs/screenshots/address';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const results = [];
const check = (name, pass, extra = '') => {
  results.push({ name, pass });
  console.log(`${pass ? '✅' : '❌'} ${name}${extra ? '  —  ' + extra : ''}`);
};

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
const ctx = await browser.newContext({ ...devices['iPhone 12'] });
const page = await ctx.newPage();

const errors = [];
const IGNORE = /favicon|ResizeObserver|DevTools|sourcemap/i;
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  if (IGNORE.test(m.text()) || IGNORE.test(m.location()?.url || '')) return;
  errors.push('console: ' + m.text());
});

// 走真实登录流程（uni 的 storage 有包装，直接注入 localStorage 不可靠）
await page.goto(`${BASE}/#/pages/login/login`, { waitUntil: 'networkidle' });
await page.waitForSelector('text=演示账号', { timeout: 20000 });
await page.click('text=买家'); // 一键填入演示账号
await page.waitForTimeout(800);
await page.locator('.btn.btn-primary').click();
// uni 首次按需编译较慢，等 URL 离开登录页
await page.waitForFunction(() => !location.hash.includes('login'), null, { timeout: 30000 });
check('演示账号登录成功', true, page.url());

// 清空已有地址，保证结算页直接展示新建表单
const existing = await fetch(`${API}/api/addresses`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
for (const a of existing.data || []) {
  await fetch(`${API}/api/addresses/${a.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
}

await page.goto(`${BASE}/#/pages/checkout/checkout?productId=2&qty=1`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('text=智能识别', { timeout: 30000 });
check('确认订单页渲染出「智能识别」区', true);

// 整段粘贴 → 自动拆分
await page.locator('textarea').first().fill('李四13900139000广东省深圳市南山区科技园南路18号A栋502');
await page.click('text=自动拆分填入');
await page.waitForTimeout(500);

const nameVal = await page.locator('input').nth(0).inputValue();
const phoneVal = await page.locator('input').nth(1).inputValue();
const detailVal = await page.locator('textarea').nth(1).inputValue();
const pickerText = await page.locator('.picker').textContent().catch(() => '');

check('识别出收件人', nameVal === '李四', nameVal);
check('识别出手机号', phoneVal === '13900139000', phoneVal);
check('识别出省市区并回显到 picker', /广东省.*深圳市.*南山区/.test(pickerText || ''), pickerText?.trim());
check('识别出详细地址', /科技园南路/.test(detailVal || ''), detailVal?.trim());
check('给出识别提示', /已自动填好|需要手动补全/.test((await page.locator('.hint').textContent().catch(() => '')) || ''));

// 校验：清空手机号
await page.locator('input').nth(1).fill('');
await page.locator('input').nth(0).click();
await page.waitForTimeout(300);
const errText = (await page.locator('.err').allTextContents()).join(' / ');
check('必填校验红字出现', /手机号/.test(errText), errText);

await page.screenshot({ path: path.join(SHOT_DIR, '5-mobile-parsed.png'), fullPage: true });

check('页面无 JS 报错', errors.length === 0, errors.slice(0, 2).join(' | '));
await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${failed.length ? '❌' : '✅'} 移动端地址表单：${results.length - failed.length} 通过 / ${failed.length} 失败`);
process.exit(failed.length ? 1 : 0);
