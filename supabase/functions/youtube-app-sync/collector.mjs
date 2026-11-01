// Shared by the Edge Function and offline tests; all external IO is injected.
import {topicIds,countryCode,videoTags} from '../_shared/channel.mjs';
import {extractKeywords} from '../_shared/keywords.mjs';
import {metric,durationSeconds,youtubeClient,CollectionError} from '../_shared/youtube.mjs';
export {metric,durationSeconds,youtubeClient,CollectionError};
export async function collectChannel(channelId, startedAt, youtube) {
  const data = await youtube.get('channels', {part:'snippet,statistics,contentDetails,topicDetails', id:channelId});
  const raw = data.items.find(c => c.id === channelId);
  if (!raw) throw new CollectionError('channel_unavailable', 'Channel is unavailable');
  const playlist = raw.contentDetails?.relatedPlaylists?.uploads;
  if (!playlist) throw new CollectionError('playlist_unavailable', 'Uploads playlist is unavailable');
  const channel = {
    channel_id: channelId, title:raw.snippet.title,
    thumbnail_url:raw.snippet.thumbnails?.medium?.url || raw.snippet.thumbnails?.default?.url || null,
    uploads_playlist_id:playlist,
    subscriber_count:raw.statistics?.hiddenSubscriberCount ? null : metric(raw.statistics?.subscriberCount),
    view_count:metric(raw.statistics?.viewCount), video_count:metric(raw.statistics?.videoCount),
    country:countryCode(raw.snippet?.country), topic_ids:topicIds(raw.topicDetails?.topicCategories),
  };
  const cutoff = Date.parse(startedAt) - 30*86400000;
  const ids = new Set();
  let pageToken;
  // Deliberately bounded: a partial listing must fail rather than advance the success cursor.
  for (let page=0; page<100; page++) {
    const result = await youtube.get('playlistItems', {part:'contentDetails',playlistId:playlist,maxResults:'50',...(pageToken?{pageToken}:{})});
    let reachedCutoff = false;
    for (const item of result.items) {
      const published = Date.parse(item.contentDetails?.videoPublishedAt);
      if (!Number.isFinite(published)) continue; // Deleted/private playlist entries have no publication date.
      if (published < cutoff) { reachedCutoff = true; continue; }
      if (item.contentDetails?.videoId) ids.add(item.contentDetails.videoId);
    }
    pageToken = result.nextPageToken;
    if (!pageToken || reachedCutoff) { pageToken = undefined; break; }
  }
  if (pageToken) throw new CollectionError('pagination_limit', 'More than 5000 uploads in tracking window; review collection limit');
  const videos = [];
  const allIds = [...ids];
  for(let i=0;i<allIds.length;i+=50) {
    const result = await youtube.get('videos',{part:'snippet,statistics,contentDetails',id:allIds.slice(i,i+50).join(',')});
    for(const v of result.items) {
      if (v.snippet?.channelId !== channelId) throw new CollectionError('channel_mismatch','Video belongs to a different channel');
      if (!Number.isFinite(Date.parse(v.snippet.publishedAt))) throw new CollectionError('invalid_date','Invalid video publication date');
      videos.push({video_id:v.id,channel_id:channelId,title:v.snippet.title,published_at:v.snippet.publishedAt,
        thumbnail_url:v.snippet.thumbnails?.medium?.url || v.snippet.thumbnails?.default?.url || null,
        duration_seconds:durationSeconds(v.contentDetails?.duration),
        view_count:metric(v.statistics?.viewCount),like_count:metric(v.statistics?.likeCount),comment_count:metric(v.statistics?.commentCount),
        tags:videoTags(v.snippet.tags),
        keywords:extractKeywords({title:v.snippet.title,description:v.snippet.description,tags:v.snippet.tags})});
    }
  }
  return {channel,videos};
}
export async function runCollection(db, apiKey, {limit=3, fetcher=fetch, fullSyncId=null, delayMs=0}={}) {
  const claimed = fullSyncId
    ? await db.rpc('youtube_app_claim_full_sync',{p_full_sync_id:fullSyncId,p_limit:limit})
    : await db.rpc('youtube_app_claim_sync',{p_limit:limit});
  if (claimed.error) throw new CollectionError('claim_failed','Could not claim collection work');
  const results=[];
  // Sequential channels keep API pressure bounded; channel leases allow parallel invocations safely.
  for(const [index,run] of (claimed.data || []).entries()) {
    if(index>0 && delayMs>0) await new Promise(resolve=>setTimeout(resolve,delayMs));
    const youtube=youtubeClient(apiKey,fetcher);
    try {
      const {channel,videos}=await collectChannel(run.channel_id,run.started_at,youtube);
      const done=await db.rpc('youtube_app_finish_sync',{p_run_id:run.run_id,p_channel:channel,p_videos:videos,p_requests:youtube.requests});
      if(done.error) {
        const recovered=await db.rpc('youtube_app_sync_result',{p_run_id:run.run_id});
        if(!recovered.error && recovered.data?.status==='success') {
          results.push({channelId:run.channel_id,status:'success',recovered:true,...recovered.data});
          continue;
        }
        throw new CollectionError('storage_failed','Collection could not be committed');
      }
      results.push({channelId:run.channel_id,status:done.data?.cancelled?'cancelled':'success',...done.data});
    } catch(error) {
      const code=error instanceof CollectionError?error.code:'collection_failed';
      const message=error instanceof CollectionError?error.message:'Unexpected collection failure';
      const failed=await db.rpc('youtube_app_fail_sync',{p_run_id:run.run_id,p_code:code,p_message:message,p_requests:youtube.requests});
      results.push({channelId:run.channel_id,status:'failed',code,recorded:!failed.error});
    }
  }
  return results;
}
