const {loadEnvConfig}=require('@next/env');loadEnvConfig(process.cwd());
(async()=>{
 const url=process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
 const secret=process.env.YOUTUBE_APP_SYNC_SECRET;
 if(!url||!secret)throw Error('Worker connection is not configured');
 const response=await fetch(url+'/functions/v1/youtube-app-sync',{method:'POST',headers:{'x-youtube-sync-secret':secret},signal:AbortSignal.timeout(120000)});
 const data=await response.json();console.log(JSON.stringify({httpStatus:response.status,...data}));
 if(!response.ok || data.results?.some(r=>r.status==='failed'))process.exitCode=1;
})().catch(()=>{console.error('Worker request failed or timed out. Inspect sync_runs before retrying.');process.exitCode=1;});
