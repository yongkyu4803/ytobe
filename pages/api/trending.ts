import type { NextApiRequest, NextApiResponse } from 'next';
import { registerDiscoveredChannels } from '../../lib/server/registerChannels';
import { hasValidPersonalSession } from '../../lib/server/personalSession';
import { cached, enrichVideos, PLAYER_MAX_WIDTH, sendError, VIDEO_PARTS, ytGet } from '../../lib/server/youtube';

// The mostPopular chart changes slowly; 30 minutes keeps repeated clicks free.
const CACHE_TTL_MS = 30 * 60 * 1000;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ message: 'GET 요청이 필요합니다.' });
  }
  if (!hasValidPersonalSession(req)) return res.status(401).json({ message: '로그인이 필요합니다.' });

  const category = typeof req.query.category === 'string' ? req.query.category : 'all';
  if (category !== 'all' && !/^\d{1,3}$/.test(category)) return res.status(400).json({ message: '올바른 카테고리가 필요합니다.' });
  const regionCode = typeof req.query.regionCode === 'string' && /^[A-Z]{2}$/.test(req.query.regionCode) ? req.query.regionCode : 'KR';
  const maxResults = Math.min(50, Math.max(1, Number(req.query.maxResults) || 50));

  try {
    const { value, hit } = await cached(JSON.stringify(['chart', category, regionCode, maxResults]), CACHE_TTL_MS, async () => {
      const data = await ytGet<{ items?: any[] }>('videos', {
        part: VIDEO_PARTS, chart: 'mostPopular', regionCode, maxResults, hl: 'ko', maxWidth: PLAYER_MAX_WIDTH,
        videoCategoryId: category === 'all' ? undefined : category,
      });
      const videos = data.items || [];
      const items = await enrichVideos(videos);
      await registerDiscoveredChannels(videos);
      // Keep YouTube's chart order (popularity rank), not a pure view-count sort.
      return items.map((item, index) => ({ ...item, chartRank: index + 1 }));
    });
    res.setHeader('X-Cache', hit ? 'HIT' : 'MISS');
    return res.status(200).json({ items: value, cached: hit });
  } catch (error: any) {
    // Some categories (e.g. 19 여행, 27 교육 in KR) have no chart: the API answers 404 notFound.
    if (error?.status === 404 || error?.reason === 'videoChartNotFound' || error?.reason === 'notFound') {
      return res.status(200).json({ items: [], unavailable: true, message: '이 지역에서는 해당 카테고리 인기 차트를 제공하지 않습니다.' });
    }
    return sendError(res, error, '인기 동영상을 불러오는 데 실패했습니다.');
  }
}
