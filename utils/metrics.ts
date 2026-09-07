/** Never render missing/invalid measurements as measured zero. */
export function formatMetric(value: unknown): string {
  if (value === null || value === undefined || value === '') return '수집 안 됨';
  const raw = String(value);
  if (!/^\d+$/.test(raw)) return '확인 필요';
  const num = Number(raw);
  if (!Number.isSafeInteger(num) || num < 0) return '확인 필요';
  if (num >= 100000000) return `${(num / 100000000).toFixed(1).replace(/\.0$/, '')}억`;
  if (num >= 10000) return `${Math.floor(num / 10000)}만`;
  return new Intl.NumberFormat('ko-KR').format(num);
}
export function metricText(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^\d+$/.test(String(value))) throw new Error('올바르지 않은 통계 값입니다.');
  return String(value);
}
