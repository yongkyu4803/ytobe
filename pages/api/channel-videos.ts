import type { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import { getCollectedVideos } from '../../lib/collectedVideos';

interface ChannelVideosRequest {
  channelId: string;
  maxResults?: string;
  publishedAfter?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { channelId, maxResults = '10', publishedAfter } = req.query as Partial<ChannelVideosRequest>;

  if (!channelId) {
    return res.status(400).json({ message: '채널 ID가 필요합니다.' });
  }

  if (req.method !== 'GET') return res.status(405).json({message:'GET 요청이 필요합니다.'});
  if (typeof channelId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(channelId)) return res.status(400).json({message:'올바른 채널 ID가 필요합니다.'});
  const limit = Number(maxResults);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) return res.status(400).json({message:'조회 개수는 1~50 사이여야 합니다.'});
  if (publishedAfter && (typeof publishedAfter !== 'string' || !Number.isFinite(Date.parse(publishedAfter)))) return res.status(400).json({message:'올바른 날짜가 필요합니다.'});
  try {
    const cached = await getCollectedVideos(channelId,limit,publishedAfter);
    if(cached) return res.status(200).json(cached);
  } catch {
    return res.status(503).json({message:'저장된 영상을 불러오지 못했습니다. 잠시 후 다시 시도하세요.'});
  }

  // First collection is pending: preserve live lookup for a newly added channel.
  // API 키 확인
  const apiKey = process.env.YOUTUBE_API_KEY;

  if (!apiKey) {
    console.error('YOUTUBE_API_KEY is not set!');
    return res.status(500).json({
      message: 'API 키가 설정되지 않았습니다.',
    });
  }

  try {
    // Use the channel's uploads playlist so the first view does not consume search.list quota.
    const channelResponse = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
      params: {
        part: 'statistics,snippet,contentDetails',
        id: channelId,
        key: apiKey,
      },
      timeout: 12000,
    });
    const channelData = channelResponse.data.items?.find((item: {id?: string}) => item.id === channelId);
    const uploadsPlaylistId = channelData?.contentDetails?.relatedPlaylists?.uploads;
    if (!channelData || !uploadsPlaylistId) return res.status(404).json({ message: '채널을 찾지 못했습니다.' });

    const playlistResponse = await axios.get('https://www.googleapis.com/youtube/v3/playlistItems', {
      params: {
        part: 'contentDetails',
        playlistId: uploadsPlaylistId,
        maxResults: publishedAfter ? 50 : limit,
        key: apiKey,
      },
      timeout: 12000,
    });
    const videoIds = (playlistResponse.data.items || [])
      .map((item: {contentDetails?: {videoId?: string}}) => item.contentDetails?.videoId)
      .filter((id: unknown): id is string => typeof id === 'string');
    const channelStatistics = channelData?.statistics || { subscriberCount: null };
    const channelSnippet = channelData?.snippet || {};
    if (!videoIds.length) return res.status(200).json({ source: 'youtube', collectedAt: new Date().toISOString(), items: [] });

    const videosResponse = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
      params: { part: 'snippet,statistics,contentDetails', id: videoIds.join(','), key: apiKey },
      timeout: 12000,
    });
    const videoDetails = (videosResponse.data.items || []).filter((video: {snippet?: {publishedAt?: string}}) =>
      !publishedAfter || Date.parse(video.snippet?.publishedAt || '') > Date.parse(publishedAfter)
    ).slice(0, limit);

    const combinedDetails = videoDetails.map((video: any) => {
      // 영상 길이를 초 단위로 변환
      const parseDuration = (duration: string) => {
        const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
        if (!match) return 0;
        const hours = parseInt(match[1] || '0');
        const minutes = parseInt(match[2] || '0');
        const seconds = parseInt(match[3] || '0');
        return hours * 3600 + minutes * 60 + seconds;
      };

      const durationInSeconds = parseDuration(video.contentDetails.duration);
      const isShorts = durationInSeconds <= 60;

      return {
        ...video,
        channelStatistics,
        channelSnippet,
        isShorts,
        durationInSeconds,
      };
    });

    res.status(200).json({
      source: 'youtube',
      collectedAt: new Date().toISOString(),
      items: combinedDetails,
      channelInfo: {
        channelId,
        channelTitle: channelSnippet.title || '',
        channelThumbnail: channelSnippet.thumbnails?.default?.url || '',
        subscriberCount: channelStatistics.hiddenSubscriberCount ? null : channelStatistics.subscriberCount ?? null,
      }
    });

  } catch (error: any) {
    const errorMessage = error.response?.data?.error?.message || '채널 영상을 불러오는 데 실패했습니다.';
    console.error('채널 영상 조회 API 오류:', JSON.stringify(error.response?.data, null, 2));
    res.status(500).json({ message: errorMessage });
  }
}
