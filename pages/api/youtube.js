
import axios from 'axios';

export default async function handler(req, res) {
  const { query, publishedAfter } = req.query;

  // 디버깅용 로그
  console.log('API Key exists:', !!process.env.YOUTUBE_API_KEY);
  console.log('API Key length:', process.env.YOUTUBE_API_KEY?.length);
  console.log('API Key first 10 chars:', process.env.YOUTUBE_API_KEY?.substring(0, 10));
  console.log('Environment:', process.env.NODE_ENV);
  console.log('Query received:', query);
  console.log('PublishedAfter received:', publishedAfter);

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

  if (!query) {
    return res.status(400).json({ message: '검색어를 입력해주세요.' });
  }

  // 임시 테스트용 - 배포 전에 반드시 제거할 것!
  const apiKey = process.env.YOUTUBE_API_KEY || 'AIzaSyAP91a4OyzrJ0tFUj4AieVn5IMYr_LYiBc';
  
  console.log('Using API Key:', apiKey.substring(0, 10) + '...');

  try {
    // 1. 검색 API 호출 (결과 50개로 증가)
    const searchParams = {
      part: 'snippet',
      q: query,
      key: apiKey, // 환경변수 대신 로컬 변수 사용
      maxResults: 50, 
      type: 'video',
      order: 'viewCount',
    };

    // 날짜 필터가 있으면 추가
    if (publishedAfter) {
      searchParams.publishedAfter = publishedAfter;
      console.log('Adding publishedAfter to search params:', publishedAfter);
    }

    console.log('Final search params:', searchParams);

    const searchResponse = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: searchParams,
    });

    const searchItems = searchResponse.data.items;
    if (!searchItems || searchItems.length === 0) {
      return res.status(200).json({ items: [] });
    }

    const videoIds = searchItems.map(item => item.id.videoId).join(',');

    // 2. 동영상 상세 정보 호출 (조회수, 좋아요 수, 댓글 수, 영상 길이 등)
    const videosResponse = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
      params: {
        part: 'snippet,statistics,contentDetails',
        id: videoIds,
        key: apiKey, // 환경변수 대신 로컬 변수 사용
      },
    });

    const videoDetails = videosResponse.data.items;
    if (!videoDetails || videoDetails.length === 0) {
      return res.status(200).json({ items: [] });
    }

    // 3. 채널 ID를 추출하여 채널 정보(구독자 수) 호출
    const channelIds = [...new Set(videoDetails.map(item => item.snippet.channelId))].join(',');
    const channelsResponse = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
      params: {
        part: 'statistics',
        id: channelIds,
        key: apiKey, // 환경변수 대신 로컬 변수 사용
      },
    });

    const channelStatsMap = new Map(
      channelsResponse.data.items.map(item => [item.id, item.statistics])
    );

    // 4. 동영상 정보와 채널 정보를 합침
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

    // 5. 조회수 기준으로 최종 정렬
    combinedDetails.sort((a, b) => {
      const viewCountA = parseInt(a.statistics.viewCount, 10);
      const viewCountB = parseInt(b.statistics.viewCount, 10);
      return viewCountB - viewCountA;
    });

    res.status(200).json({ items: combinedDetails });

  } catch (error) {
    const errorMessage = error.response?.data?.error?.message || '서버에서 오류가 발생했습니다.';
    console.error('유튜브 API 오류:', JSON.stringify(error.response?.data, null, 2));
    res.status(500).json({ message: errorMessage });
  }
}
