// Explore collector: channel pool discovery, daily channel stats, KR Shorts tracking.
// Shared by the Edge Function and offline tests; all external IO is injected.
import {metric,durationSeconds,youtubeClient,CollectionError} from '../_shared/youtube.mjs';
import {topicIds,countryCode,videoTags} from '../_shared/channel.mjs';
import {extractKeywords} from '../_shared/keywords.mjs';

// Daily quota budget (10,000 units; web search/trending calls are not logged and need headroom).
export const BUDGET = {
  searchStop: 4500,  // stop paid channel search (100 units/call) once collectors reach this
  exploreStop: 6000, // stop every explore job once collectors reach this
  searchCallsPerDay: 10,
};
export const POOL_CAP = 20000;
export const MIN_SUBSCRIBERS = 1000;
export const SHORTS_POOL = 800;
export const MAX_SHORT_SECONDS = 180;
const QUOTA_CODES = new Set(['quotaExceeded','dailyLimitExceeded','rateLimitExceeded']);

export const REGIONS = [
  {code:'KR', lang:'ko', searchesPerDay:6},
  {code:'US', lang:'en', searchesPerDay:2},
  {code:'JP', lang:'ja', searchesPerDay:2},
];
export const CHART_CATEGORIES = ['1','2','10','15','17','19','20','22','23','24','25','26','27','28'];
export const SEEDS = {
  KR:['브이로그','먹방','요리','게임','리뷰','뷰티','메이크업','패션','여행','운동','헬스','축구','야구','음악','커버곡','댄스',
    '코미디','예능','드라마 리뷰','영화 리뷰','애니','반려동물','강아지','고양이','자동차','테크','IT','경제','주식','부동산',
    '공부','과학','역사','뉴스','정치','육아','캠핑','낚시','골프','인테리어','쇼핑','교육','종교','농구','e스포츠','상황극'],
  US:['vlog','cooking','gaming','review','beauty','fashion','travel','fitness','football','basketball','music','dance',
    'comedy','movies','anime','pets','cars','tech','finance','science','history','news','education','diy','podcast'],
  JP:['ブイログ','料理','ゲーム','レビュー','メイク','ファッション','旅行','筋トレ','サッカー','野球','音楽','ダンス',
    'お笑い','映画','アニメ','ペット','猫','車','ガジェット','経済','科学','歴史','ニュース','教育','釣り'],
};

/** Deterministic rotation: each day takes the next seeds for each region. */
export function seedsForDay(dayIndex) {
  const picks = [];
  for (const region of REGIONS) {
    const list = SEEDS[region.code];
    for (let i = 0; i < region.searchesPerDay; i++) {
      picks.push({region, q:list[(dayIndex*region.searchesPerDay + i) % list.length]});
    }
  }
  return picks;
}

function meteredClient(apiKey, fetcher) {
  const yt = youtubeClient(apiKey, fetcher);
  let units = 0;
  return {
    get units() { return units; },
    async get(resource, params) { units += resource === 'search' ? 100 : 1; return yt.get(resource, params); },
  };
}

function isQuotaError(error) { return error instanceof CollectionError && QUOTA_CODES.has(error.code); }
function chunk(list, size) { const out = []; for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size)); return out; }
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length); let next = 0;
  await Promise.all(Array.from({length:Math.min(limit, items.length)}, async () => {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i], i); }
  }));
  return results;
}
async function rpc(db, name, args) {
  const result = await db.rpc(name, args);
  if (result.error) throw new CollectionError('storage_failed', `Database call failed: ${name}`);
  return result.data;
}
function thumb(snippet) { return snippet?.thumbnails?.medium?.url || snippet?.thumbnails?.default?.url || null; }

export function channelRow(raw) {
  const hidden = !!raw.statistics?.hiddenSubscriberCount;
  return {
    channel_id:raw.id, title:raw.snippet?.title || raw.id, thumbnail_url:thumb(raw.snippet),
    uploads_playlist_id:raw.contentDetails?.relatedPlaylists?.uploads || null,
    subscriber_count:hidden ? null : metric(raw.statistics?.subscriberCount),
    view_count:metric(raw.statistics?.viewCount), video_count:metric(raw.statistics?.videoCount),
    hidden_subscriber:hidden, country:countryCode(raw.snippet?.country), topic_ids:topicIds(raw.topicDetails?.topicCategories),
  };
}

export function videoRow(v) {
  if (!v?.id || !v.snippet?.channelId || !Number.isFinite(Date.parse(v.snippet.publishedAt))) return null;
  return {
    video_id:v.id, channel_id:v.snippet.channelId, title:v.snippet.title || '', published_at:v.snippet.publishedAt,
    thumbnail_url:thumb(v.snippet), duration_seconds:durationSeconds(v.contentDetails?.duration),
    view_count:metric(v.statistics?.viewCount), like_count:metric(v.statistics?.likeCount), comment_count:metric(v.statistics?.commentCount),
    tags:videoTags(v.snippet.tags),
    keywords:extractKeywords({title:v.snippet.title, description:v.snippet.description, tags:v.snippet.tags}),
  };
}

async function discover(db, yt, ctx) {
  const chart = new Map();
  let categoriesSkipped = 0;
  for (const region of REGIONS) {
    let pageToken;
    for (let page = 0; page < 4; page++) {
      const res = await yt.get('videos', {part:'snippet', chart:'mostPopular', regionCode:region.code, maxResults:'50', ...(pageToken ? {pageToken} : {})});
      for (const v of res.items) if (v.snippet?.channelId) chart.set(v.snippet.channelId, {channel_id:v.snippet.channelId, title:v.snippet.channelTitle, thumbnail_url:null});
      pageToken = res.nextPageToken; if (!pageToken) break;
    }
    for (const category of CHART_CATEGORIES) {
      try {
        const res = await yt.get('videos', {part:'snippet', chart:'mostPopular', regionCode:region.code, videoCategoryId:category, maxResults:'50'});
        for (const v of res.items) if (v.snippet?.channelId) chart.set(v.snippet.channelId, {channel_id:v.snippet.channelId, title:v.snippet.channelTitle, thumbnail_url:null});
      } catch (error) {
        if (isQuotaError(error)) throw error;
        categoriesSkipped++; // Not every category has a chart in every region.
      }
    }
  }
  let registered = 0;
  for (const part of chunk([...chart.values()], 500)) registered += await rpc(db, 'youtube_app_explore_register', {p_channels:part, p_via:'chart', p_cap:POOL_CAP}) || 0;

  const searched = new Map();
  let searchSkipped = null;
  for (const {region, q} of seedsForDay(ctx.dayIndex).slice(0, BUDGET.searchCallsPerDay)) {
    if (ctx.unitsBefore + yt.units + 100 > BUDGET.searchStop) { searchSkipped = 'budget'; break; }
    const res = await yt.get('search', {part:'snippet', type:'channel', q, regionCode:region.code, relevanceLanguage:region.lang, order:'viewCount', maxResults:'50'});
    for (const item of res.items) {
      const id = item.id?.channelId || item.snippet?.channelId;
      if (id) searched.set(id, {channel_id:id, title:item.snippet?.title || item.snippet?.channelTitle, thumbnail_url:thumb(item.snippet)});
    }
  }
  for (const part of chunk([...searched.values()], 500)) registered += await rpc(db, 'youtube_app_explore_register', {p_channels:part, p_via:'search', p_cap:POOL_CAP}) || 0;
  return {items:registered, detail:{chartChannels:chart.size, searchChannels:searched.size, registered, categoriesSkipped, searchSkipped}};
}

async function stats(db, yt, ctx) {
  const claimed = (await rpc(db, 'youtube_app_explore_claim_stats', {p_limit:1000}) || []).map(r => r.channel_id);
  let saved = 0, failedBatches = 0, stoppedForBudget = false;
  for (const batch of chunk(claimed, 500)) {
    const rows = [], missing = [];
    for (const ids of chunk(batch, 50)) {
      if (ctx.unitsBefore + yt.units >= BUDGET.exploreStop) { stoppedForBudget = true; break; }
      let res;
      try { res = await yt.get('channels', {part:'snippet,statistics,contentDetails,topicDetails', id:ids.join(','), maxResults:'50'}); }
      catch (error) { if (isQuotaError(error)) throw error; failedBatches++; continue; } // Leases expire and retry.
      const returned = new Set();
      for (const raw of res.items) {
        try { rows.push(channelRow(raw)); returned.add(raw.id); } catch { /* invalid metric: retry after lease */ }
      }
      for (const id of ids) if (!returned.has(id) && !res.items.some(r => r.id === id)) missing.push(id);
    }
    if (rows.length || missing.length) saved += await rpc(db, 'youtube_app_explore_save_stats', {p_channels:rows, p_missing:missing, p_min_subscribers:MIN_SUBSCRIBERS}) || 0;
    if (stoppedForBudget) break;
  }
  return {items:saved, partial:failedBatches > 0 || stoppedForBudget, detail:{claimed:claimed.length, saved, failedBatches, stoppedForBudget}};
}

async function fetchVideos(yt, ids) {
  const rows = [], returned = new Set();
  let failed = 0;
  for (const part of chunk(ids, 50)) {
    let res;
    try { res = await yt.get('videos', {part:'snippet,statistics,contentDetails', id:part.join(','), maxResults:'50'}); }
    catch (error) { if (isQuotaError(error)) throw error; failed++; continue; }
    for (const v of res.items) {
      returned.add(v.id);
      try { const row = videoRow(v); if (row) rows.push(row); } catch { /* skip malformed item */ }
    }
  }
  return {rows, returned, failed};
}

async function shorts(db, yt, ctx, {concurrency=4}={}) {
  const budgetLeft = () => ctx.unitsBefore + yt.units < BUDGET.exploreStop;
  // Phase 1: daily refresh of tracked short videos.
  const due = (await rpc(db, 'youtube_app_explore_claim_videos', {p_limit:1000}) || []).map(r => r.video_id);
  let refreshed = 0, failed = 0;
  if (due.length && budgetLeft()) {
    const {rows, returned, failed:f} = await fetchVideos(yt, due);
    failed += f;
    const missing = f ? [] : due.filter(id => !returned.has(id));
    refreshed = await rpc(db, 'youtube_app_explore_save_videos', {p_videos:rows, p_missing:missing}) || 0;
  }
  // Phase 2: newest uploads of the fastest-growing KR channels.
  let scanned = 0, added = 0;
  if (budgetLeft()) {
    const channels = await rpc(db, 'youtube_app_explore_claim_shorts_channels', {p_limit:100, p_pool:SHORTS_POOL}) || [];
    const cutoff = ctx.now - 30 * 86400000;
    const done = [], candidates = new Map();
    await mapLimit(channels, concurrency, async ch => {
      try {
        const res = await yt.get('playlistItems', {part:'contentDetails', playlistId:ch.uploads_playlist_id, maxResults:'50'});
        for (const item of res.items) {
          const published = Date.parse(item.contentDetails?.videoPublishedAt);
          if (item.contentDetails?.videoId && Number.isFinite(published) && published >= cutoff) candidates.set(item.contentDetails.videoId, ch.channel_id);
        }
        done.push(ch.channel_id);
      } catch (error) {
        if (isQuotaError(error)) throw error;
        if (error instanceof CollectionError && error.code === 'playlistNotFound') done.push(ch.channel_id);
        else failed++;
      }
    });
    scanned = done.length;
    const ids = [...candidates.keys()];
    const known = new Set();
    for (const part of chunk(ids, 200)) {
      const res = await db.from('youtube_app_videos').select('video_id').in('video_id', part);
      if (res.error) throw new CollectionError('storage_failed', 'Could not check known videos');
      for (const row of res.data || []) known.add(row.video_id);
    }
    const fresh = ids.filter(id => !known.has(id));
    if (fresh.length) {
      const {rows, failed:f} = await fetchVideos(yt, fresh);
      failed += f;
      const keep = rows.filter(r => r.duration_seconds !== null && r.duration_seconds <= MAX_SHORT_SECONDS && candidates.get(r.video_id) === r.channel_id);
      if (keep.length) added = await rpc(db, 'youtube_app_explore_save_videos', {p_videos:keep, p_missing:[]}) || 0;
    }
    if (done.length) await rpc(db, 'youtube_app_explore_finish_shorts_channels', {p_ids:done});
  }
  return {items:refreshed + added, partial:failed > 0, detail:{refreshed, scannedChannels:scanned, newShorts:added, failed}};
}

const JOBS = {discover, stats, shorts};

export async function runExplore(db, apiKey, job, {fetcher=fetch, now=Date.now()}={}) {
  if (!JOBS[job]) throw new CollectionError('invalid_job', 'Unknown explore job');
  const unitsBefore = Number(await rpc(db, 'youtube_app_api_units_today', {})) || 0;
  const runId = await rpc(db, 'youtube_app_explore_begin', {p_job:job});
  if (!runId) return {job, status:'not_started'}; // Already running, or paused after a quota error today.
  const yt = meteredClient(apiKey, fetcher);
  if (unitsBefore >= BUDGET.exploreStop) {
    await rpc(db, 'youtube_app_explore_end', {p_run_id:runId, p_status:'skipped', p_units:0, p_items:0, p_error:'budget', p_detail:{unitsBefore}});
    return {job, status:'skipped', unitsBefore};
  }
  try {
    const ctx = {unitsBefore, now, dayIndex:Math.floor(now / 86400000)};
    const result = await JOBS[job](db, yt, ctx);
    const status = result.partial ? 'partial' : 'success';
    await rpc(db, 'youtube_app_explore_end', {p_run_id:runId, p_status:status, p_units:yt.units, p_items:result.items, p_error:null, p_detail:result.detail});
    return {job, status, units:yt.units, ...result.detail};
  } catch (error) {
    const code = error instanceof CollectionError ? error.code : 'explore_failed';
    await db.rpc('youtube_app_explore_end', {p_run_id:runId, p_status:'failed', p_units:yt.units, p_items:0, p_error:code, p_detail:null});
    return {job, status:'failed', code, units:yt.units};
  }
}
