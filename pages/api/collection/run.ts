import type { NextApiRequest, NextApiResponse } from 'next';
import { hasSameOrigin, hasValidPersonalSession } from '../../../lib/server/personalSession';

// Personal-app action. The worker secret stays server-side; DB due times rate-limit collection.
export default async function handler(req: NextApiRequest,res: NextApiResponse) {
  if(req.method!=='POST') {res.setHeader('Allow','POST');return res.status(405).json({message:'POST 요청이 필요합니다.'});}
  if(!hasSameOrigin(req)) return res.status(403).json({message:'허용되지 않은 요청입니다.'});
  if(!hasValidPersonalSession(req)) return res.status(401).json({message:'로그인이 필요합니다.'});
  const url=process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret=process.env.YOUTUBE_APP_SYNC_SECRET;
  if(!url || !secret) return res.status(503).json({message:'수동 수집 연결이 설정되지 않았습니다. 예약 수집은 Supabase에서 별도로 실행됩니다.'});
  try {
    const response=await fetch(`${url}/functions/v1/youtube-app-sync`,{
      method:'POST',headers:{'x-youtube-sync-secret':secret},signal:AbortSignal.timeout(55000),
    });
    if(!response.ok) return res.status(502).json({message:'수집 작업을 시작하지 못했습니다. 잠시 후 다시 시도하세요.'});
    return res.status(200).json(await response.json());
  } catch {return res.status(504).json({message:'수집 응답 시간이 초과되었습니다. 작업이 계속될 수 있으니 수집 상태를 확인하세요.'});}
}
