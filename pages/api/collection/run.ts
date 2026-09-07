import type { NextApiRequest, NextApiResponse } from 'next';
import { createAdminSupabase } from '../../../lib/server/adminSupabase';
import { hasSameOrigin, hasValidPersonalSession } from '../../../lib/server/personalSession';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function invokeWorker(url:string,secret:string,fullSyncId?:string) {
  const response=await fetch(`${url}/functions/v1/youtube-app-sync`,{
    method:'POST',headers:{'Content-Type':'application/json','x-youtube-sync-secret':secret},
    body:JSON.stringify(fullSyncId?{fullSyncId}:{}),signal:AbortSignal.timeout(55000),
  });
  if(!response.ok) throw new Error('worker_failed');
  return response.json();
}

async function fullSyncStatus(db:ReturnType<typeof createAdminSupabase>,fullSyncId:string) {
  const result=await db.rpc('youtube_app_full_sync_status',{p_full_sync_id:fullSyncId});
  if(result.error || !result.data) throw new Error('status_failed');
  return result.data;
}

// Personal-app action. The worker secret stays server-side; database leases bound concurrency.
export default async function handler(req: NextApiRequest,res: NextApiResponse) {
  if(req.method!=='POST') {res.setHeader('Allow','POST');return res.status(405).json({message:'POST 요청이 필요합니다.'});}
  if(!hasSameOrigin(req)) return res.status(403).json({message:'허용되지 않은 요청입니다.'});
  if(!hasValidPersonalSession(req)) return res.status(401).json({message:'로그인이 필요합니다.'});
  const url=process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret=process.env.YOUTUBE_APP_SYNC_SECRET;
  if(!url || !secret) return res.status(503).json({message:'수동 수집 연결이 설정되지 않았습니다. 예약 수집은 Supabase에서 별도로 실행됩니다.'});
  try {
    const action=req.body?.action || 'due';
    if(action==='startAll') {
      const db=createAdminSupabase();
      const started=await db.rpc('youtube_app_start_full_sync');
      if(started.error || !started.data?.id) throw new Error('start_failed');
      const fullSyncId=started.data.id as string;
      const worker=await invokeWorker(url,secret,fullSyncId);
      return res.status(200).json({fullSyncId,resumed:Boolean(started.data.resumed),results:worker.results || [],status:await fullSyncStatus(db,fullSyncId)});
    }
    if(action==='continueAll' || action==='statusAll') {
      const fullSyncId=String(req.body?.fullSyncId || '');
      if(!uuid.test(fullSyncId)) return res.status(400).json({message:'전체 수집 작업 ID가 올바르지 않습니다.'});
      const db=createAdminSupabase();
      const worker=action==='continueAll'?await invokeWorker(url,secret,fullSyncId):{results:[]};
      return res.status(200).json({fullSyncId,results:worker.results || [],status:await fullSyncStatus(db,fullSyncId)});
    }
    if(action!=='due') return res.status(400).json({message:'지원하지 않는 수집 작업입니다.'});
    return res.status(200).json(await invokeWorker(url,secret));
  } catch(error) {
    console.error('수동 수집 실패:',error instanceof Error?error.message:'unknown');
    return res.status(504).json({message:'수집 요청이 중단되었습니다. 시작된 전체 수집은 자동 크론이 계속 처리합니다.'});
  }
}
