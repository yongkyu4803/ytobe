import { useState } from 'react';
import axios from 'axios';
import Head from 'next/head';

// 숫자를 천 단위 콤마와 '만', '억' 단위로 포맷팅하는 함수
const formatNumber = (numStr) => {
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

export default function Home() {
  const [query, setQuery] = useState('');
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const searchVideos = async (e) => {
    e.preventDefault();
    if (!query.trim()) {
      setError('검색어를 입력해주세요.');
      return;
    }
    setLoading(true);
    setError('');
    setVideos([]);

    try {
      const response = await axios.get(`/api/youtube?query=${query}`);
      setVideos(response.data.items || []);
      if (!response.data.items || response.data.items.length === 0) {
        setError('검색 결과가 없습니다.');
      }
    } catch (err) {
      const message = err.response?.data?.message || '영상을 불러오는 데 실패했습니다. API 키 할당량을 확인해주세요.';
      setError(message);
      console.error(err);
    }

    setLoading(false);
  };

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

        {error && <p className="text-danger mt-3">{error}</p>}

        <div className="row row-cols-1 row-cols-sm-2 row-cols-md-3 row-cols-lg-4 row-cols-xl-5 g-4 mt-4">
          {videos.map((video) => (
            <div key={video.id} className="col">
              <div className="card h-100">
                <a href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noopener noreferrer">
                  <img 
                    src={video.snippet.thumbnails.medium.url} 
                    className="card-img-top" 
                    alt={video.snippet.title} 
                  />
                </a>
                <div className="card-body d-flex flex-column">
                  <h5 className="card-title small">
                    <a href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noopener noreferrer" className="text-decoration-none text-dark">
                      {video.snippet.title}
                    </a>
                  </h5>
                  <div className="mt-auto">
                    <p className="card-text text-muted small mb-1">{video.snippet.channelTitle}</p>
                    <p className="card-text text-muted small mb-2">구독자 {formatNumber(video.channelStatistics.subscriberCount)}명</p>
                    <div className="d-flex justify-content-between align-items-center">
                        <span className="text-danger small">❤️ {formatNumber(video.statistics.likeCount)}</span>
                        <span className="text-muted small">조회수 {formatNumber(video.statistics.viewCount)}회</span>
                    </div>
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