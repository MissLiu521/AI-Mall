/** 统一时间展示：后端返回 ISO(UTC)，这里按浏览器本地时区渲染 */
export function formatTime(value?: string | null, { seconds = false } = {}): string {
  if (!value) return '';
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return value;
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  const base = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  return seconds ? `${base}:${p(d.getSeconds())}` : base;
}

export function formatDay(value?: string | null): string {
  const full = formatTime(value);
  return full ? full.slice(0, 10) : '';
}
