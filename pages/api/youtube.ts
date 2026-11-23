import type { NextApiRequest, NextApiResponse } from 'next';
import { registerDiscoveredChannels } from '../../lib/server/registerChannels';
import { hasValidPersonalSession } from '../../lib/server/personalSession';
import { cached, enrichVideos, fetchVideos, pick, sendError, sortByViews, ytGet } from '../../lib/server/youtube';

const ORDERS = ['viewCount', 'date', 'relevance', 'rating'] as const;
// YouTube buckets: short < 4min, medium 4–20min, long > 20min.
const DURATIONS = ['any', 'short', 'medium', 'long'] as const;
const CACHE_TTL_MS = 15 * 60 * 1000;

function intParam(value: unknown, fallback: number, min: number, max: number) {
  const n = Number(value);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ message: 'GET 요청이 필요합니다.' });
  }
  // search.list costs 100 of the 10,000 daily units; never expose it unauthenticated.
  if (!hasValidPersonalSession(req)) return res.status(401).json({ message: '로그인이 필요합니다.' });

  const query = typeof req.query.query === 'string' ? req.query.query.normalize('NFC').trim() : '';
  if (!query) return res.status(400).json({ message: '검색어를 입력해주세요.' });
  if (query.length > 100) return res.status(400).json({ message: '검색어는 100자 이하여야 합니다.' });

  const publishedAfterRaw = typeof req.query.publishedAfter === 'string' ? req.query.publishedAfter : '';
  if (publishedAfterRaw && !Number.isFinite(Date.parse(publishedAfterRaw))) {
    return res.status(400).json({ message: '올바른 날짜가 필요합니다.' });
  }
  // Round to the minute so repeated searches share a cache entry.
  const publishedAfter = publishedAfterRaw
    ? new Date(Math.floor(Date.parse(publishedAfterRaw) / 60000) * 60000).toISOString()
    : undefined;
  const order = pick(req.query.order, ORDERS, 'viewCount');
  const videoDuration = pick(req.query.duration, DURATIONS, 'any');
  const maxResults = intParam(req.query.maxResults, 50, 1, 50);
  const regionCode = typeof req.query.regionCode === 'string' && /^[A-Z]{2}$/.test(req.query.regionCode) ? req.query.regionCode : 'KR';
  const relevanceLanguage = typeof req.query.lang === 'string' && /^[a-z]{2}$/.test(req.query.lang) ? req.query.lang : 'ko';

  const cacheKey = JSON.stringify(['search', query, publishedAfter, order, videoDuration, maxResults, regionCode, relevanceLanguage]);
  try {
    const { value, hit } = await cached(cacheKey, CACHE_TTL_MS, async () => {
      const search = await ytGet<{ items?: any[] }>('search', {
        part: 'snippet', q: query, type: 'video', order, maxResults, regionCode, relevanceLanguage,
        publishedAfter, videoDuration: videoDuration === 'any' ? undefined : videoDuration,
      });
      const ids = (search.items || []).map(item => item.id?.videoId).filter((id): id is string => typeof id === 'string');
      if (!ids.length) return [];
      // Live and scheduled streams have no meaningful view/duration stats yet.
      const videos = (await fetchVideos(ids)).filter(v => (v.snippet?.liveBroadcastContent || 'none') === 'none');
      const items = await enrichVideos(videos);
      await registerDiscoveredChannels(videos);
      return order === 'viewCount' ? sortByViews(items) : items;
    });
    res.setHeader('X-Cache', hit ? 'HIT' : 'MISS');
    return res.status(200).json({ items: value, cached: hit });
  } catch (error) {
    return sendError(res, error, '검색 중 서버 오류가 발생했습니다.');
  }
}
