/** 统一入参校验：所有对外接口的数字/字符串都必须经过这里，避免把非法值直接丢给 SQLite */
import { AppError } from '../services/users.js';

const invalid = (field, msg) => new AppError('INVALID', msg || `${field} 不合法`);

/** 解析整数，带上下限；非法输入返回 400，而不是让数据库抛 500 */
export function int(value, { field = '参数', min = -Infinity, max = Infinity, def } = {}) {
  if (value === undefined || value === null || value === '') {
    if (def !== undefined) return def;
    throw invalid(field, `${field} 必填`);
  }
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw invalid(field, `${field} 必须是整数`);
  if (n < min || n > max) throw invalid(field, `${field} 需在 ${min}–${max} 之间`);
  return n;
}

/** 解析字符串，做长度与空值校验 */
export function str(value, { field = '参数', min = 0, max = 500, trim = true, def } = {}) {
  if (value === undefined || value === null) {
    if (def !== undefined) return def;
    if (min > 0) throw invalid(field, `${field} 必填`);
    return '';
  }
  if (typeof value !== 'string') throw invalid(field, `${field} 必须是文本`);
  const s = trim ? value.trim() : value;
  if (s.length < min) throw invalid(field, `${field} 至少 ${min} 个字符`);
  if (s.length > max) throw invalid(field, `${field} 最多 ${max} 个字符`);
  return s;
}

export function oneOf(value, allowed, { field = '参数', def } = {}) {
  if (value === undefined || value === null || value === '') {
    if (def !== undefined) return def;
    throw invalid(field, `${field} 必填`);
  }
  if (!allowed.includes(value)) throw invalid(field, `${field} 取值不合法`);
  return value;
}

/** 统一分页：page 从 1 开始，pageSize 有硬上限，防止一次拉全量 */
export function pageParams(url, { defSize = 20, maxSize = 100 } = {}) {
  const page = int(url.searchParams.get('page') ?? 1, { field: 'page', min: 1, max: 100000, def: 1 });
  const pageSize = int(url.searchParams.get('pageSize') ?? defSize, {
    field: 'pageSize', min: 1, max: maxSize, def: defSize,
  });
  return { page, pageSize, offset: (page - 1) * pageSize };
}
