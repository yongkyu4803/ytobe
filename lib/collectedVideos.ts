import { supabase } from './supabase';
import { metricText } from '../utils/metrics';

export async function getCollectedVideos(channelId: string, limit: number, after?: string) {
  const {data:channel,error} = await supabase.from('youtube_app_channels').select('*').eq('channel_id',channelId).maybeSingle();
  if (error) throw new Error('저장된 채널 정보를 불러오지 못했습니다.');
  if (!channel?.last_success_at) return null;
  let query=supabase.from('youtube_app_videos').select('*').eq('channel_id',channelId).not('collected_at','is',null)
    .order('published_at',{ascending:false}).order('video_id').limit(limit);
  if(after) query=query.gt('published_at',after);
  const {data:videos,error:videoError}=await query;
  if(videoError) throw new Error('저장된 영상을 불러오지 못했습니다.');
  return {
    items:(videos || []).map(v=>({id:v.video_id,
      snippet:{title:v.title,channelTitle:channel.title,channelId,publishedAt:v.published_at,
        thumbnails:{medium:{url:v.thumbnail_url || ''}}},
      statistics:{viewCount:metricText(v.view_count),likeCount:metricText(v.like_count),commentCount:metricText(v.comment_count)},
      channelStatistics:{subscriberCount:metricText(channel.subscriber_count)},
      durationInSeconds:v.duration_seconds,isShorts:v.duration_seconds===null?null:v.duration_seconds<=60,
      collectedAt:v.collected_at,
    })),
    channelInfo:{channelId,channelTitle:channel.title,channelThumbnail:channel.thumbnail_url,subscriberCount:metricText(channel.subscriber_count)},
    source:'database',collectedAt:channel.last_success_at,
    stale:Date.now()-Date.parse(channel.last_success_at)>4*3600000,
    lastError:channel.last_error,
  };
}
