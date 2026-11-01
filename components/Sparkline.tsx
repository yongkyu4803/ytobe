import { formatMetric } from '../utils/metrics';

export interface SeriesPoint { day: string; gain: number | string }

function shortDay(day: string) { const [, m, d] = day.split('-'); return `${Number(m)}/${Number(d)}`; }

/** Daily keyword consumption over the last 14 days; missing days are gaps, not zero. */
export default function Sparkline({ series }: { series: SeriesPoint[] | null }) {
  const points = (series || []).map(p => ({ day: p.day, gain: Number(p.gain) })).filter(p => Number.isFinite(p.gain));
  if (points.length < 2) return <span style={{ color: 'var(--gqai-ink-mute)', fontSize: 12 }}>{points.length ? '이력 1일' : '이력 없음'}</span>;
  const width = 220, height = 48, pad = 4;
  const start = Date.parse(points[0].day), end = Date.parse(points[points.length - 1].day);
  const span = Math.max(end - start, 1);
  const max = Math.max(...points.map(p => p.gain)), min = Math.min(...points.map(p => p.gain));
  const x = (day: string) => pad + ((Date.parse(day) - start) / span) * (width - pad * 2);
  const y = (gain: number) => height - pad - ((gain - min) / Math.max(max - min, 1)) * (height - pad * 2);
  // Break the line where a day is missing.
  const segments: string[] = [];
  let current = '';
  points.forEach((p, i) => {
    const gap = i > 0 && Date.parse(p.day) - Date.parse(points[i - 1].day) > 86400000 * 1.5;
    current = gap || i === 0 ? `${current ? current + ' ' : ''}M${x(p.day).toFixed(1)},${y(p.gain).toFixed(1)}` : `${current} L${x(p.day).toFixed(1)},${y(p.gain).toFixed(1)}`;
  });
  segments.push(current);
  const first = points[0], last = points[points.length - 1];
  const change = first.gain > 0 ? ((last.gain - first.gain) / first.gain) * 100 : null;
  return (
    <figure className="spark">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${shortDay(first.day)} ${formatMetric(String(first.gain))}회에서 ${shortDay(last.day)} ${formatMetric(String(last.gain))}회`}>
        <path d={segments.join(' ')} fill="none" stroke="var(--spark-color)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(last.day)} cy={y(last.gain)} r="3" fill="var(--gqai-canvas)" stroke="var(--spark-color)" strokeWidth="2" />
      </svg>
      <figcaption>
        <span>{shortDay(first.day)}<br /><b>{formatMetric(String(first.gain))}</b></span>
        {change !== null && <em className={change >= 0 ? 'up' : 'down'}>{change >= 0 ? '▲' : '▼'}{Math.abs(change).toFixed(1)}%</em>}
        <span className="end">{shortDay(last.day)}<br /><b>{formatMetric(String(last.gain))}</b></span>
      </figcaption>
      <style jsx>{`
        .spark { --spark-color: #e5484d; width: 220px; margin: 0; }
        svg { display: block; width: 100%; height: 48px; }
        figcaption { display: flex; justify-content: space-between; align-items: end; margin-top: 2px; color: var(--gqai-ink-mute); font-size: 11px; line-height: 1.3; }
        b { color: var(--gqai-ink); font-weight: 600; }
        .end { text-align: right; }
        em { font-style: normal; padding: 1px 4px; border-radius: 4px; font-size: 10px; }
        em.up { color: #b42318; background: #fef3f2; }
        em.down { color: #175cd3; background: #eff8ff; }
      `}</style>
    </figure>
  );
}
