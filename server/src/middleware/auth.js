import { verifyToken } from '../services/auth.js';
import { get } from '../db/index.js';

export function authOptional(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  const payload = verifyToken(token);
  if (!payload) return null;
  const u = get('SELECT * FROM users WHERE id = ?', [payload.sub]);
  if (!u) return null;
  return { id: u.id, role: u.role, name: u.name, email: u.email };
}

export function requireAuth(req) {
  const u = authOptional(req);
  if (!u) {
    const e = new Error('请先登录');
    e.code = 'UNAUTHORIZED';
    e.status = 401;
    throw e;
  }
  return u;
}

export function requireMerchant(req) {
  const u = requireAuth(req);
  if (u.role !== 'merchant') {
    const e = new Error('需要商家权限');
    e.code = 'FORBIDDEN';
    e.status = 403;
    throw e;
  }
  return u;
}
