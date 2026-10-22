/** 临时截图脚本：验证评价弹窗 / 商品评价区 / 钱包 / 结算页视觉 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.B || 'http://127.0.0.1:3001';
const OUT = 'C:/tmp/shots';
fs.mkdirSync(OUT, { recursive: true });

async function call(path, { method = 'GET', token, body } = {}) {
  const r = await fetch(BASE + '/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (!j.ok) throw new Error(path + ' ' + JSON.stringify(j.error));
  return j.data;
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

(async () => {
  const { token } = await call('/auth/login', { method: 'POST', body: { email: 'demo@mall.dev', password: 'demo123' } });
  const admin = await call('/auth/login', { method: 'POST', body: { email: 'admin@mall.dev', password: 'admin123' } });

  const order = await call('/orders', {
    method: 'POST', token,
    body: { address: '北京市朝阳区建国路 88 号 SOHO 现代城 B 座 1203', productId: 2, qty: 1, idemKey: 'shot-' + Date.now() },
  });
  await call(`/orders/${order.id}/pay`, { method: 'POST', token });
  await call(`/admin/orders/${order.id}/ship`, { method: 'PATCH', token: admin.token, body: { carrier: '顺丰速运', trackingNo: 'SF1234567890' } });
  await call(`/orders/${order.id}/confirm`, { method: 'POST', token });

  let browser;
  for (const ch of ['chrome', 'msedge']) {
    try { browser = await chromium.launch({ channel: ch }); break; } catch { /* next */ }
  }
  if (!browser) browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(([k, t]) => localStorage.setItem(k, t), ['aimall_token', token]);
  const page = await ctx.newPage();

  // 1. 评价弹窗
  await page.goto(`${BASE}/orders/${order.id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('button:has-text("评价晒单")');
  await page.click('button:has-text("评价晒单")');
  await page.waitForSelector('.review-modal');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/1-review-empty.png` });

  await page.fill('.review-modal textarea', '包装很严实，外观和图片一致没有色差，做工扎实，按键手感清晰，连接稳定，续航也够用，整体非常满意，推荐购买。');
  await page.locator('.review-modal input[accept*="image"]').setInputFiles([
    { name: 'a.png', mimeType: 'image/png', buffer: PNG },
    { name: 'b.png', mimeType: 'image/png', buffer: PNG },
    { name: 'c.png', mimeType: 'image/png', buffer: PNG },
  ]);
  await page.waitForFunction(() => document.querySelectorAll('.review-modal .media-cell img').length === 3);
  await page.locator('.review-modal input[accept*="video"]').setInputFiles([
    { name: 'clip.mp4', mimeType: 'video/mp4', buffer: Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisomisomiso2', 'ascii'), Buffer.alloc(2048, 0)]) },
  ]);
  await page.waitForSelector('.review-modal .video-box');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/2-review-filled.png` });

  await page.click('.review-modal .modal-actions .btn-primary');
  await page.waitForSelector('.review-modal', { state: 'detached' });
  await page.waitForTimeout(1200);

  // 2. 商品页评价区
  await page.goto(`${BASE}/product/2`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#reviews .rev-item');
  await page.locator('#reviews').scrollIntoViewIfNeeded();
  await page.waitForTimeout(900);
  await page.locator('#reviews').screenshot({ path: `${OUT}/3-product-reviews.png` });

  // 3. 钱包
  await page.goto(`${BASE}/mine`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('button:has-text("钱包")');
  await page.click('button:has-text("钱包")');
  await page.waitForSelector('.w-list');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/4-wallet.png`, fullPage: false });

  // 4. 结算页余额抵扣
  await page.goto(`${BASE}/checkout?productId=3&qty=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.benefit-row');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/5-checkout.png`, fullPage: false });

  await browser.close();
  console.log('shots done');
})().catch((e) => { console.error(e); process.exit(1); });
