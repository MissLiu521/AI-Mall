import { get, run, all } from '../db/index.js';
import { hashPassword, verifyPassword, signToken } from './auth.js';

export class AppError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export const publicUser = (u) => u && ({ id: u.id, email: u.email, name: u.name, role: u.role, createdAt: u.created_at });

export function register({ email, password, name }) {
  if (!email || typeof email !== 'string' || email.length > 120 || !/^\S+@\S+\.\S+$/.test(email)) {
    throw new AppError('INVALID_EMAIL', '邮箱格式不正确');
  }
  if (!password || typeof password !== 'string' || password.length < 6) throw new AppError('WEAK_PASSWORD', '密码至少 6 位');
  if (password.length > 72) throw new AppError('WEAK_PASSWORD', '密码最多 72 位');
  const nick = String(name || '').trim().slice(0, 30);
  if (get('SELECT id FROM users WHERE email = ?', [email])) throw new AppError('EMAIL_TAKEN', '该邮箱已注册', 409);
  const { lastId } = run('INSERT INTO users (email, password_hash, name, role) VALUES (?,?,?,?)',
    [email, hashPassword(password), nick || email.split('@')[0], 'customer']);
  const u = get('SELECT * FROM users WHERE id = ?', [lastId]);
  return { token: signToken({ sub: u.id, role: u.role }), user: publicUser(u) };
}

export function login({ email, password }) {
  if (typeof email !== 'string' || typeof password !== 'string' || email.length > 120 || password.length > 72) {
    throw new AppError('BAD_CREDENTIALS', '邮箱或密码错误', 401);
  }
  const u = get('SELECT * FROM users WHERE email = ?', [email]);
  if (!u || !verifyPassword(password, u.password_hash)) {
    throw new AppError('BAD_CREDENTIALS', '邮箱或密码错误', 401);
  }
  return { token: signToken({ sub: u.id, role: u.role }), user: publicUser(u) };
}

export function findUser(id) {
  return get('SELECT * FROM users WHERE id = ?', [id]);
}

export function listUsers() {
  return all('SELECT * FROM users ORDER BY id').map(publicUser);
}
