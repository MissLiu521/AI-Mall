/**
 * 进程内固定窗口限流：本地演示足够，无需 Redis。
 * 注意：只对单实例有效；多实例部署需换成共享存储。
 */
import { AppError } from '../services/users.js';

const buckets = new Map();

export function createLimiter({ windowMs = 60_000, max = 60, message = '操作过于频繁，请稍后再试' } = {}) {
  return function hit(key) {
    const now = Date.now();
    const id = String(key || 'unknown');
    let b = buckets.get(id);
    if (!b || now >= b.resetAt) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(id, b);
    }
    b.count += 1;
    if (b.count > max) {
      const retry = Math.ceil((b.resetAt - now) / 1000);
      throw new AppError('RATE_LIMITED', `${message}（${retry}s 后重试）`, 429);
    }
    return b;
  };
}

/** 定期清理过期窗口，避免长期运行内存缓慢增长 */
export function startLimiterCleanup(intervalMs = 5 * 60_000) {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) if (now >= b.resetAt) buckets.delete(k);
  }, intervalMs);
  timer.unref?.();
  return timer;
}

export const clientIp = (req) =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
