import { useState } from 'react';
import { SmartRecommendationEngine } from '../utils/smartRecommendation';

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

interface SmartRecommendationProps {
  onVideosLoad: (videos: Video[], source: string) => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
}

const SmartRecommendation: React.FC<SmartRecommendationProps> = ({ 
  onVideosLoad, 
  loading, 
  setLoading 
}) => {
  const [lastRecommendation, setLastRecommendation] = useState<string>('');

  const handleTimeBasedRecommendation = async () => {
    setLoading(true);
    try {
      const category = SmartRecommendationEngine.getTimeBasedCategory();
      const description = SmartRecommendationEngine.getTimeBasedDescription();
      
      const response = await fetch(`/api/trending?category=${category}`);
      const data = await response.json();
      
      onVideosLoad(data.items || [], `시간대별 맞춤 (${description})`);
      setLastRecommendation(`시간대별 맞춤 추천 적용됨: ${description}`);
    } catch (error) {
      console.error('시간대별 추천 실패:', error);
    }
    setLoading(false);
  };

  const handleKeywordCombination = async () => {
    setLoading(true);
    try {
      const recommendations = await SmartRecommendationEngine.getKeywordCombination();
      
      // 모든 키워드의 동영상을 합치고 참여율 순으로 정렬
      const allVideos = recommendations.flatMap(rec => rec.videos);
      const sortedVideos = allVideos.sort((a, b) => {
        const engagementA = (parseInt(a.statistics.likeCount, 10) + parseInt(a.statistics.commentCount || '0', 10)) / parseInt(a.statistics.viewCount, 10);
        const engagementB = (parseInt(b.statistics.likeCount, 10) + parseInt(b.statistics.commentCount || '0', 10)) / parseInt(b.statistics.viewCount, 10);
        return engagementB - engagementA;
      });

      onVideosLoad(sortedVideos.slice(0, 30), '키워드 조합 추천');
      setLastRecommendation(`키워드 조합 추천 적용됨: ${recommendations.map(r => r.keyword).join(', ')}`);
    } catch (error) {
      console.error('키워드 조합 추천 실패:', error);
    }
    setLoading(false);
  };

  const handleHiddenGems = async () => {
    setLoading(true);
    try {
      const hiddenGems = await SmartRecommendationEngine.getHiddenGems();
      onVideosLoad(hiddenGems, '숨은 보석 발굴');
      setLastRecommendation(`숨은 보석 ${hiddenGems.length}개 발굴됨 (중간 규모 채널, 높은 참여율)`);
    } catch (error) {
      console.error('숨은 보석 발굴 실패:', error);
    }
    setLoading(false);
  };

  const handlePredictedRising = async () => {
    setLoading(true);
    try {
      const risingVideos = await SmartRecommendationEngine.getPredictedRising();
      onVideosLoad(risingVideos, '급상승 예측');
      setLastRecommendation(`급상승 예측 ${risingVideos.length}개 발견됨 (24시간 내 높은 성장률)`);
    } catch (error) {
      console.error('급상승 예측 실패:', error);
    }
    setLoading(false);
  };

  const smartRecommendations = [
    {
      id: 'time-based',
      title: '🕐 시간대별 맞춤',
      description: SmartRecommendationEngine.getTimeBasedDescription(),
      action: handleTimeBasedRecommendation,
      color: 'primary'
    },
    {
      id: 'keyword-combo',
      title: '🎯 키워드 조합',
      description: '다양한 트렌드 키워드 기반 큐레이션',
      action: handleKeywordCombination,
      color: 'success'
    },
    {
      id: 'hidden-gems',
      title: '💎 숨은 보석',
      description: '참여율 높은 중소 채널 발굴',
      action: handleHiddenGems,
      color: 'warning'
    },
    {
      id: 'predicted-rising',
      title: '📈 급상승 예측',
      description: '24시간 내 빠른 성장세 동영상',
      action: handlePredictedRising,
      color: 'info'
    }
  ];

  return (
    <div className="mb-4">
      <div className="mb-3">
        <h5 className="mb-2">🤖 AI 스마트 추천</h5>
        <p className="text-muted small mb-3">
          고급 알고리즘으로 개인화된 추천을 제공합니다. 시간대, 트렌드, 참여율을 분석하여 최적의 콘텐츠를 찾아드립니다.
        </p>
      </div>

      <div className="row g-4">
        {smartRecommendations.map(recommendation => (
          <div key={recommendation.id} className="col-md-6 col-xl-3">
            <div className="card h-100 border-0 shadow-sm">
              <div className="card-body text-center">
                <h6 className={`text-${recommendation.color} fw-bold mb-2`}>
                  {recommendation.title}
                </h6>
                <p className="small text-muted mb-3">
                  {recommendation.description}
                </p>
                <button
                  className="btn btn-outline-secondary btn-sm w-100"
                  onClick={recommendation.action}
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                      분석중...
                    </>
                  ) : (
                    '추천 받기'
                  )}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {lastRecommendation && (
        <div className="alert alert-success mt-3 py-2">
          <small>
            <strong>✅ 최근 추천:</strong> {lastRecommendation}
          </small>
        </div>
      )}

      <div className="mt-3">
        <small className="text-muted">
          💡 <strong>팁:</strong> 시간대별 추천은 현재 시간({new Date().getHours()}시)에 최적화되어 있습니다. 
          다른 시간대에 다시 시도해보세요!
        </small>
      </div>
    </div>
  );
};

export default SmartRecommendation;