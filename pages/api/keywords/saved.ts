import type { NextApiRequest, NextApiResponse } from 'next';
import { createAdminSupabase } from '../../../lib/server/adminSupabase';
import { hasSameOrigin, hasValidPersonalSession } from '../../../lib/server/personalSession';

function keyword(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFC').trim().toLowerCase();
  return normalized.length >= 2 && normalized.length <= 30 ? normalized : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    res.setHeader('Allow', 'POST, DELETE');
    return res.status(405).json({ message: '지원하지 않는 요청입니다.' });
  }
  if (!hasSameOrigin(req)) return res.status(403).json({ message: '허용되지 않은 요청입니다.' });
  if (!hasValidPersonalSession(req)) return res.status(401).json({ message: '로그인이 필요합니다.' });
  const value = keyword(req.body?.keyword);
  if (!value) return res.status(400).json({ message: '키워드는 2~30자여야 합니다.' });
  try {
    const db = createAdminSupabase();
    const result = req.method === 'POST'
      ? await db.from('youtube_app_saved_keywords').upsert({ keyword: value }, { onConflict: 'keyword', ignoreDuplicates: true })
      : await db.from('youtube_app_saved_keywords').delete().eq('keyword', value);
    if (result.error) throw result.error;
    return res.status(200).json({ keyword: value, saved: req.method === 'POST' });
  } catch {
    return res.status(500).json({ message: '키워드를 저장하지 못했습니다.' });
  }
}
