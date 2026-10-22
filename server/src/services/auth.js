import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../db/index.js';

/**
 * 签名密钥解析顺序：
 * 1. 环境变量 AUTH_SECRET（生产必须显式配置）
 * 2. 本地 data/.auth-secret（首次启动随机生成并持久化，重启后 token 仍有效）
 * 3. 随机临时密钥（目录不可写时兜底，重启会失效）
 * 不再使用写死的默认字符串，避免任何人都能伪造 token。
 */
let cachedKey = '';
function secretKey() {
  if (cachedKey) return cachedKey;
  const fromEnv = (process.env.AUTH_SECRET || '').trim();
  if (fromEnv) { cachedKey = fromEnv; return cachedKey; }

  const file = path.join(DATA_DIR, '.auth-secret');
  try {
    if (fs.existsSync(file)) {
      const saved = fs.readFileSync(file, 'utf8').trim();
      if (saved.length >= 32) { cachedKey = saved; return cachedKey; }
    }
    const generated = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, generated, { mode: 0o600 });
    console.warn(`[auth] 未设置 AUTH_SECRET，已生成本地密钥 ${file}（仅本机演示用，不要提交到版本库）`);
    cachedKey = generated;
    return cachedKey;
  } catch {
    cachedKey = crypto.randomBytes(32).toString('hex');
    console.warn('[auth] 无法持久化密钥，本次进程使用临时密钥，重启后需重新登录');
    return cachedKey;
  }
}


/** scrypt 密码哈希：格式 salt:hash（hex），无外部依赖 */
export function hashPassword(pwd) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pwd, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(pwd, stored) {
  if (typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const calc = crypto.scryptSync(pwd, salt, 32).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(calc, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function signToken(payload, ttlSec = 8 * 3600) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec }));
  const sig = crypto.createHmac('sha256', secretKey()).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expect = crypto.createHmac('sha256', secretKey()).update(`${header}.${body}`).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
