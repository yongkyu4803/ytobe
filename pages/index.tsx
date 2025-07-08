import { useState, FormEvent, useEffect } from 'react';
import axios from 'axios';
import Head from 'next/head';

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

// 게시일을 실제 날짜로 포맷팅하는 함수
const formatPublishedAt = (publishedAt: string): string => {
  const published = new Date(publishedAt);
  const year = published.getFullYear();
  const month = String(published.getMonth() + 1).padStart(2, '0');
  const day = String(published.getDate()).padStart(2, '0');
  const hours = String(published.getHours()).padStart(2, '0');
  const minutes = String(published.getMinutes()).padStart(2, '0');
  
  return `${year}-${month}-${day} ${hours}:${minutes}`;
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

// 참여율 계산 함수 (댓글 수 대비 좋아요 수)
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

type SortField = 'index' | 'title' | 'channelTitle' | 'subscriberCount' | 'publishedAt' | 'duration' | 'viewCount' | 'likeCount' | 'commentCount' | 'viewSubscriberRatio' | 'engagementRate' | 'type';
type SortOrder = 'asc' | 'desc';

export default function Home() {
  const [query, setQuery] = useState('');
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'shorts' | 'longform'>('all');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'week' | 'month' | 'year'>('all');
  const [lastSearchQuery, setLastSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('viewCount');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

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

        <div className="table-responsive mt-4">
          <table className="table table-striped table-hover">
            <thead className="table-dark">
              <tr>
                <th scope="col" style={{ width: '60px' }}>#</th>
                <th scope="col" style={{ width: '120px' }}>썸네일</th>
                <th 
                  scope="col" 
                  style={{ width: '300px', cursor: 'pointer' }}
                  onClick={() => handleSort('title')}
                >
                  제목{getSortIcon('title')}
                </th>
                <th 
                  scope="col" 
                  style={{ width: '120px', cursor: 'pointer' }}
                  onClick={() => handleSort('channelTitle')}
                >
                  채널{getSortIcon('channelTitle')}
                </th>
                <th 
                  scope="col" 
                  style={{ width: '100px', cursor: 'pointer' }}
                  onClick={() => handleSort('subscriberCount')}
                >
                  구독자 수{getSortIcon('subscriberCount')}
                </th>
                <th 
                  scope="col" 
                  style={{ width: '140px', cursor: 'pointer' }}
                  onClick={() => handleSort('publishedAt')}
                >
                  게시일{getSortIcon('publishedAt')}
                </th>
                <th 
                  scope="col" 
                  style={{ width: '80px', cursor: 'pointer' }}
                  onClick={() => handleSort('duration')}
                >
                  재생 시간{getSortIcon('duration')}
                </th>
                <th 
                  scope="col" 
                  style={{ width: '100px', cursor: 'pointer' }}
                  onClick={() => handleSort('viewCount')}
                >
                  조회수{getSortIcon('viewCount')}
                </th>
                <th 
                  scope="col" 
                  style={{ width: '80px', cursor: 'pointer' }}
                  onClick={() => handleSort('likeCount')}
                >
                  좋아요{getSortIcon('likeCount')}
                </th>
                <th 
                  scope="col" 
                  style={{ width: '80px', cursor: 'pointer' }}
                  onClick={() => handleSort('commentCount')}
                >
                  댓글수{getSortIcon('commentCount')}
                </th>
                <th 
                  scope="col" 
                  style={{ width: '100px', cursor: 'pointer' }}
                  onClick={() => handleSort('viewSubscriberRatio')}
                >
                  성과 지표{getSortIcon('viewSubscriberRatio')}
                </th>
                <th scope="col" style={{ width: '80px' }}>성과 레벨</th>
                <th 
                  scope="col" 
                  style={{ width: '100px', cursor: 'pointer' }}
                  onClick={() => handleSort('engagementRate')}
                >
                  참여율{getSortIcon('engagementRate')}
                </th>
                <th scope="col" style={{ width: '80px' }}>참여 레벨</th>
                <th 
                  scope="col" 
                  style={{ width: '80px', cursor: 'pointer' }}
                  onClick={() => handleSort('type')}
                >
                  유형{getSortIcon('type')}
                </th>
              </tr>
            </thead>
            <tbody>
              {getSortedVideos(videos
                .filter(video => {
                  if (filterType === 'all') return true;
                  if (filterType === 'shorts') return video.isShorts;
                  if (filterType === 'longform') return !video.isShorts;
                  return true;
                }))
                .map((video, index) => {
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
      </main>
    </div>
  );
}