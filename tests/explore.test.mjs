import test from 'node:test';
import assert from 'node:assert/strict';
import {extractKeywords,normalizeKeyword} from '../supabase/functions/_shared/keywords.mjs';
import {topicIds,countryCode} from '../supabase/functions/_shared/channel.mjs';
import {collectChannel} from '../supabase/functions/youtube-app-sync/collector.mjs';
import {runExplore,seedsForDay,BUDGET,channelRow} from '../supabase/functions/youtube-app-explore/explore.mjs';

test('keywords: hashtags, tags, title tokens, stopwords and laughter runs',()=>{
  const k=extractKeywords({title:'강아지가 산책을 처음 해봤어요 ㅋㅋㅋㅋ #댕댕이 #Shorts',description:'#산책 #fyp',tags:['반려견','Dog Walk','123']});
  for(const w of ['댕댕이','산책','반려견','dog walk','ㅋㅋ','강아지가','처음','해봤어요'])assert.ok(k.includes(w),w);
  for(const w of ['shorts','fyp','123','산책을'])assert.ok(!k.includes(w),w);
  assert.equal(normalizeKeyword('고양이'),'고양이');
  assert.equal(normalizeKeyword('a'),null);
  assert.equal(normalizeKeyword('ㅎㅎㅎㅎㅎ'),'ㅎㅎ');
  assert.ok(extractKeywords({title:'영화관에서 본 영화'}).includes('영화관'));
  const t=extractKeywords({title:'고양이가 집사를 무시하는 이유 vs 강아지 가장 웃긴 순간',tags:['하는']});
  for(const w of ['무시하는','이유','vs','가장','순간'])assert.ok(!t.includes(w),w);
  for(const w of ['고양이가','집사','강아지','웃긴','하는'])assert.ok(t.includes(w),w);
  assert.ok(extractKeywords({title:'x '.repeat(10)+Array.from({length:60},(_,i)=>`단어${i}`).join(' ')}).length<=30);
});

test('topics and country normalize; invalid values are dropped',()=>{
  assert.deepEqual(topicIds(['https://en.wikipedia.org/wiki/Lifestyle_(sociology)','https://en.wikipedia.org/wiki/Music_of_Asia','bad',null,
    'https://en.wikipedia.org/wiki/Lifestyle_(sociology)']),['Lifestyle_(sociology)','Music_of_Asia']);
  assert.deepEqual(topicIds(undefined),[]);
  assert.equal(countryCode('kr'),'KR');assert.equal(countryCode('KOR'),null);assert.equal(countryCode(undefined),null);
});

test('favorite collector now captures country, topics, tags and keywords',async()=>{
  const time='2026-11-01T00:00:00Z';
  const yt={async get(resource,params){
    if(resource==='channels'){assert.match(params.part,/topicDetails/);
      return {items:[{id:'c',snippet:{title:'채널',country:'kr'},statistics:{viewCount:'1'},contentDetails:{relatedPlaylists:{uploads:'u'}},
        topicDetails:{topicCategories:['https://en.wikipedia.org/wiki/Food']}}]};}
    if(resource==='playlistItems')return {items:[{contentDetails:{videoId:'v',videoPublishedAt:time}}]};
    return {items:[{id:'v',snippet:{channelId:'c',title:'라면 #먹방',publishedAt:time,tags:['라면']},statistics:{viewCount:'5'},contentDetails:{duration:'PT30S'}}]};
  }};
  const {channel,videos}=await collectChannel('c',time,yt);
  assert.equal(channel.country,'KR');assert.deepEqual(channel.topic_ids,['Food']);
  assert.deepEqual(videos[0].tags,['라면']);assert.ok(videos[0].keywords.includes('먹방'));
});

test('seed rotation covers each region and changes daily',()=>{
  const a=seedsForDay(0),b=seedsForDay(1);
  assert.equal(a.length,BUDGET.searchCallsPerDay);
  assert.deepEqual([...new Set(a.map(s=>s.region.code))],['KR','US','JP']);
  assert.notDeepEqual(a.map(s=>s.q),b.map(s=>s.q));
});

test('hidden subscribers stay null, not zero',()=>{
  const row=channelRow({id:'UCxxxxxxxxxxxxxxxxxxxxxx',snippet:{title:'t'},statistics:{hiddenSubscriberCount:true,viewCount:'0',videoCount:'3'}});
  assert.equal(row.subscriber_count,null);assert.equal(row.hidden_subscriber,true);assert.equal(row.view_count,'0');
});

function fakeDb(overrides={}){
  const calls=[];
  const db={calls,
    async rpc(name,args){calls.push([name,args]);
      if(name in overrides)return {data:typeof overrides[name]==='function'?overrides[name](args):overrides[name]};
      if(name==='youtube_app_api_units_today')return {data:0};
      if(name==='youtube_app_explore_begin')return {data:'run'};
      return {data:0};},
    from(){return {select(){return {async in(){return {data:overrides.known||[]};}};}};}};
  return db;
}

test('explore skips every job when the daily budget is already spent',async()=>{
  const db=fakeDb({youtube_app_api_units_today:BUDGET.exploreStop});
  let fetched=0;
  const out=await runExplore(db,'k','stats',{fetcher:async()=>{fetched++;return Response.json({items:[]});}});
  assert.equal(out.status,'skipped');assert.equal(fetched,0);
  const end=db.calls.find(c=>c[0]==='youtube_app_explore_end');assert.equal(end[1].p_status,'skipped');
});

test('explore does not start when another run holds the job or quota is paused',async()=>{
  const db=fakeDb({youtube_app_explore_begin:null});
  const out=await runExplore(db,'k','discover',{fetcher:async()=>{throw Error('no call');}});
  assert.equal(out.status,'not_started');
});

test('discover stops paid search near the search budget and still registers chart channels',async()=>{
  const db=fakeDb({youtube_app_api_units_today:BUDGET.searchStop-100,youtube_app_explore_register:a=>a.p_channels.length});
  const resources=[];
  const fetcher=async url=>{const r=url.pathname.split('/').pop();resources.push(r);
    return Response.json({items:[{snippet:{channelId:'UC'+'a'.repeat(22),channelTitle:'A'}}]});};
  const out=await runExplore(db,'k','discover',{fetcher});
  assert.equal(out.status,'success');
  assert.equal(resources.includes('search'),false);
  assert.equal(out.searchSkipped,'budget');
  const reg=db.calls.find(c=>c[0]==='youtube_app_explore_register');assert.equal(reg[1].p_via,'chart');
});

test('quota error fails the run with its code so the day is paused',async()=>{
  const db=fakeDb({youtube_app_explore_claim_stats:[{channel_id:'UC'+'b'.repeat(22)}]});
  const fetcher=async()=>new Response(JSON.stringify({error:{errors:[{reason:'quotaExceeded'}]}}),{status:403});
  const out=await runExplore(db,'k','stats',{fetcher});
  assert.equal(out.status,'failed');assert.equal(out.code,'quotaExceeded');
  const end=db.calls.find(c=>c[0]==='youtube_app_explore_end');assert.equal(end[1].p_error,'quotaExceeded');assert.equal(end[1].p_units,1);
});

test('stats saves rows, reports deleted channels as missing and counts units',async()=>{
  const a='UC'+'a'.repeat(22),b='UC'+'b'.repeat(22);
  const db=fakeDb({youtube_app_explore_claim_stats:[{channel_id:a},{channel_id:b}],youtube_app_explore_save_stats:x=>x.p_channels.length});
  const fetcher=async()=>Response.json({items:[{id:a,snippet:{title:'A',country:'JP'},statistics:{subscriberCount:'5000',viewCount:'9',videoCount:'1'},
    contentDetails:{relatedPlaylists:{uploads:'UU'}},topicDetails:{topicCategories:['https://en.wikipedia.org/wiki/Music']}}]});
  const out=await runExplore(db,'k','stats',{fetcher});
  const save=db.calls.find(c=>c[0]==='youtube_app_explore_save_stats')[1];
  assert.equal(save.p_channels[0].country,'JP');assert.deepEqual(save.p_missing,[b]);assert.equal(out.units,1);
});

test('shorts keeps only new <=180s videos from the scanned channel',async()=>{
  const ch='UC'+'c'.repeat(22),now=Date.parse('2026-11-01T00:00:00Z');
  const db=fakeDb({youtube_app_explore_claim_videos:[],youtube_app_explore_claim_shorts_channels:[{channel_id:ch,uploads_playlist_id:'UU'}],
    known:[{video_id:'known000001'}],youtube_app_explore_save_videos:x=>x.p_videos.length});
  const pub='2026-10-31T00:00:00Z';
  const fetcher=async url=>{
    if(url.pathname.endsWith('playlistItems'))return Response.json({items:['known000001','short000001','long0000001','old00000001'].map((id,i)=>
      ({contentDetails:{videoId:id,videoPublishedAt:i===3?'2026-09-01T00:00:00Z':pub}}))});
    const ids=url.searchParams.get('id').split(',');
    assert.deepEqual(ids,['short000001','long0000001']);
    return Response.json({items:[
      {id:'short000001',snippet:{channelId:ch,title:'짧은 #먹방',publishedAt:pub},statistics:{viewCount:'10'},contentDetails:{duration:'PT59S'}},
      {id:'long0000001',snippet:{channelId:ch,title:'긴 영상',publishedAt:pub},statistics:{viewCount:'10'},contentDetails:{duration:'PT10M'}}]});};
  const out=await runExplore(db,'k','shorts',{fetcher,now});
  const saved=db.calls.find(c=>c[0]==='youtube_app_explore_save_videos')[1].p_videos;
  assert.deepEqual(saved.map(v=>v.video_id),['short000001']);assert.equal(out.newShorts,1);
  assert.deepEqual(db.calls.find(c=>c[0]==='youtube_app_explore_finish_shorts_channels')[1].p_ids,[ch]);
});
