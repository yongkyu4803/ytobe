import { toCount } from './shorts';

export interface RatedMetric {
  /** null when it cannot be computed (hidden or missing counts); never 0 as a stand-in. */
  value: number | null;
  level: string;
  color: string;
}

const UNKNOWN: RatedMetric = { value: null, level: '정보없음', color: 'text-muted' };

function rate(value: number, steps: [number, string, string][]): RatedMetric {
  for (const [min, level, color] of steps) if (value >= min) return { value, level, color };
  return { value, level: '낮음', color: 'text-danger' };
}

/** Views per subscriber ("성과지표"). Hidden or zero subscribers → unknown. */
export function viewSubscriberRatio(viewCount: unknown, subscriberCount: unknown): RatedMetric {
  const views = toCount(viewCount), subs = toCount(subscriberCount);
  if (views === null || !subs) return UNKNOWN;
  return rate(views / subs, [[5, '매우 높음', 'text-success'], [2, '높음', 'text-primary'], [0.5, '보통', 'text-warning']]);
}

/**
 * Engagement rate in percent: (likes + comments) / views × 100. Hidden likes → unknown;
 * disabled comments count as 0. Same definition the smart recommendations use.
 */
export function engagementRate(viewCount: unknown, likeCount: unknown, commentCount: unknown): RatedMetric {
  const views = toCount(viewCount), likes = toCount(likeCount);
  if (!views || likes === null) return UNKNOWN;
  const value = ((likes + (toCount(commentCount) ?? 0)) / views) * 100;
  return rate(value, [[8, '매우 높음', 'text-success'], [4, '높음', 'text-primary'], [2, '보통', 'text-warning']]);
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '–';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}
