/**
 * 拼团超时结算验证（需要跑在真实定时任务上）
 *
 * 场景：
 *   A 团 —— 只开团不付款，超时后应自动关单并回补库存
 *   B 团 —— 已付款但没凑满人，超时后应自动退款（订单变已退款 + 生成退款记录 + 资产回滚）
 *
 * 用法：DATA_DIR=/tmp/mall_f3 B=http://127.0.0.1:3022 node scripts/test-group-timeout.js
 */
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const BASE = process.env.B || 'http://127.0.0.1:3010';
const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'server/data');

async function call(p, { method = 'GET', token, body } = {}) {
  const r = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ok: j.ok, data: j.data, error: j.error };
}

let pass = 0; let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`✅ ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail += 1; console.log(`❌ ${name}${extra ? ' — ' + extra : ''}`); }
};

const login = async (email, password) => {
  const r = await call('/api/auth/login', { method: 'POST', body: { email, password } });
  if (!r.ok) throw new Error('登录失败 ' + JSON.stringify(r.error));
  return r.data.token;
};

/** 把团改成已过期，让定时任务在下一轮扫到 */
function expireTeam(teamId) {
  const db = new DatabaseSync(path.join(DATA_DIR, 'mall.db'));
  db.exec('PRAGMA busy_timeout = 5000;');
  db.prepare("UPDATE group_teams SET expire_at = datetime('now', '-1 hour') WHERE id = ?").run(teamId);
  db.close();
}

async function waitFor(fn, timeoutMs = 90_000, gapMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, gapMs));
  }
  return null;
}

(async () => {
  const buyer = await login('demo@mall.dev', 'demo123');
  const gb = (await call('/api/group-buys')).data.find((g) => g.required >= 2);
  const product = (await call(`/api/products/${gb.productId}`)).data;

  // ── A 团：未支付，超时应关单 ──
  const stockBeforeA = product.totalStock;
  const teamA = await call('/api/orders/group', {
    method: 'POST', token: buyer,
    body: { groupBuyId: gb.id, address: '北京市朝阳区建国路 88 号 SOHO B 座 1203', idemKey: 'to-a-' + Date.now() },
  });
  check('A 团开团成功', teamA.ok, `团 #${teamA.data?.team?.id}`);
  expireTeam(teamA.data.team.id);

  const closed = await waitFor(async () => {
    const o = await call(`/api/orders/${teamA.data.order.id}`, { token: buyer });
    return o.data?.status === 'cancelled' ? o.data : null;
  });
  check('超时未成团自动关单', !!closed, closed?.cancelReason || '未在 90 秒内关单');
  const stockAfterA = (await call(`/api/products/${gb.productId}`)).data.totalStock;
  check('关单后库存回补', stockAfterA === stockBeforeA, `${stockBeforeA} → ${stockAfterA}`);

  // ── B 团：已付款，超时应自动退款 ──
  const stockBeforeB = (await call(`/api/products/${gb.productId}`)).data.totalStock;
  const teamB = await call('/api/orders/group', {
    method: 'POST', token: buyer,
    body: { groupBuyId: gb.id, address: '北京市朝阳区建国路 88 号 SOHO B 座 1203', idemKey: 'to-b-' + Date.now() },
  });
  check('B 团开团成功', teamB.ok, `团 #${teamB.data?.team?.id}`);
  const paid = await call(`/api/orders/${teamB.data.order.id}/pay`, { method: 'POST', token: buyer });
  check('B 团订单支付成功', paid.ok && paid.data.status === 'paid');

  expireTeam(teamB.data.team.id);
  const refunded = await waitFor(async () => {
    const o = await call(`/api/orders/${teamB.data.order.id}`, { token: buyer });
    return o.data?.status === 'refunded' ? o.data : null;
  });
  check('已付款团失败自动退款', !!refunded, refunded?.statusLabel || '未在 90 秒内退款');
  check('退款记录可查', !!refunded?.refund, refunded?.refund?.amount ? `¥${refunded.refund.amount}` : '无退款单');
  const stockAfterB = (await call(`/api/products/${gb.productId}`)).data.totalStock;
  check('退款后库存回补', stockAfterB === stockBeforeB, `${stockBeforeB} → ${stockAfterB}`);

  console.log(`\n▶ 结果：${pass} 通过 / ${fail} 失败\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('脚本异常:', e); process.exit(1); });
