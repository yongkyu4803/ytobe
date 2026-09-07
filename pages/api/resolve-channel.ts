import type { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import { hasSameOrigin, hasValidPersonalSession } from '../../lib/server/personalSession';

const YT = 'https://www.googleapis.com/youtube/v3';
const CHANNEL_ID = /UC[A-Za-z0-9_-]{22}/;
const HANDLE = /^[A-Za-z0-9._-]{3,30}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

type Candidate = {
  channelId: string;
  title: string;
  thumbnail: string | null;
  subscriberCount: string | null;
  handle: string | null;
  description: string;
};

type Plan =
  | { kind: 'id' | 'handle' | 'username' | 'video' | 'search'; value: string };

// channels.list/videos.list cost 1 unit each; search.list costs 100. Only free text falls through to search.
function parseInput(raw: string): Plan {
  const direct = raw.match(CHANNEL_ID);
  if (direct) return { kind: 'id', value: direct[0] };

  let url: URL | null = null;
  if (/^https?:\/\//i.test(raw)) {
    try { url = new URL(raw); } catch { url = null; }
  }
  if (url && /(^|\.)(youtube\.com|youtu\.be)$/i.test(url.hostname)) {
    const seg = url.pathname.split('/').filter(Boolean);
    const v = url.searchParams.get('v');
    if (url.hostname.endsWith('youtu.be') && seg[0] && VIDEO_ID.test(seg[0])) return { kind: 'video', value: seg[0] };
    if (v && VIDEO_ID.test(v)) return { kind: 'video', value: v };
    if (seg[0] === 'shorts' && seg[1] && VIDEO_ID.test(seg[1])) return { kind: 'video', value: seg[1] };
    if (seg[0]?.startsWith('@') && HANDLE.test(seg[0].slice(1))) return { kind: 'handle', value: seg[0].slice(1) };
    if (seg[0] === 'user' && seg[1] && HANDLE.test(seg[1])) return { kind: 'username', value: seg[1] };
    if (seg[0] === 'c' && seg[1] && HANDLE.test(seg[1])) return { kind: 'handle', value: seg[1] };
  }
  if (raw.startsWith('@') && HANDLE.test(raw.slice(1))) return { kind: 'handle', value: raw.slice(1) };
  return { kind: 'search', value: raw };
}

function toCandidates(items: unknown): Candidate[] {
  return (Array.isArray(items) ? items : []).map((item: any) => ({
    channelId: item.id,
    title: item.snippet?.title || '',
    thumbnail: item.snippet?.thumbnails?.default?.url || null,
    subscriberCount: item.statistics?.hiddenSubscriberCount ? null : item.statistics?.subscriberCount ?? null,
    handle: item.snippet?.customUrl || null,
    description: (item.snippet?.description || '').slice(0, 160),
  })).filter((c: Candidate) => CHANNEL_ID.test(c.channelId || ''));
}

async function channels(key: string, params: Record<string, string>) {
  const response = await axios.get(`${YT}/channels`, {
    params: { part: 'snippet,statistics', ...params, key },
    timeout: 12000,
  });
  return toCandidates(response.data.items);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ message: 'POST 요청이 필요합니다.' });
  }
  if (!hasSameOrigin(req)) return res.status(403).json({ message: '허용되지 않은 요청입니다.' });
  if (!hasValidPersonalSession(req)) return res.status(401).json({ message: '로그인이 필요합니다.' });

  const raw = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
  if (!raw || raw.length > 200) return res.status(400).json({ message: '채널 주소, @핸들 또는 채널명을 입력하세요.' });

  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return res.status(503).json({ message: 'YouTube API 키가 설정되지 않았습니다.' });

  const plan = parseInput(raw);
  try {
    if (plan.kind === 'id') {
      return res.status(200).json({ source: 'id', candidates: await channels(key, { id: plan.value }) });
    }
    if (plan.kind === 'video') {
      const video = await axios.get(`${YT}/videos`, {
        params: { part: 'snippet', id: plan.value, key },
        timeout: 12000,
      });
      const channelId = video.data.items?.[0]?.snippet?.channelId;
      if (!channelId) return res.status(404).json({ message: '영상을 찾지 못했습니다.' });
      return res.status(200).json({ source: 'video', candidates: await channels(key, { id: channelId }) });
    }
    if (plan.kind === 'handle' || plan.kind === 'username') {
      const param: Record<string, string> = plan.kind === 'handle'
        ? { forHandle: `@${plan.value}` }
        : { forUsername: plan.value };
      const found = await channels(key, param);
      if (found.length) return res.status(200).json({ source: plan.kind, candidates: found });
      // Legacy /c/ and /user/ names have no direct lookup; fall back to search.
    }

    const search = await axios.get(`${YT}/search`, {
      params: { part: 'snippet', q: plan.value, type: 'channel', maxResults: 5, key },
      timeout: 12000,
    });
    const ids = (search.data.items || [])
      .map((item: any) => item.id?.channelId)
      .filter((id: unknown): id is string => typeof id === 'string' && CHANNEL_ID.test(id));
    if (!ids.length) return res.status(200).json({ source: 'search', candidates: [] });
    return res.status(200).json({ source: 'search', candidates: await channels(key, { id: ids.join(',') }) });
  } catch (error: any) {
    const reason = error.response?.data?.error?.errors?.[0]?.reason;
    if (reason === 'quotaExceeded') return res.status(429).json({ message: 'YouTube API 일일 사용량을 초과했습니다. 내일 다시 시도하세요.' });
    console.error('채널 조회 실패:', JSON.stringify(error.response?.data, null, 2));
    return res.status(502).json({ message: '채널을 조회하지 못했습니다. 잠시 후 다시 시도하세요.' });
  }
}
