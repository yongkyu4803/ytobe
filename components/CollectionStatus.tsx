import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

type Status = {tracked:number;collected:number;failed:number;lastSuccess:string|null;nextDue:string|null};
export default function CollectionStatus({refreshKey}:{refreshKey:number}) {
  const [status,setStatus]=useState<Status|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{
    let cancelled=false;
    async function refresh() {
      try {
        // Use the favorite relationship so archived/unfollowed channels are excluded.
        const {data,error}=await supabase.from('youtube_app_favorite_channels')
          .select('channel_id,youtube_app_channels(last_success_at,next_sync_at,last_error)');
        if(error) throw error;
        const channels=(data || []).flatMap(row=>{
          const value=row.youtube_app_channels;
          return Array.isArray(value)?value:value?[value]:[];
        });
        const successes=channels.map(c=>c.last_success_at).filter(Boolean).sort();
        const due=channels.map(c=>c.next_sync_at).filter(Boolean).sort();
        if(!cancelled){setStatus({tracked:channels.length,collected:successes.length,failed:channels.filter(c=>c.last_error).length,
          lastSuccess:successes.at(-1)||null,nextDue:due[0]||null});setError('');}
      } catch {if(!cancelled)setError('수집 상태를 불러오지 못했습니다. 잠시 후 자동으로 다시 확인합니다.');}
    }
    void refresh();const interval=setInterval(refresh,30000);
    return()=>{cancelled=true;clearInterval(interval);};
  },[refreshKey]);
  return <div className="alert alert-info mb-4" role="status">
    <div className="d-flex justify-content-between gap-2 flex-wrap">
      <strong>자동 수집 · 최근 30일 영상</strong>
      <span className="small">{status ? `${status.tracked}개 채널 중 ${status.collected}개 수집됨${status.failed ? ` · ${status.failed}개 재시도 대기` : ''}` : '수집 상태 확인 중…'}</span>
    </div>
    {status && <p className="small text-muted mb-0 mt-2">
      {status.lastSuccess ? `최근 수집 ${new Date(status.lastSuccess).toLocaleString('ko-KR')}` : '첫 수집을 기다리고 있습니다.'}
      {' · '}영상 통계는 3시간 단위, 채널 통계는 하루 단위로 기록합니다.
    </p>}
    {error && <p className="small mb-0 mt-2">{error}</p>}
  </div>;
}
