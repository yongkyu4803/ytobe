import axios from 'axios';

interface Video {
  id: string;
  snippet: {
    title: string;
    channelTitle: string;
    channelId: string;
    publishedAt: string;
    thumbnails: {
      medium: {
        url: string;
      };
    };
  };
  statistics: {
    viewCount: string;
    likeCount: string;
    commentCount: string;
  };
  channelStatistics: {
    subscriberCount: string;
  };
  isShorts: boolean;
  durationInSeconds: number;
}

interface KeywordRecommendation {
  keyword: string;
  videos: Video[];
  totalViews: number;
  avgEngagement: number;
}

export class SmartRecommendationEngine {
  // 시간대별 추천 카테고리
  static getTimeBasedCategory(): string {
    const hour = new Date().getHours();
    
    if (hour >= 6 && hour < 9) {
      return '25'; // 뉴스/정치 (아침 시간대)
    } else if (hour >= 9 && hour < 12) {
      return '27'; // 교육 (오전 시간대)
    } else if (hour >= 12 && hour < 14) {
      return '26'; // 요리/라이프 (점심 시간대)
    } else if (hour >= 14 && hour < 18) {
      return '22'; // 인물/블로그 (오후 시간대)
    } else if (hour >= 18 && hour < 22) {
      return '24'; // 엔터테인먼트 (저녁 시간대)
    } else if (hour >= 22 || hour < 2) {
      return '10'; // 음악 (심야 시간대)
    } else {
      return '20'; // 게임 (새벽 시간대)
    }
  }

  // 시간대별 추천 설명
  static getTimeBasedDescription(): string {
    const hour = new Date().getHours();
    
    if (hour >= 6 && hour < 9) {
      return '☀️ 아침 시간대 - 하루를 시작하는 뉴스와 정보';
    } else if (hour >= 9 && hour < 12) {
      return '📚 오전 시간대 - 학습과 자기계발 콘텐츠';
    } else if (hour >= 12 && hour < 14) {
      return '🍽️ 점심 시간대 - 요리와 라이프스타일';
    } else if (hour >= 14 && hour < 18) {
      return '💼 오후 시간대 - 인물과 브이로그';
    } else if (hour >= 18 && hour < 22) {
      return '🎭 저녁 시간대 - 엔터테인먼트와 휴식';
    } else if (hour >= 22 || hour < 2) {
      return '🌙 심야 시간대 - 감성적인 음악';
    } else {
      return '🌌 새벽 시간대 - 게임과 오락';
    }
  }

  // 키워드 조합 추천
  static async getKeywordCombination(): Promise<KeywordRecommendation[]> {
    const keywords = [
      '최신 트렌드',
      'AI 인공지능',
      '맛집 리뷰',
      '여행 vlog',
      '운동 루틴',
      '책 추천',
      '투자 재테크',
      '요리 레시피'
    ];

    const results: KeywordRecommendation[] = [];

    try {
      for (const keyword of keywords.slice(0, 4)) { // API 할당량 고려하여 4개만
        const response = await axios.get(`/api/youtube?query=${encodeURIComponent(keyword)}&maxResults=10`);
        const videos = response.data.items || [];
        
        if (videos.length > 0) {
          const totalViews = videos.reduce((sum: number, video: Video) => 
            sum + parseInt(video.statistics.viewCount, 10), 0);
          
          const avgEngagement = videos.reduce((sum: number, video: Video) => {
            const likes = parseInt(video.statistics.likeCount, 10);
            const comments = parseInt(video.statistics.commentCount || '0', 10);
            const views = parseInt(video.statistics.viewCount, 10);
            return sum + ((likes + comments) / views);
          }, 0) / videos.length;

          results.push({
            keyword,
            videos: videos.slice(0, 5), // 상위 5개만
            totalViews,
            avgEngagement
          });
        }
      }
    } catch (error) {
      console.error('키워드 조합 추천 실패:', error);
    }

    return results.sort((a, b) => b.avgEngagement - a.avgEngagement);
  }

  // 숨은 보석 발굴 (참여율 높은 동영상)
  static async getHiddenGems(): Promise<Video[]> {
    const searchTerms = [
      '신규채널 추천',
      '숨은 맛집',
      '꿀팁 정보',
      '신인 아티스트',
      '소규모 크리에이터'
    ];

    try {
      const allVideos: Video[] = [];
      
      for (const term of searchTerms.slice(0, 3)) { // API 할당량 고려
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const response = await axios.get(`/api/youtube`, {
          params: {
            query: term,
            order: 'relevance',
            publishedAfter: sevenDaysAgo,
            maxResults: 15
          }
        });
        
        if (response.data.items) {
          allVideos.push(...response.data.items);
        }
      }

      // 참여율 기준으로 정렬 (좋아요 + 댓글) / 조회수
      const sortedByEngagement = allVideos
        .filter(video => {
          const views = parseInt(video.statistics.viewCount, 10);
          const subscribers = parseInt(video.channelStatistics.subscriberCount, 10);
          // 중간 규모 채널 (1만~50만 구독자) 필터링
          return views > 1000 && subscribers >= 10000 && subscribers <= 500000;
        })
        .sort((a, b) => {
          const engagementA = (
            parseInt(a.statistics.likeCount, 10) + 
            parseInt(a.statistics.commentCount || '0', 10)
          ) / parseInt(a.statistics.viewCount, 10);
          
          const engagementB = (
            parseInt(b.statistics.likeCount, 10) + 
            parseInt(b.statistics.commentCount || '0', 10)
          ) / parseInt(b.statistics.viewCount, 10);
          
          return engagementB - engagementA;
        });

      // 중복 제거 (채널 기준)
      const uniqueChannels = new Set();
      const uniqueVideos = sortedByEngagement.filter(video => {
        if (uniqueChannels.has(video.snippet.channelId)) {
          return false;
        }
        uniqueChannels.add(video.snippet.channelId);
        return true;
      });

      return uniqueVideos.slice(0, 20); // 상위 20개
    } catch (error) {
      console.error('숨은 보석 발굴 실패:', error);
      return [];
    }
  }

  // 급상승 예측 알고리즘 (최근 급격한 성장을 보이는 동영상)
  static async getPredictedRising(): Promise<Video[]> {
    try {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const response = await axios.get(`/api/youtube`, {
        params: {
          query: '최신 트렌드 OR 화제 OR 인기급상승',
          order: 'date',
          publishedAfter: yesterday,
          maxResults: 30
        }
      });

      const videos = response.data.items || [];
      
      // 시간당 조회수 증가율이 높은 동영상 계산
      interface ScoredVideo extends Video {
        score: number;
        hoursOld: number;
      }

      const scoredVideos: ScoredVideo[] = videos.map((video: Video) => {
        const publishedTime = new Date(video.snippet.publishedAt).getTime();
        const hoursOld = (Date.now() - publishedTime) / (1000 * 60 * 60);
        const viewCount = parseInt(video.statistics.viewCount, 10);
        const viewsPerHour = viewCount / Math.max(hoursOld, 1);
        
        return {
          ...video,
          score: viewsPerHour,
          hoursOld: Math.round(hoursOld)
        };
      });

      return scoredVideos
        .sort((a: ScoredVideo, b: ScoredVideo) => b.score - a.score)
        .slice(0, 15)
        .map(({ score, hoursOld, ...video }) => video as Video);
        
    } catch (error) {
      console.error('급상승 예측 실패:', error);
      return [];
    }
  }
}