// Manually run one explore job: node scripts/run-explore.cjs discover|stats|shorts
const {loadEnvConfig}=require('@next/env');loadEnvConfig(process.cwd());
const job=process.argv[2];
(async()=>{
 if(!['discover','stats','shorts'].includes(job))throw Error('Usage: npm run explore -- discover|stats|shorts');
 const url=process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
 const secret=process.env.YOUTUBE_APP_SYNC_SECRET;
 if(!url||!secret)throw Error('Worker connection is not configured');
 const response=await fetch(url+'/functions/v1/youtube-app-explore',{method:'POST',headers:{'x-youtube-sync-secret':secret,'Content-Type':'application/json'},
  body:JSON.stringify({job}),signal:AbortSignal.timeout(160000)});
 const data=await response.json();console.log(JSON.stringify({httpStatus:response.status,...data}));
 if(!response.ok || data.status==='failed')process.exitCode=1;
})().catch(e=>{console.error(e.message.startsWith('Usage')?e.message:'Explore request failed or timed out. Inspect youtube_app_explore_runs before retrying.');process.exitCode=1;});
