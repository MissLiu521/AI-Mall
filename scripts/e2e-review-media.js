/**
 * 浏览器实测：评价弹窗的拍照/选图、录像/选视频、返现实时计算与提交
 *
 * 前置：先构建 web 并在 3001 起服务（npm run build && npm start）
 * 运行：node scripts/e2e-review-media.js
 */
import { chromium } from 'playwright';

const BASE = process.env.B || 'http://localhost:3001';

async function call(path, { method = 'GET', token, body } = {}) {
  const r = await fetch(BASE + '/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(`${path} 失败：${JSON.stringify(j.error)}`);
  return j.data;
}

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass += 1; console.log(`✅ ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail += 1; console.log(`❌ ${name}${extra ? ' — ' + extra : ''}`); }
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

(async () => {
  const login = await call('/auth/login', { method: 'POST', body: { email: 'demo@mall.dev', password: 'demo123' } });
  const buyer = login.token;
  const adminLogin = await call('/auth/login', { method: 'POST', body: { email: 'admin@mall.dev', password: 'admin123' } });

  // 造一笔已完成订单
  const order = await call('/orders', {
    method: 'POST', token: buyer,
    body: { address: '北京市朝阳区建国路 88 号 SOHO 现代城 B 座 1203', productId: 2, qty: 1, idemKey: 'e2e-review-' + Date.now() },
  });
  await call(`/orders/${order.id}/pay`, { method: 'POST', token: buyer });
  await call(`/admin/orders/${order.id}/ship`, {
    method: 'PATCH', token: adminLogin.token, body: { carrier: '顺丰速运', trackingNo: 'SF' + Date.now() },
  });
  await call(`/orders/${order.id}/confirm`, { method: 'POST', token: buyer });

  let browser;
  for (const ch of ['chrome', 'msedge']) {
    try { browser = await chromium.launch({ channel: ch }); break; } catch { /* next */ }
  }
  if (!browser) browser = await chromium.launch();

  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(([k, t]) => localStorage.setItem(k, t), ['aimall_token', buyer]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // 视频是测试用假文件，浏览器解码失败属预期；网络层噪音同样忽略
    if (/favicon|net::ERR|Failed to load resource|MEDIA_ELEMENT|DEMUXER|media/i.test(t)) return;
    errors.push(t);
  });

  try {
    await page.goto(`${BASE}/orders/${order.id}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForSelector('button:has-text("评价晒单")', { timeout: 15000 });
    check('订单详情出现评价入口', true);

    await page.click('button:has-text("评价晒单")');
    await page.waitForSelector('.review-modal', { timeout: 8000 });
    check('评价弹窗打开', true);

    const initialCash = (await page.locator('.rw-cash').innerText()).trim();
    check('初始预计返现为 ¥0.00', initialCash.includes('0.00'), initialCash);
    check('默认提示 1 图 + 15 字', (await page.locator('.rw-next').innerText()).includes('1 张图 + 15 字')
      || (await page.locator('.rw-tiers').innerText()).includes('1 张图 + 15 字'));

    // 只写字，不传图：仍为 0
    await page.fill('.review-modal textarea', '这件商品整体不错，做工和细节都超出预期，日常使用完全够用。');
    check('只写文字不返现', (await page.locator('.rw-cash').innerText()).includes('0.00'));

    // 上传 1 张图 → ¥1.00
    await page.locator('.review-modal input[accept*="image"]').setInputFiles([
      { name: 'shot-1.png', mimeType: 'image/png', buffer: PNG },
    ]);
    await page.waitForFunction(() => {
      const imgs = [...document.querySelectorAll('.review-modal .media-cell img')];
      return imgs.length === 1 && imgs.every((i) => i.getAttribute('src')?.includes('/api/uploads/'));
    }, { timeout: 15000 });
    check('上传 1 张图后缩略图出现', true);
    const cash1 = (await page.locator('.rw-cash').innerText()).trim();
    check('15 字 + 1 图预计返 ¥1.00', cash1.includes('1.00'), cash1);
    check('命中图文档高亮', (await page.locator('.rw-tier.hit').first().innerText()).includes('1 张图'));

    // 再传 2 张 + 写长文 → ¥3.00
    await page.locator('.review-modal input[accept*="image"]').setInputFiles([
      { name: 'shot-2.png', mimeType: 'image/png', buffer: PNG },
      { name: 'shot-3.png', mimeType: 'image/png', buffer: PNG },
    ]);
    await page.waitForFunction(() => document.querySelectorAll('.review-modal .media-cell img').length === 3, { timeout: 15000 });
    await page.fill('.review-modal textarea',
      '包装很严实，外观和图片一致没有色差，做工扎实，按键手感清晰，连接稳定，续航也够用，整体非常满意，推荐购买。');
    await page.waitForTimeout(400);
    const cash3 = (await page.locator('.rw-cash').innerText()).trim();
    check('50 字 + 3 图预计返 ¥3.00', cash3.includes('3.00'), cash3);

    // 视频加码 → ¥5.00
    await page.locator('.review-modal input[accept*="video"]').setInputFiles([
      { name: 'clip.mp4', mimeType: 'video/mp4', buffer: Buffer.concat([
        Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisomisomiso2', 'ascii'), Buffer.alloc(4096, 0),
      ]) },
    ]);
    await page.waitForSelector('.review-modal .video-box', { timeout: 15000 });
    await page.waitForTimeout(800);
    const cash5 = (await page.locator('.rw-cash').innerText()).trim();
    check('带视频后预计返 ¥5.00（封顶）', cash5.includes('5.00'), cash5);
    check('提示已达上限', (await page.locator('.rw-next').innerText()).includes('上限'));

    // ── 分项评分 + 印象标签 ──
    const dimRows = await page.locator('.review-modal .dim-grid .dim-row').count();
    check('评价弹窗有 6 个分项评分维度', dimRows === 6, `${dimRows} 个`);
    await page.locator('.review-modal .dim-row').nth(0).locator('.mini-star').nth(4).click();
    check('外观可打 5 分', (await page.locator('.review-modal .dim-row').nth(0).locator('.dim-score').innerText()).includes('5'));
    await page.locator('.review-modal .dim-row').nth(1).locator('.mini-star').nth(3).click();
    check('性能可打 4 分', (await page.locator('.review-modal .dim-row').nth(1).locator('.dim-score').innerText()).includes('4'));

    await page.locator('.review-modal .tg-chip', { hasText: '颜值在线' }).first().click();
    await page.locator('.review-modal .tg-chip', { hasText: '效果明显' }).first().click();
    check('官方标签可多选', (await page.locator('.review-modal .tg-chip.on').count()) === 2);
    check('标签计数为 2/8', (await page.locator('.review-modal .tag-block .count').innerText()).includes('2/8'));

    await page.fill('.review-modal .custom-input', '屏幕通透');
    await page.click('.review-modal .custom-row .btn');
    check('自定义标签可添加', (await page.locator('.review-modal .custom-chip').first().innerText()).includes('屏幕通透'));
    check('自定义后计数为 3/8', (await page.locator('.review-modal .tag-block .count').innerText()).includes('3/8'));

    // 提交
    await page.click('.review-modal .modal-actions .btn-primary');
    await page.waitForSelector('.review-modal', { state: 'detached', timeout: 15000 });
    check('提交成功并关闭弹窗', true);
    const toastText = await page.locator('body').innerText();
    check('提示返现到账', /返现\s*¥5\.00 已到账/.test(toastText), (toastText.match(/评价成功[^\n]*/) || [''])[0]);

    await page.waitForFunction(
      () => [...document.querySelectorAll('.rev-line')].some((n) => n.textContent?.includes('已评价')),
      { timeout: 10000 },
    );
    check('订单商品标记为已评价', true);
    await page.waitForSelector('.my-rev', { timeout: 8000 });
    const myRevText = await page.locator('.my-rev').first().innerText();
    check('订单详情显示我的评价标签', myRevText.includes('颜值在线') && myRevText.includes('屏幕通透'), myRevText.replace(/\n/g, ' '));

    // 商品页：标签云 + 按标签筛选 + 每条评价的标签
    await page.goto(`${BASE}/product/2`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.ri-media', { timeout: 15000 });
    const thumbs = await page.locator('.ri-media .ri-thumb').count();
    check('商品页展示买家晒图', thumbs >= 3, `${thumbs} 张`);
    check('商品页展示买家视频', await page.locator('.ri-media .ri-video').count() >= 1);

    await page.waitForSelector('.impressions', { timeout: 8000 });
    check('商品页出现买家印象标签云', (await page.locator('.imp-chip').count()) > 0,
      `${await page.locator('.imp-chip').count()} 个标签`);
    check('商品页出现分项评分', (await page.locator('.dim-bars .db-row').count()) > 0);
    const rvTagText = await page.locator('.ri-tags').first().innerText();
    check('评价条目展示印象标签', rvTagText.includes('颜值在线'), rvTagText.replace(/\n/g, ' '));

    await page.locator('.imp-chip', { hasText: '颜值在线' }).first().click();
    await page.waitForSelector('.imp-clear', { timeout: 8000 });
    check('点标签可筛选并在顶部显示已筛条件',
      (await page.locator('.imp-clear').innerText()).includes('颜值在线'));
    check('筛选后仍有评价', (await page.locator('.rev-item').count()) >= 1,
      `${await page.locator('.rev-item').count()} 条`);
    await page.locator('.imp-clear').click();
    await page.waitForFunction(() => !document.querySelector('.imp-clear'), { timeout: 8000 });
    check('可清除标签筛选', true);

    // 图片可点开大图
    await page.locator('.ri-media .ri-thumb').first().click();
    await page.waitForSelector('.lightbox img', { timeout: 5000 });
    check('晒图可点开大图', true);
    await page.keyboard.press('Escape');
    await page.locator('.lightbox').click({ position: { x: 10, y: 10 } });

    // 钱包
    await page.goto(`${BASE}/mine`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('button:has-text("钱包")', { timeout: 15000 });
    const walletTab = await page.locator('button:has-text("钱包")').innerText();
    check('我的页显示余额标签', walletTab.includes('¥'), walletTab);
    await page.click('button:has-text("钱包")');
    await page.waitForSelector('.w-list', { timeout: 8000 });
    const listText = await page.locator('.w-list').innerText();
    check('钱包流水出现评价返现', listText.includes('评价返现'), listText.split('\n').slice(0, 3).join(' / '));
    check('钱包页显示可用余额', (await page.locator('.wc-amount').innerText()).includes('¥'));

    // 后台：词库管理页可打开，能看到待审核的自定义词
    const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await adminCtx.addInitScript(([k, t]) => localStorage.setItem(k, t), ['aimall_token', adminLogin.token]);
    const adminPage = await adminCtx.newPage();
    adminPage.on('pageerror', (e) => errors.push('admin: ' + e.message));
    await adminPage.goto(`${BASE}/admin/review-tags`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await adminPage.waitForSelector('.tbl tbody tr', { timeout: 15000 });
    check('后台评价标签页可打开', (await adminPage.locator('.tbl tbody tr').count()) > 0,
      `${await adminPage.locator('.tbl tbody tr').count()} 行`);
    const adminText = await adminPage.locator('.tbl').innerText();
    check('后台能看到买家自创标签', adminText.includes('屏幕通透'), '待审核池');
    check('后台有维度与引用数列', adminText.includes('外观') && adminText.includes('引用'));
    await adminCtx.close();
  } finally {
    await browser.close();
  }

  check('全程无 JS 报错', errors.length === 0, errors.slice(0, 2).join(' | '));
  console.log(`\n${fail ? '❌' : '✅'} 评价媒体与返现走查：${pass} 通过 / ${fail} 失败\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('走查异常：', e.message);
  process.exit(1);
});
