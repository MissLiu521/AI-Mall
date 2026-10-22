/**
 * 时间统一出口：数据库里存 UTC（SQLite datetime('now')），API 输出 ISO 8601（带 Z），
 * 由前端按本地时区渲染。避免中国用户看到的时间比实际早 8 小时。
 */
export function toIso(value) {
  if (!value) return null;
  const s = String(value).trim();
  // 兼容种子数据里的相对偏移：-8 days / +3 hours
  const rel = s.match(/^([+-]?\d+(?:\.\d+)?)\s*(day|days|hour|hours|minute|minutes)$/i);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2].toLowerCase();
    const ms = unit.startsWith('day') ? n * 86400000 : unit.startsWith('hour') ? n * 3600000 : n * 60000;
    return new Date(Date.now() + ms).toISOString();
  }
  if (s.includes('T')) {
    const t = Date.parse(s);
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }
  // "YYYY-MM-DD HH:MM:SS" 是 SQLite 的 UTC 格式
  const t = Date.parse(s.replace(' ', 'T') + 'Z');
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** 距今整日数，用于售后时效 */
export function daysSince(value) {
  const iso = toIso(value);
  if (!iso) return null;
  return Math.floor((Date.now() - Date.parse(iso)) / 86400000);
}
