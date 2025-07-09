import { useState, useEffect } from 'react';
import axios from 'axios';
import Head from 'next/head';
import Layout from '../components/Layout';
import TrendingCategories from '../components/TrendingCategories';
import SmartRecommendation from '../components/SmartRecommendation';

interface VideoStatistics {
  viewCount: string;
  likeCount: string;
  commentCount: string;
}

interface ChannelStatistics {
  subscriberCount: string;
}

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
  statistics: VideoStatistics;
  channelStatistics: ChannelStatistics;
  isShorts: boolean;
  durationInSeconds: number;
}

type SortField = 'index' | 'title' | 'channelTitle' | 'subscriberCount' | 'publishedAt' | 'duration' | 'viewCount' | 'likeCount' | 'commentCount' | 'viewSubscriberRatio' | 'engagementRate' | 'type';
type SortOrder = 'asc' | 'desc';

// 유틸리티 함수들 (index.tsx에서 복사)
const formatNumber = (numStr: string): string => {
  const num = parseInt(numStr, 10);
  if (isNaN(num)) return '0';
  if (num >= 100000000) {
    return `${(num / 100000000).toFixed(1).replace(/\.0$/, '')}억`;
  }
  if (num >= 10000) {
    return `${Math.floor(num / 10000)}만`;
  }
  return new Intl.NumberFormat('ko-KR').format(num);
};

const formatDuration = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

const formatPublishedAt = (publishedAt: string): string => {
  const published = new Date(publishedAt);
  const year = published.getFullYear();
  const month = String(published.getMonth() + 1).padStart(2, '0');
  const day = String(published.getDate()).padStart(2, '0');
  const hours = String(published.getHours()).padStart(2, '0');
  const minutes = String(published.getMinutes()).padStart(2, '0');
  
  return `${year}-${month}-${day} ${hours}:${minutes}`;
};

const calculateViewSubscriberRatio = (viewCount: string, subscriberCount: string): { ratio: number, level: string, color: string } => {
  const views = parseInt(viewCount, 10);
  const subscribers = parseInt(subscriberCount, 10);
  
  if (subscribers === 0 || isNaN(views) || isNaN(subscribers)) {
    return { ratio: 0, level: '정보없음', color: 'text-muted' };
  }
  
  const ratio = views / subscribers;
  
  if (ratio >= 5) {
    return { ratio, level: '매우 높음', color: 'text-success' };
  } else if (ratio >= 2) {
    return { ratio, level: '높음', color: 'text-primary' };
  } else if (ratio >= 0.5) {
    return { ratio, level: '보통', color: 'text-warning' };
  } else {
    return { ratio, level: '낮음', color: 'text-danger' };
  }
};

const calculateEngagementRate = (likeCount: string, commentCount: string): { ratio: number, level: string, color: string } => {
  const likes = parseInt(likeCount, 10);
  const comments = parseInt(commentCount, 10);
  
  if (comments === 0 || isNaN(likes) || isNaN(comments)) {
    return { ratio: 0, level: '정보없음', color: 'text-muted' };
  }
  
  const ratio = likes / comments;
  
  if (ratio >= 50) {
    return { ratio, level: '매우 높음', color: 'text-success' };
  } else if (ratio >= 20) {
    return { ratio, level: '높음', color: 'text-primary' };
  } else if (ratio >= 10) {
    return { ratio, level: '보통', color: 'text-warning' };
  } else {
    return { ratio, level: '낮음', color: 'text-danger' };
  }
};

export default function TrendingPage() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [sortField, setSortField] = useState<SortField>('viewCount');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [currentSource, setCurrentSource] = useState('전체 급상승');
  const [viewMode, setViewMode] = useState<'category' | 'smart'>('category');

  const categories = [
    { id: 'all', name: '🔥 전체 급상승', icon: '🔥' },
    { id: '10', name: '🎵 음악', icon: '🎵' },
    { id: '20', name: '🎮 게임', icon: '🎮' },
    { id: '24', name: '📺 엔터테인먼트', icon: '📺' },
    { id: '25', name: '📰 뉴스/정치', icon: '📰' },
    { id: '26', name: '🍳 요리/라이프', icon: '🍳' },
    { id: '22', name: '👥 인물/블로그', icon: '👥' },
    { id: '27', name: '🎓 교육', icon: '🎓' },
  ];

  // 정렬 함수
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  // 정렬된 비디오 데이터 반환
  const getSortedVideos = (videosToSort: Video[]) => {
    return [...videosToSort].sort((a, b) => {
      let aValue: any, bValue: any;
      
      switch (sortField) {
        case 'title':
          aValue = a.snippet.title.toLowerCase();
          bValue = b.snippet.title.toLowerCase();
          break;
        case 'channelTitle':
          aValue = a.snippet.channelTitle.toLowerCase();
          bValue = b.snippet.channelTitle.toLowerCase();
          break;
        case 'subscriberCount':
          aValue = parseInt(a.channelStatistics.subscriberCount, 10);
          bValue = parseInt(b.channelStatistics.subscriberCount, 10);
          break;
        case 'publishedAt':
          aValue = new Date(a.snippet.publishedAt).getTime();
          bValue = new Date(b.snippet.publishedAt).getTime();
          break;
        case 'duration':
          aValue = a.durationInSeconds;
          bValue = b.durationInSeconds;
          break;
        case 'viewCount':
          aValue = parseInt(a.statistics.viewCount, 10);
          bValue = parseInt(b.statistics.viewCount, 10);
          break;
        case 'likeCount':
          aValue = parseInt(a.statistics.likeCount, 10);
          bValue = parseInt(b.statistics.likeCount, 10);
          break;
        case 'commentCount':
          aValue = parseInt(a.statistics.commentCount || '0', 10);
          bValue = parseInt(b.statistics.commentCount || '0', 10);
          break;
        case 'viewSubscriberRatio':
          aValue = parseInt(a.statistics.viewCount, 10) / parseInt(a.channelStatistics.subscriberCount, 10);
          bValue = parseInt(b.statistics.viewCount, 10) / parseInt(b.channelStatistics.subscriberCount, 10);
          break;
        case 'engagementRate':
          aValue = parseInt(a.statistics.likeCount, 10) / parseInt(a.statistics.commentCount || '1', 10);
          bValue = parseInt(b.statistics.likeCount, 10) / parseInt(b.statistics.commentCount || '1', 10);
          break;
        case 'type':
          aValue = a.isShorts ? 0 : 1;
          bValue = b.isShorts ? 0 : 1;
          break;
        default:
          return 0;
      }
      
      if (isNaN(aValue) && isNaN(bValue)) return 0;
      if (isNaN(aValue)) return 1;
      if (isNaN(bValue)) return -1;
      
      if (sortOrder === 'asc') {
        return aValue > bValue ? 1 : aValue < bValue ? -1 : 0;
      } else {
        return aValue < bValue ? 1 : aValue > bValue ? -1 : 0;
      }
    });
  };

  // 정렬 표시 아이콘
  const getSortIcon = (field: SortField) => {
    if (sortField !== field) return ' ↕️';
    return sortOrder === 'asc' ? ' ↑' : ' ↓';
  };

  // 트렌딩 동영상 가져오기
  const fetchTrendingVideos = async (categoryId: string) => {
    setLoading(true);
    setError('');
    setVideos([]);
    setActiveCategory(categoryId);

    try {
      console.log('Fetching trending videos for category:', categoryId);
      
      const response = await axios.get(`/api/trending?category=${categoryId}`);
      setVideos(response.data.items || []);
      setCurrentSource(categories.find(cat => cat.id === categoryId)?.name || '카테고리 추천');
      
      if (!response.data.items || response.data.items.length === 0) {
        setError('해당 카테고리의 트렌딩 동영상이 없습니다.');
      }
    } catch (err: any) {
      const message = err.response?.data?.message || '트렌딩 동영상을 불러오는 데 실패했습니다.';
      setError(message);
      console.error(err);
    }

    setLoading(false);
  };

  // 스마트 추천에서 동영상 로드
  const handleSmartVideosLoad = (smartVideos: Video[], source: string) => {
    setVideos(smartVideos);
    setCurrentSource(source);
    setError('');
  };

  // 페이지 로드 시 전체 급상승 동영상 로드
  useEffect(() => {
    fetchTrendingVideos('all');
  }, []);

  return (
    <Layout>
      <Head>
        <title>인기 추천 - YouTube Analytics</title>
        <meta name="description" content="YouTube 인기 급상승 동영상과 카테고리별 트렌딩 콘텐츠를 확인하세요." />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className="text-center mb-4">
        <h2 className="display-6 fw-bold text-primary mb-2">🎯 인기 동영상 추천</h2>
        <p className="lead text-muted">실시간 트렌딩 콘텐츠와 AI 기반 스마트 추천을 발견하세요</p>
      </div>

      {/* 추천 모드 선택 */}
      <div className="mb-4">
        <div className="d-flex justify-content-center">
          <div className="btn-group" role="group" aria-label="추천 모드">
            <button
              type="button"
              className={`btn ${viewMode === 'category' ? 'btn-primary' : 'btn-outline-primary'}`}
              onClick={() => setViewMode('category')}
            >
              📂 카테고리 추천
            </button>
            <button
              type="button"
              className={`btn ${viewMode === 'smart' ? 'btn-primary' : 'btn-outline-primary'}`}
              onClick={() => setViewMode('smart')}
            >
              🤖 AI 스마트 추천
            </button>
          </div>
        </div>
      </div>

      {/* 조건부 렌더링 */}
      {viewMode === 'category' ? (
        <TrendingCategories
          onCategorySelect={fetchTrendingVideos}
          loading={loading}
          activeCategory={activeCategory}
        />
      ) : (
        <SmartRecommendation
          onVideosLoad={handleSmartVideosLoad}
          loading={loading}
          setLoading={setLoading}
        />
      )}

      {error && <p className="text-danger text-center">{error}</p>}

      {loading && (
        <div className="text-center py-5">
          <div className="spinner-border text-primary" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
          <p className="mt-2 text-muted">트렌딩 동영상을 불러오는 중...</p>
        </div>
      )}

      {videos.length > 0 && (
        <>
          <div className="d-flex justify-content-end mb-3">
            <div className="bg-light rounded-pill px-3 py-2 border">
              <small className="text-muted">
                <span className="text-primary fw-semibold">📊 성과지표</span>: 구독자 수 대비 조회수 비율 
                <span className="text-muted mx-2">•</span>
                <span className="text-info fw-semibold">💬 참여율</span>: 댓글 수 대비 좋아요 수 비율
              </small>
            </div>
          </div>

          <div className="table-responsive">
            <table className="table table-striped table-hover">
              <thead className="table-dark">
                <tr>
                  <th scope="col" style={{ width: '60px', minWidth: '60px', whiteSpace: 'nowrap' }}>#</th>
                  <th scope="col" style={{ width: '120px', minWidth: '120px', whiteSpace: 'nowrap' }}>썸네일</th>
                  <th 
                    scope="col" 
                    style={{ width: '400px', minWidth: '300px', cursor: 'pointer' }}
                    onClick={() => handleSort('title')}
                  >
                    제목{getSortIcon('title')}
                  </th>
                  <th 
                    scope="col" 
                    style={{ width: '140px', minWidth: '120px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                    onClick={() => handleSort('channelTitle')}
                  >
                    채널{getSortIcon('channelTitle')}
                  </th>
                  <th 
                    scope="col" 
                    style={{ width: '130px', minWidth: '110px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                    onClick={() => handleSort('subscriberCount')}
                  >
                    구독자수{getSortIcon('subscriberCount')}
                  </th>
                  <th 
                    scope="col" 
                    style={{ width: '170px', minWidth: '150px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                    onClick={() => handleSort('publishedAt')}
                  >
                    게시일{getSortIcon('publishedAt')}
                  </th>
                  <th 
                    scope="col" 
                    style={{ width: '110px', minWidth: '100px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                    onClick={() => handleSort('duration')}
                  >
                    재생시간{getSortIcon('duration')}
                  </th>
                  <th 
                    scope="col" 
                    style={{ width: '120px', minWidth: '100px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                    onClick={() => handleSort('viewCount')}
                  >
                    조회수{getSortIcon('viewCount')}
                  </th>
                  <th 
                    scope="col" 
                    style={{ width: '100px', minWidth: '90px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                    onClick={() => handleSort('likeCount')}
                  >
                    좋아요{getSortIcon('likeCount')}
                  </th>
                  <th 
                    scope="col" 
                    style={{ width: '100px', minWidth: '90px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                    onClick={() => handleSort('commentCount')}
                  >
                    댓글수{getSortIcon('commentCount')}
                  </th>
                  <th 
                    scope="col" 
                    style={{ width: '120px', minWidth: '110px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                    onClick={() => handleSort('viewSubscriberRatio')}
                  >
                    성과지표{getSortIcon('viewSubscriberRatio')}
                  </th>
                  <th scope="col" style={{ width: '110px', minWidth: '100px', whiteSpace: 'nowrap' }}>성과레벨</th>
                  <th 
                    scope="col" 
                    style={{ width: '110px', minWidth: '100px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                    onClick={() => handleSort('engagementRate')}
                  >
                    참여율{getSortIcon('engagementRate')}
                  </th>
                  <th scope="col" style={{ width: '110px', minWidth: '100px', whiteSpace: 'nowrap' }}>참여레벨</th>
                  <th 
                    scope="col" 
                    style={{ width: '90px', minWidth: '80px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                    onClick={() => handleSort('type')}
                  >
                    유형{getSortIcon('type')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {getSortedVideos(videos).map((video, index) => {
                  const ratioData = calculateViewSubscriberRatio(
                    video.statistics.viewCount, 
                    video.channelStatistics.subscriberCount
                  );
                  const engagementData = calculateEngagementRate(
                    video.statistics.likeCount,
                    video.statistics.commentCount || '0'
                  );
                  return (
                    <tr key={video.id}>
                      <td className="text-center">{index + 1}</td>
                      <td>
                        <a href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noopener noreferrer">
                          <img 
                            src={video.snippet.thumbnails.medium.url} 
                            alt={video.snippet.title}
                            className="img-thumbnail"
                            style={{ width: '80px', height: '60px', objectFit: 'cover' }}
                          />
                        </a>
                      </td>
                      <td>
                        <a 
                          href={`https://www.youtube.com/watch?v=${video.id}`} 
                          target="_blank" 
                          rel="noopener noreferrer" 
                          className="text-decoration-none text-dark fw-semibold"
                          style={{ 
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden'
                          }}
                        >
                          {video.snippet.title}
                        </a>
                      </td>
                      <td>
                        <a 
                          href={`https://www.youtube.com/channel/${video.snippet.channelId}`} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-primary text-decoration-none fw-medium small"
                        >
                          {video.snippet.channelTitle}
                        </a>
                      </td>
                      <td className="text-center">
                        <span className="badge bg-light text-dark">
                          {formatNumber(video.channelStatistics.subscriberCount)}
                        </span>
                      </td>
                      <td className="text-center text-muted small">
                        {formatPublishedAt(video.snippet.publishedAt)}
                      </td>
                      <td className="text-center">
                        <span className="badge bg-secondary">
                          {formatDuration(video.durationInSeconds)}
                        </span>
                      </td>
                      <td className="text-center fw-bold">
                        {formatNumber(video.statistics.viewCount)}
                      </td>
                      <td className="text-center fw-bold">
                        {formatNumber(video.statistics.likeCount)}
                      </td>
                      <td className="text-center fw-bold">
                        {formatNumber(video.statistics.commentCount || '0')}
                      </td>
                      <td className="text-center fw-bold">
                        {ratioData.ratio > 0 ? `${ratioData.ratio.toFixed(1)}배` : '계산불가'}
                      </td>
                      <td className="text-center">
                        <span className={`badge ${ratioData.color.replace('text-', 'bg-')} bg-opacity-10 ${ratioData.color}`}>
                          {ratioData.level}
                        </span>
                      </td>
                      <td className="text-center fw-bold">
                        {engagementData.ratio > 0 ? `${engagementData.ratio.toFixed(1)}배` : '계산불가'}
                      </td>
                      <td className="text-center">
                        <span className={`badge ${engagementData.color.replace('text-', 'bg-')} bg-opacity-10 ${engagementData.color}`}>
                          {engagementData.level}
                        </span>
                      </td>
                      <td className="text-center">
                        {video.isShorts ? (
                          <span className="badge bg-danger">쇼츠</span>
                        ) : (
                          <span className="badge bg-primary">롱폼</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="text-center mt-4">
            <small className="text-muted">
              총 {videos.length}개의 추천 동영상 • 
              현재 소스: {currentSource}
            </small>
          </div>
        </>
      )}
    </Layout>
  );
}