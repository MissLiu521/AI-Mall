/**
 * 余额账户：评价返现入账，下单可抵扣。
 *
 * 所有变更都写 wallet_log，余额字段只是流水的物化结果，
 * 对账时可以直接 sum(delta_cents) 校验。
 */
import { get, all, run } from '../db/index.js';
import { AppError } from './users.js';
import { toIso } from '../lib/time.js';

export function balanceOf(userId) {
  const r = get('SELECT balance_cents FROM users WHERE id = ?', [+userId]);
  return Math.max(0, Number(r?.balance_cents) || 0);
}

/** 入账（返现、补偿）。返回入账后余额 */
export function credit(userId, cents, reason, { refType = '', refId = null } = {}) {
  const delta = Math.max(0, Math.floor(Number(cents) || 0));
  if (!delta) return balanceOf(userId);
  return apply(userId, delta, reason, refType, refId);
}

/** 出账（下单抵扣）。余额不足直接抛错，避免出现负余额 */
export function debit(userId, cents, reason, { refType = '', refId = null } = {}) {
  const delta = Math.max(0, Math.floor(Number(cents) || 0));
  if (!delta) return balanceOf(userId);
  const balance = balanceOf(userId);
  if (balance < delta) throw new AppError('INSUFFICIENT_BALANCE', '余额不足', 400);
  return apply(userId, -delta, reason, refType, refId);
}

function apply(userId, delta, reason, refType, refId) {
  const current = balanceOf(userId);
  const next = Math.max(0, current + delta);
  run('UPDATE users SET balance_cents = ? WHERE id = ?', [next, +userId]);
  run(
    `INSERT INTO wallet_log (user_id, delta_cents, balance_cents, reason, ref_type, ref_id)
     VALUES (?,?,?,?,?,?)`,
    [+userId, delta, next, String(reason || '').slice(0, 100), String(refType || ''), refId == null ? null : +refId],
  );
  return next;
}

/** 钱包首页：余额 + 累计返现 + 流水 */
export function wallet(userId, { page = 1, pageSize = 20 } = {}) {
  const balanceCents = balanceOf(userId);
  const totalIn = get(
    'SELECT COALESCE(SUM(delta_cents), 0) s FROM wallet_log WHERE user_id = ? AND delta_cents > 0',
    [+userId],
  ).s;
  const totalOut = get(
    'SELECT COALESCE(-SUM(delta_cents), 0) s FROM wallet_log WHERE user_id = ? AND delta_cents < 0',
    [+userId],
  ).s;
  const total = get('SELECT COUNT(*) c FROM wallet_log WHERE user_id = ?', [+userId]).c;
  const items = all(
    `SELECT * FROM wallet_log WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?`,
    [+userId, pageSize, (page - 1) * pageSize],
  ).map((r) => ({
    id: r.id,
    deltaCents: r.delta_cents,
    delta: +(r.delta_cents / 100).toFixed(2),
    balanceCents: r.balance_cents,
    reason: r.reason,
    refType: r.ref_type,
    refId: r.ref_id,
    createdAt: toIso(r.created_at),
  }));
  return {
    balanceCents,
    balance: +(balanceCents / 100).toFixed(2),
    totalInCents: totalIn,
    totalIn: +(totalIn / 100).toFixed(2),
    totalOut: +(totalOut / 100).toFixed(2),
    items,
    total,
    page,
    pageSize,
  };
}
