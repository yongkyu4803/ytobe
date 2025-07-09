import axios from 'axios';

export default async function handler(req, res) {
  const { category, regionCode = 'KR', maxResults = 50 } = req.query;

  console.log('Trending API called with:', { category, regionCode, maxResults });

  if (!process.env.YOUTUBE_API_KEY) {
    console.error('YOUTUBE_API_KEY is not set!');
    return res.status(500).json({ 
      message: 'API 키가 설정되지 않았습니다.',
      debug: {
        hasApiKey: !!process.env.YOUTUBE_API_KEY,
        env: process.env.NODE_ENV
      }
    });
  }

  const apiKey = process.env.YOUTUBE_API_KEY || 'AIzaSyAP91a4OyzrJ0tFUj4AieVn5IMYr_LYiBc';

  try {
    // 1. YouTube Trending Videos API 호출
    const trendingParams = {
      part: 'snippet,statistics,contentDetails',
      chart: 'mostPopular',
      regionCode: regionCode,
      maxResults: parseInt(maxResults),
      key: apiKey,
    };

    // 카테고리가 지정된 경우 추가
    if (category && category !== 'all') {
      trendingParams.videoCategoryId = category;
    }

    console.log('Trending API params:', trendingParams);

    const trendingResponse = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
      params: trendingParams,
    });

    const videoDetails = trendingResponse.data.items;
    if (!videoDetails || videoDetails.length === 0) {
      return res.status(200).json({ items: [] });
    }

    // 2. 채널 ID를 추출하여 채널 정보(구독자 수) 호출
    const channelIds = [...new Set(videoDetails.map(item => item.snippet.channelId))].join(',');
    const channelsResponse = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
      params: {
        part: 'statistics',
        id: channelIds,
        key: apiKey,
      },
    });

    const channelStatsMap = new Map(
      channelsResponse.data.items.map(item => [item.id, item.statistics])
    );

    // 3. 동영상 정보와 채널 정보를 합침
    const combinedDetails = videoDetails.map(video => {
      // 영상 길이를 초 단위로 변환하는 함수
      const parseDuration = (duration) => {
        const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
        if (!match) return 0;
        const hours = parseInt(match[1] || 0);
        const minutes = parseInt(match[2] || 0);
        const seconds = parseInt(match[3] || 0);
        return hours * 3600 + minutes * 60 + seconds;
      };

      const durationInSeconds = parseDuration(video.contentDetails.duration);
      const isShorts = durationInSeconds <= 60; // 60초 이하는 쇼츠로 판단

      return {
        ...video,
        channelStatistics: channelStatsMap.get(video.snippet.channelId) || { subscriberCount: '0' },
        isShorts,
        durationInSeconds,
      };
    });

    // 4. 조회수 기준으로 정렬 (이미 trending 순서이지만 안전하게)
    combinedDetails.sort((a, b) => {
      const viewCountA = parseInt(a.statistics.viewCount, 10);
      const viewCountB = parseInt(b.statistics.viewCount, 10);
      return viewCountB - viewCountA;
    });

    console.log(`Successfully fetched ${combinedDetails.length} trending videos for category: ${category || 'all'}`);

    res.status(200).json({ items: combinedDetails });

  } catch (error) {
    const errorMessage = error.response?.data?.error?.message || '트렌딩 동영상을 불러오는 데 실패했습니다.';
    console.error('YouTube Trending API 오류:', JSON.stringify(error.response?.data, null, 2));
    res.status(500).json({ message: errorMessage });
  }
}