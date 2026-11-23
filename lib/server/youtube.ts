// Server-only YouTube Data API v3 helpers shared by the pages/api routes.
// The Edge Function collectors use supabase/functions/_shared/youtube.mjs (Deno runtime).
import axios from 'axios';
import { isShortsVideo } from '../../utils/shorts';

const BASE_URL = 'https://www.googleapis.com/youtube/v3';
const TIMEOUT_MS = 12000;
const QUOTA_REASONS = new Set(['quotaExceeded', 'dailyLimitExceeded', 'rateLimitExceeded']);

export class YouTubeApiError extends Error {
  constructor(public status: number, public reason: string, message: string) {
    super(message);
  }
}

export function apiKey(): string {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new YouTubeApiError(500, 'missing_api_key', 'API 키가 설정되지 않았습니다.');
  return key;
}

export async function ytGet<T = any>(resource: string, params: Record<string, string | number | undefined>): Promise<T> {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') clean[k] = String(v);
  try {
    const res = await axios.get(`${BASE_URL}/${resource}`, { params: { ...clean, key: apiKey() }, timeout: TIMEOUT_MS });
    return res.data as T;
  } catch (error: any) {
    if (error instanceof YouTubeApiError) throw error;
    const apiError = error.response?.data?.error;
    const reason: string = apiError?.errors?.[0]?.reason || (error.code === 'ECONNABORTED' ? 'timeout' : 'youtube_error');
    if (QUOTA_REASONS.has(reason)) {
      throw new YouTubeApiError(429, reason, '오늘 YouTube API 무료 할당량을 모두 사용했습니다. 한국 시간 오후 4~5시(태평양 자정) 이후 다시 시도하세요.');
    }
    if (reason === 'timeout') throw new YouTubeApiError(504, reason, 'YouTube 응답이 늦어 요청을 중단했습니다.');
    const status = error.response?.status === 404 ? 404 : 502;
    throw new YouTubeApiError(status, reason, apiError?.message || 'YouTube API 요청에 실패했습니다.');
  }
}

/** ISO 8601 duration (PT1H2M3S, P1DT2H) → seconds. Returns null when unparseable (e.g. upcoming live "P0D"). */
export function parseDuration(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value);
  if (!m) return null;
  return Number(m[1] || 0) * 86400 + Number(m[2] || 0) * 3600 + Number(m[3] || 0) * 60 + Number(m[4] || 0);
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// `player` is free (videos.list is 1 unit whatever the parts) and, with maxWidth, its embed size
// reveals vertical videos — the only reliable Shorts signal the API offers.
export const VIDEO_PARTS = 'snippet,statistics,contentDetails,player';
export const PLAYER_MAX_WIDTH = 200;

/** Fetches full video resources (snippet, statistics, contentDetails) for up to any number of ids. */
export async function fetchVideos(ids: string[]): Promise<any[]> {
  const out: any[] = [];
  for (const part of chunk([...new Set(ids)], 50)) {
    const data = await ytGet<{ items?: any[] }>('videos', { part: VIDEO_PARTS, id: part.join(','), maxResults: 50, maxWidth: PLAYER_MAX_WIDTH });
    out.push(...(data.items || []));
  }
  // Keep the caller's order (search relevance/date order).
  const index = new Map(ids.map((id, i) => [id, i]));
  return out.sort((a, b) => (index.get(a.id) ?? 0) - (index.get(b.id) ?? 0));
}

/** Adds channelStatistics, durationInSeconds and isShorts to raw video resources. */
export async function enrichVideos(videos: any[]) {
  const channelIds = [...new Set(videos.map(v => v.snippet?.channelId).filter(Boolean))] as string[];
  const stats = new Map<string, any>();
  for (const part of chunk(channelIds, 50)) {
    const data = await ytGet<{ items?: any[] }>('channels', { part: 'statistics', id: part.join(','), maxResults: 50 });
    for (const item of data.items || []) stats.set(item.id, item.statistics);
  }
  return videos.map(({ player, ...video }) => {
    const durationInSeconds = parseDuration(video.contentDetails?.duration);
    const channelStatistics = stats.get(video.snippet?.channelId);
    return {
      ...video,
      statistics: video.statistics || {},
      channelStatistics: channelStatistics && !channelStatistics.hiddenSubscriberCount
        ? channelStatistics
        : { ...(channelStatistics || {}), subscriberCount: null },
      durationInSeconds,
      isShorts: isShortsVideo(durationInSeconds, player?.embedWidth, player?.embedHeight) === true,
    };
  });
}

export function sortByViews<T extends { statistics?: { viewCount?: string } }>(videos: T[]): T[] {
  const views = (v: T) => Number(v.statistics?.viewCount ?? -1);
  return [...videos].sort((a, b) => views(b) - views(a));
}

// Small per-instance cache so repeated searches don't burn 100 units each.
const cache = new Map<string, { expires: number; value: unknown }>();
const CACHE_MAX = 200;

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<{ value: T; hit: boolean }> {
  const now = Date.now();
  const entry = cache.get(key);
  if (entry && entry.expires > now) return { value: entry.value as T, hit: true };
  const value = await load();
  cache.set(key, { expires: now + ttlMs, value });
  if (cache.size > CACHE_MAX) {
    for (const [k, e] of cache) if (e.expires <= now || cache.size > CACHE_MAX) cache.delete(k);
  }
  return { value, hit: false };
}

export function sendError(res: { status: (code: number) => { json: (body: unknown) => void } }, error: unknown, fallback: string) {
  if (error instanceof YouTubeApiError) {
    if (error.status >= 500) console.error('YouTube API error:', error.reason);
    return res.status(error.status).json({ message: error.message, reason: error.reason });
  }
  console.error(fallback, error instanceof Error ? error.message : error);
  return res.status(500).json({ message: fallback });
}

export function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}
