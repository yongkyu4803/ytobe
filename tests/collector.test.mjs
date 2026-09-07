import test from 'node:test';
import assert from 'node:assert/strict';
import {metric,durationSeconds,collectChannel,runCollection,youtubeClient} from '../supabase/functions/youtube-app-sync/collector.mjs';
const time='2026-09-07T00:00:00Z';
const channel={id:'channel',snippet:{title:'채널'},statistics:{hiddenSubscriberCount:true,viewCount:'0'},contentDetails:{relatedPlaylists:{uploads:'uploads'}}};
const video={id:'video',snippet:{channelId:'channel',title:'영상',publishedAt:time},statistics:{viewCount:'0'},contentDetails:{duration:'PT2M'}};
test('counts preserve null, zero and BIGINT; invalid values fail',()=>{
 assert.equal(metric(undefined),null);assert.equal(metric(null),null);assert.equal(metric('0'),'0');
 assert.equal(metric('9223372036854775807'),'9223372036854775807');
 for(const v of ['','-1','1.2','NaN','9223372036854775808',0])assert.throws(()=>metric(v));
 assert.equal(durationSeconds('PT2M'),120);assert.equal(durationSeconds(null),null);
});
test('uploads pagination deduplicates IDs and preserves hidden counts',async()=>{
 let pages=0;let requested='';
 const yt={async get(resource,params){if(resource==='channels')return {items:[channel]};
 if(resource==='playlistItems'){pages++;return {items:[{contentDetails:{videoId:'video',videoPublishedAt:time}}],...(pages===1?{nextPageToken:'next'}:{})};}
 requested=params.id;return {items:[video]};}};
 const data=await collectChannel('channel',time,yt);
 assert.equal(pages,2);assert.equal(requested,'video');assert.equal(data.channel.subscriber_count,null);
 assert.equal(data.videos[0].view_count,'0');assert.equal(data.videos[0].like_count,null);
});
test('pagination cap fails instead of accepting incomplete scan',async()=>{
 const yt={async get(resource){return resource==='channels'?{items:[channel]}:{items:[],nextPageToken:'more'};}};
 await assert.rejects(collectChannel('channel',time,yt),{code:'pagination_limit'});
});
test('worker records failed quota request without success commit',async()=>{
 const calls=[];const db={async rpc(name,args){calls.push([name,args]);return name.endsWith('claim_sync')?{data:[{channel_id:'channel',run_id:'run',started_at:time}]}:{data:null};}};
 const fetcher=async()=>new Response(JSON.stringify({error:{errors:[{reason:'quotaExceeded'}]}}),{status:403});
 const out=await runCollection(db,'test',{fetcher});
 assert.equal(out[0].code,'quotaExceeded');assert.equal(calls.length,2);assert.ok(calls[1][0].endsWith('fail_sync'));
 assert.equal(calls[1][1].p_requests,1);
});
test('database commit error never becomes success',async()=>{
 const calls=[];const db={async rpc(name){calls.push(name);if(name.endsWith('claim_sync'))return {data:[{channel_id:'channel',run_id:'run',started_at:time}]};
 return name.endsWith('finish_sync')?{error:{message:'private detail'}}:{};}};
 const fetcher=async url=>Response.json({items:url.pathname.endsWith('channels')?[channel]:[]});
 const out=await runCollection(db,'test',{fetcher});assert.equal(out[0].code,'storage_failed');assert.ok(calls.at(-1).endsWith('fail_sync'));
});
test('worker recovers success when the commit response is lost',async()=>{
 const calls=[];const db={async rpc(name){calls.push(name);if(name.endsWith('claim_sync'))return {data:[{channel_id:'channel',run_id:'run',started_at:time}]};
  if(name.endsWith('finish_sync'))return {error:{message:'response lost'}};
  if(name.endsWith('sync_result'))return {data:{status:'success',videos:0,notifications:0}};
  return {};}};
 const fetcher=async url=>Response.json({items:url.pathname.endsWith('channels')?[channel]:[]});
 const out=await runCollection(db,'test',{fetcher});assert.equal(out[0].status,'success');assert.equal(out[0].recovered,true);
 assert.equal(calls.some(name=>name.endsWith('fail_sync')),false);
});
test('transport errors do not expose API key',async()=>{
 const yt=youtubeClient('private-api-key',async()=>{throw Error('url with private-api-key');});
 await assert.rejects(yt.get('channels',{}),e=>!e.message.includes('private-api-key')&&e.code==='network_timeout');
});
