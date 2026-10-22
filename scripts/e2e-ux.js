/**
 * 体验改进专项 E2E：验证 docs/06 中落地的四项改进
 * 1. 搜索可解释 + 零结果兜底
 * 2. 商品信息透明（规格 / 库存 / 价格构成 / 退换政策）
 * 3. 退款时间轴
 * 4. AI 客服能力边界明示
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:3001';
const SHOT = 'docs/screenshots/ux';

const results = [];
const check = (name, pass, extra = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  —  ' + extra : ''}`);
};

let browser;
for (const ch of ['msedge', 'chrome']) {
  try { browser = await chromium.launch({ channel: ch }); break; } catch { /* next */ }
}
if (!browser) browser = await chromium.launch();

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  if (/favicon|ResizeObserver|Devtools/i.test(m.location()?.url || '')) return;
  errors.push(m.text());
});

try {
  // 先加载根路径：SPA 需要先初始化，直接深链会先渲染首页再跳转，导致断言时机错乱
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  // ── 1. 搜索可解释 ──
  await page.goto(`${BASE}/shop/category?q=${encodeURIComponent('降噪耳机')}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const reasonTags = await page.locator('.reason-tag').count();
  const firstReason = await page.locator('.reason-tag').first().innerText().catch(() => '');
  check('搜索结果展示匹配理由', reasonTags > 0, `${reasonTags} 个标签，首个：${firstReason}`);
  await page.screenshot({ path: `${SHOT}/01-search-reason.png` });

  // ── 2. 零结果兜底 ──
  await page.goto(`${BASE}/shop/category?q=${encodeURIComponent('zzz不存在的商品zzz')}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const suggestions = await page.locator('.sugg').count();
  const suggText = await page.locator('.sugg').first().innerText().catch(() => '');
  check('零结果给出可点击兜底建议', suggestions > 0, `${suggestions} 条，首条：${suggText}`);
  await page.screenshot({ path: `${SHOT}/02-search-empty.png` });

  // ── 3. 商品详情信息透明 ──
  await page.goto(`${BASE}/product/1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const specRows = await page.locator('.spec-row').count();
  check('规格实测表渲染', specRows >= 3, `${specRows} 行`);
  const stockStrip = await page.locator('.stock-strip').innerText().catch(() => '');
  check('库存语义化展示', stockStrip.length > 0, stockStrip.replace(/\n/g, ' '));
  const priceDetail = await page.locator('.price-detail').innerText().catch(() => '');
  check('价格构成明细展示', priceDetail.includes('到手价'), priceDetail.split('\n')[0]);
  const policy = await page.locator('.policy-strip').innerText().catch(() => '');
  check('退换政策前置展示', policy.length > 0, policy.replace(/\n/g, ' '));
  await page.screenshot({ path: `${SHOT}/03-product-transparent.png` });

  // ── 4. 登录 + 下单 + 退款 → 时间轴 ──
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.fill('input[type="email"]', 'demo@mall.dev');
  await page.fill('input[type="password"]', 'demo123');
  await page.locator('button.btn-primary').last().click();
  await page.waitForTimeout(2500);
  const token = await page.evaluate(() => localStorage.getItem('aimall_token') || '');
  check('登录成功', token.length > 20, `token len=${token.length}`);

  // 直接走订单列表，优先找可退订单；全新库里没有就现场造一笔（下单→支付→申请退款）
  await page.goto(`${BASE}/orders`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const orders = await page.evaluate(async (t) => {
    const r = await fetch('/api/orders/mine', { headers: { Authorization: 'Bearer ' + t } });
    const j = await r.json();
    return j.data?.items || j.data || [];
  }, token);
  check('订单列表可进入', orders.length > 0, `${orders.length} 笔`);

  let target = orders.find((o) => ['paid', 'shipped', 'completed'].includes(o.status));
  if (!target) {
    target = await page.evaluate(async (t) => {
      const h = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t };
      const p = await (await fetch('/api/products/1')).json();
      const skuId = p.data.skus?.[0]?.id;
      const o = await (await fetch('/api/orders', {
        method: 'POST', headers: h,
        body: JSON.stringify({ address: '北京市朝阳区建国路 88 号 SOHO B 座 1203（演示用户 13800138000）', productId: 1, skuId, qty: 1, idemKey: 'ux-' + Date.now() }),
      })).json();
      await fetch(`/api/orders/${o.data.id}/pay`, { method: 'POST', headers: h, body: JSON.stringify({ method: 'wechat' }) });
      return o.data;
    }, token);
  }
  await page.goto(`${BASE}/orders/${target.id}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  // 若有可退订单，提交退款
  const refundBtn = page.locator('button:has-text("申请退款")');
  if (await refundBtn.count() && await refundBtn.first().isEnabled()) {
    await refundBtn.first().click();
    await page.waitForTimeout(400);
    await page.fill('textarea', '尺码偏小，需要退货');
    await page.locator('.modal-actions .btn-danger').click();
    await page.waitForTimeout(2000);
  }
  const tlNodes = await page.locator('.tl-node').count();
  const nextAction = await page.locator('.next-action').innerText().catch(() => '');
  check('退款时间轴渲染', tlNodes >= 3, `${tlNodes} 个节点`);
  check('时间轴给出下一步指引', nextAction.length > 0, nextAction.replace(/\n/g, ' ').slice(0, 50));
  await page.screenshot({ path: `${SHOT}/04-refund-timeline.png` });

  // ── 5. AI 客服能力边界 ──
  await page.goto(`${BASE}/shop`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.locator('.ai-fab, [class*="ai-fab"], [aria-label*="AI"]').first().click();
  await page.waitForTimeout(800);
  // 切到客服场景
  const supportBtn = page.locator('.scene-btn', { hasText: 'AI 客服' });
  if (await supportBtn.count()) await supportBtn.first().click();
  await page.waitForTimeout(800);
  const capYes = await page.locator('.cap-yes').count();
  const capNo = await page.locator('.cap-no').count();
  const capText = await page.locator('.cap-card').innerText().catch(() => '');
  check('AI 入口明示"能办什么"', capYes > 0, capText.split('\n').slice(0, 2).join(' / '));
  check('AI 入口明示"办不了什么"', capNo > 0);
  await page.screenshot({ path: `${SHOT}/05-ai-capability.png` });

  // ── 6. 无运行时错误 ──
  check('无 JS 运行时错误', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (e) {
  check('脚本执行', false, String(e).slice(0, 220));
  await page.screenshot({ path: `${SHOT}/error.png` }).catch(() => {});
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} 通过`);
process.exit(passed === results.length ? 0 : 1);
