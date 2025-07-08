import { useState, FormEvent, useEffect } from 'react';
import axios from 'axios';
import Head from 'next/head';

interface VideoStatistics {
  viewCount: string;
  likeCount: string;
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

// 숫자를 천 단위 콤마와 '만', '억' 단위로 포맷팅하는 함수
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

// 영상 길이를 포맷팅하는 함수
const formatDuration = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

// 게시일을 상대적 시간으로 포맷팅하는 함수
const formatPublishedAt = (publishedAt: string): string => {
  const now = new Date();
  const published = new Date(publishedAt);
  const diffMs = now.getTime() - published.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  
  if (diffDays > 365) {
    const years = Math.floor(diffDays / 365);
    return `${years}년 전`;
  } else if (diffDays > 30) {
    const months = Math.floor(diffDays / 30);
    return `${months}개월 전`;
  } else if (diffDays > 0) {
    return `${diffDays}일 전`;
  } else if (diffHours > 0) {
    return `${diffHours}시간 전`;
  } else if (diffMinutes > 0) {
    return `${diffMinutes}분 전`;
  } else {
    return '방금 전';
  }
};

// 구독자 대비 조회수 비율 계산 함수
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

export default function Home() {
  const [query, setQuery] = useState('');
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'shorts' | 'longform'>('all');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'week' | 'month' | 'year'>('all');
  const [lastSearchQuery, setLastSearchQuery] = useState('');

  const getPublishedAfterDate = (dateFilter: string): string | null => {
    const now = new Date();
    let date: Date;
    
    switch (dateFilter) {
      case 'today':
        date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'week':
        date = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        date = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'year':
        date = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        return null;
    }
    
    return date.toISOString();
  };

  const performSearch = async (searchQuery: string, currentDateFilter: string) => {
    if (!searchQuery.trim()) {
      setError('검색어를 입력해주세요.');
      return;
    }
    setLoading(true);
    setError('');
    setVideos([]);

    try {
      let apiUrl = `/api/youtube?query=${searchQuery}`;
      
      const publishedAfter = getPublishedAfterDate(currentDateFilter);
      if (publishedAfter) {
        apiUrl += `&publishedAfter=${publishedAfter}`;
      }
      
      console.log('Searching with URL:', apiUrl);
      
      const response = await axios.get(apiUrl);
      setVideos(response.data.items || []);
      if (!response.data.items || response.data.items.length === 0) {
        setError('검색 결과가 없습니다.');
      }
    } catch (err: any) {
      const message = err.response?.data?.message || '영상을 불러오는 데 실패했습니다. API 키 할당량을 확인해주세요.';
      setError(message);
      console.error(err);
    }

    setLoading(false);
  };

  const searchVideos = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLastSearchQuery(query);
    await performSearch(query, dateFilter);
  };

  // 날짜 필터가 변경될 때 자동으로 재검색
  useEffect(() => {
    if (lastSearchQuery.trim()) {
      performSearch(lastSearchQuery, dateFilter);
    }
  }, [dateFilter]);

  return (
    <div className="container-fluid mt-5 px-4">
      <Head>
        <title>유튜브 인기 동영상 검색</title>
        <meta name="description" content="조회수 높은 유튜브 동영상을 검색하고 확인하세요." />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className="text-center">
        <h1 className="mb-4">유튜브 인기 동영상 검색</h1>

        <form onSubmit={searchVideos} className="mb-4">
          <div className="input-group" style={{ maxWidth: '600px', margin: 'auto' }}>
            <input
              type="text"
              className="form-control"
              placeholder="검색어를 입력하세요..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? (
                <>
                  <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                  <span className="visually-hidden">Loading...</span>
                </>
              ) : (
                '검색'
              )}
            </button>
          </div>
        </form>

        {videos.length > 0 && (
          <div className="d-flex justify-content-center gap-3 mb-4">
            <div className="dropdown">
              <button
                className="btn btn-outline-secondary dropdown-toggle"
                type="button"
                id="filterDropdown"
                data-bs-toggle="dropdown"
                aria-expanded="false"
              >
                {filterType === 'all' ? '전체' : filterType === 'shorts' ? '쇼츠만' : '롱폼만'}
              </button>
              <ul className="dropdown-menu" aria-labelledby="filterDropdown">
                <li>
                  <button
                    className={`dropdown-item ${filterType === 'all' ? 'active' : ''}`}
                    onClick={() => setFilterType('all')}
                  >
                    전체
                  </button>
                </li>
                <li>
                  <button
                    className={`dropdown-item ${filterType === 'shorts' ? 'active' : ''}`}
                    onClick={() => setFilterType('shorts')}
                  >
                    쇼츠만
                  </button>
                </li>
                <li>
                  <button
                    className={`dropdown-item ${filterType === 'longform' ? 'active' : ''}`}
                    onClick={() => setFilterType('longform')}
                  >
                    롱폼만
                  </button>
                </li>
              </ul>
            </div>
            
            <div className="dropdown">
              <button
                className="btn btn-outline-secondary dropdown-toggle"
                type="button"
                id="dateFilterDropdown"
                data-bs-toggle="dropdown"
                aria-expanded="false"
              >
                {dateFilter === 'all' ? '전체 기간' : 
                 dateFilter === 'today' ? '오늘' : 
                 dateFilter === 'week' ? '이번 주' : 
                 dateFilter === 'month' ? '이번 달' : 
                 dateFilter === 'year' ? '올해' : '전체 기간'}
              </button>
              <ul className="dropdown-menu" aria-labelledby="dateFilterDropdown">
                <li>
                  <button
                    className={`dropdown-item ${dateFilter === 'all' ? 'active' : ''}`}
                    onClick={() => setDateFilter('all')}
                  >
                    전체 기간
                  </button>
                </li>
                <li>
                  <button
                    className={`dropdown-item ${dateFilter === 'today' ? 'active' : ''}`}
                    onClick={() => setDateFilter('today')}
                  >
                    오늘
                  </button>
                </li>
                <li>
                  <button
                    className={`dropdown-item ${dateFilter === 'week' ? 'active' : ''}`}
                    onClick={() => setDateFilter('week')}
                  >
                    이번 주
                  </button>
                </li>
                <li>
                  <button
                    className={`dropdown-item ${dateFilter === 'month' ? 'active' : ''}`}
                    onClick={() => setDateFilter('month')}
                  >
                    이번 달
                  </button>
                </li>
                <li>
                  <button
                    className={`dropdown-item ${dateFilter === 'year' ? 'active' : ''}`}
                    onClick={() => setDateFilter('year')}
                  >
                    올해
                  </button>
                </li>
              </ul>
            </div>
          </div>
        )}

        {error && <p className="text-danger mt-3">{error}</p>}

        <div className="row row-cols-1 row-cols-sm-2 row-cols-md-3 row-cols-lg-4 row-cols-xl-5 g-4 mt-4">
          {videos
            .filter(video => {
              if (filterType === 'all') return true;
              if (filterType === 'shorts') return video.isShorts;
              if (filterType === 'longform') return !video.isShorts;
              return true;
            })
            .map((video) => (
            <div key={video.id} className="col">
              <div className="card h-100">
                <div className="position-relative">
                  <a href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noopener noreferrer">
                    <img 
                      src={video.snippet.thumbnails.medium.url} 
                      className="card-img-top" 
                      alt={video.snippet.title} 
                    />
                  </a>
                  <div className="position-absolute top-0 start-0 p-2">
                    {video.isShorts ? (
                      <span className="badge bg-danger">쇼츠</span>
                    ) : (
                      <span className="badge bg-primary">롱폼</span>
                    )}
                  </div>
                  <div className="position-absolute bottom-0 end-0 p-2">
                    <span className="badge bg-dark bg-opacity-75">
                      {formatDuration(video.durationInSeconds)}
                    </span>
                  </div>
                </div>
                <div className="card-body d-flex flex-column p-3">
                  <h5 className="card-title mb-3 lh-sm">
                    <a href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noopener noreferrer" className="text-decoration-none text-dark fw-semibold">
                      {video.snippet.title}
                    </a>
                  </h5>
                  
                  <div className="mt-auto">
                    {/* 채널 정보 */}
                    <div className="d-flex align-items-center mb-2">
                      <a 
                        href={`https://www.youtube.com/channel/${video.snippet.channelId}`} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-primary fw-medium small me-2 text-decoration-none"
                      >
                        🎭 {video.snippet.channelTitle}
                      </a>
                      <span className="badge bg-light text-dark small">
                        {formatNumber(video.channelStatistics.subscriberCount)} 구독자
                      </span>
                    </div>
                    
                    {/* 게시일 */}
                    <div className="mb-3">
                      <span className="text-muted small">
                        📅 {formatPublishedAt(video.snippet.publishedAt)}
                      </span>
                    </div>
                    
                    {/* 통계 정보 */}
                    <div className="row g-2 mb-2">
                      <div className="col-6">
                        <div className="bg-light rounded p-2 text-center">
                          <div className="text-muted small mb-1">👁️ 조회수</div>
                          <div className="fw-bold text-dark small">
                            {formatNumber(video.statistics.viewCount)}
                          </div>
                        </div>
                      </div>
                      <div className="col-6">
                        <div className="bg-light rounded p-2 text-center">
                          <div className="text-muted small mb-1">❤️ 좋아요</div>
                          <div className="fw-bold text-dark small">
                            {formatNumber(video.statistics.likeCount)}
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    {/* 구독자 대비 조회수 비율 */}
                    {(() => {
                      const ratioData = calculateViewSubscriberRatio(
                        video.statistics.viewCount, 
                        video.channelStatistics.subscriberCount
                      );
                      return (
                        <div className="border rounded p-2 text-center">
                          <div className="text-muted small mb-1">📊 구독자 대비 조회수</div>
                          <div className="d-flex justify-content-between align-items-center">
                            <span className="fw-bold small text-dark">
                              {ratioData.ratio > 0 ? `${ratioData.ratio.toFixed(1)}배` : '계산불가'}
                            </span>
                            <span className={`badge ${ratioData.color.replace('text-', 'bg-')} bg-opacity-10 ${ratioData.color} small`}>
                              {ratioData.level}
                            </span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>
            </div>
            ))}
        </div>
      </main>
    </div>
  );
}