import { all, get, run } from '../db/index.js';
import { AppError } from './users.js';
import { int, str } from '../lib/validate.js';
import { toIso } from '../lib/time.js';

/**
 * AI 转人工：把对话标记为待人工，并落一条工单。
 * 本地演示没有真实客服系统，但至少让"转人工"有明确去向和可处理入口。
 */
export function createTicket({ userId, conversationId, summary, contact = '' }) {
  const text = str(summary, { field: '问题描述', min: 2, max: 300 });
  const phone = str(contact, { field: '联系方式', max: 60, def: '' });
  let convId = null;
  if (conversationId !== undefined && conversationId !== null && conversationId !== '') {
    convId = int(conversationId, { field: '会话 ID', min: 1 });
    const c = get('SELECT * FROM ai_conversations WHERE id = ?', [convId]);
    if (!c) throw new AppError('NOT_FOUND', '会话不存在', 404);
    if (c.user_id !== null && c.user_id !== userId) throw new AppError('FORBIDDEN', '无权操作该会话', 403);
    const open = get("SELECT id FROM support_tickets WHERE conversation_id = ? AND status = 'open'", [convId]);
    if (open) return { id: open.id, duplicate: true, status: 'open' };
  }
  const { lastId } = run(
    'INSERT INTO support_tickets (user_id, conversation_id, summary, contact) VALUES (?,?,?,?)',
    [userId ?? null, convId, text, phone],
  );
  if (convId) run('UPDATE ai_conversations SET handoff = 1 WHERE id = ?', [convId]);
  return { id: lastId, duplicate: false, status: 'open' };
}

export function listTickets({ status = '', page = 1, pageSize = 50 } = {}) {
  const where = [];
  const params = [];
  if (status) { where.push('t.status = ?'); params.push(status); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return all(
    `SELECT t.*, u.name AS user_name, u.email AS user_email
       FROM support_tickets t LEFT JOIN users u ON u.id = t.user_id
       ${clause} ORDER BY (t.status = 'open') DESC, t.id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  ).map((t) => ({
    id: t.id,
    userId: t.user_id,
    userName: t.user_name || '游客',
    userEmail: t.user_email || '',
    conversationId: t.conversation_id,
    summary: t.summary,
    contact: t.contact,
    status: t.status,
    reply: t.reply,
    createdAt: toIso(t.created_at),
    resolvedAt: toIso(t.resolved_at),
  }));
}

export function resolveTicket(id, reply = '') {
  const ticketId = int(id, { field: '工单 ID', min: 1 });
  const t = get('SELECT * FROM support_tickets WHERE id = ?', [ticketId]);
  if (!t) throw new AppError('NOT_FOUND', '工单不存在', 404);
  run("UPDATE support_tickets SET status = 'resolved', reply = ?, resolved_at = datetime('now') WHERE id = ?",
    [String(reply || '').slice(0, 500), ticketId]);
  return { id: ticketId, status: 'resolved' };
}

export function openTicketCount() {
  return get("SELECT COUNT(*) AS c FROM support_tickets WHERE status = 'open'").c;
}
