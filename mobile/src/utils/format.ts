/** 小程序/H5 共用的时间格式化：不使用 Intl，避免低版本基础库不一致 */
export function formatTime(value?: string | null): string {
  if (!value) return '';
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return String(value);
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
