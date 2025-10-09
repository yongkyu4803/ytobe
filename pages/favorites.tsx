import { useState, useEffect } from 'react';
import Head from 'next/head';
import axios from 'axios';
import Layout from '../components/Layout';
import FavoriteButton from '../components/FavoriteButton';
import FolderManager from '../components/FolderManager';
import {
  getFavoriteChannels,
  updateChannelLastChecked,
  addNotification,
  moveChannelToFolder,
  getFolders,
  type FavoriteChannel,
  type FavoriteFolder,
} from '../utils/supabaseFavorites';

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

export default function FavoritesPage() {
  const [favoriteChannels, setFavoriteChannels] = useState<FavoriteChannel[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<FavoriteChannel | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [folders, setFolders] = useState<FavoriteFolder[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [checkingNewVideos, setCheckingNewVideos] = useState(false);
  const [showFolderSelector, setShowFolderSelector] = useState(false);
  const [movingChannelId, setMovingChannelId] = useState<string | null>(null);

  // 폴더 및 채널 목록 로드
  useEffect(() => {
    loadFolders();
    loadFavoriteChannels();
  }, []);

  // 선택된 폴더가 변경되면 채널 목록 다시 로드
  useEffect(() => {
    loadFavoriteChannels();
  }, [selectedFolderId]);

  const loadFolders = async () => {
    const data = await getFolders();
    setFolders(data);
  };

  const loadFavoriteChannels = async () => {
    const channels = await getFavoriteChannels(selectedFolderId || undefined);
    setFavoriteChannels(channels);
  };

  const handleFolderSelect = (folderId: string | null) => {
    setSelectedFolderId(folderId);
    setSelectedChannel(null);
  };

  const handleMoveChannel = async (channelId: string, targetFolderId: string | null) => {
    const success = await moveChannelToFolder(channelId, targetFolderId);
    if (success) {
      await loadFavoriteChannels();
      setShowFolderSelector(false);
      setMovingChannelId(null);
    } else {
      alert('채널 이동에 실패했습니다.');
    }
  };

  // 특정 채널의 영상 조회
  const loadChannelVideos = async (channel: FavoriteChannel) => {
    setSelectedChannel(channel);
    setLoading(true);
    setError('');
    setVideos([]);

    try {
      const response = await axios.get(`/api/channel-videos`, {
        params: {
          channelId: channel.channelId,
          maxResults: 20,
        },
      });

      setVideos(response.data.items || []);
      if (!response.data.items || response.data.items.length === 0) {
        setError('최근 영상이 없습니다.');
      }

      // 마지막 확인 시간 업데이트
      await updateChannelLastChecked(channel.channelId);
    } catch (err: any) {
      const message = err.response?.data?.message || '영상을 불러오는 데 실패했습니다.';
      setError(message);
      console.error(err);
    }

    setLoading(false);
  };

  // 모든 즐겨찾기 채널의 새 영상 확인
  const checkAllNewVideos = async () => {
    if (favoriteChannels.length === 0) {
      alert('즐겨찾기에 등록된 채널이 없습니다.');
      return;
    }

    setCheckingNewVideos(true);
    let totalNewVideos = 0;

    try {
      for (const channel of favoriteChannels) {
        const lastChecked = channel.lastChecked || channel.addedAt;

        const response = await axios.get(`/api/channel-videos`, {
          params: {
            channelId: channel.channelId,
            maxResults: 5,
            publishedAfter: lastChecked,
          },
        });

        const newVideos = response.data.items || [];

        // 새 영상이 있으면 알림 추가
        for (const video of newVideos) {
          const success = await addNotification({
            videoId: video.id,
            videoTitle: video.snippet.title,
            channelId: video.snippet.channelId,
            channelTitle: video.snippet.channelTitle,
            publishedAt: video.snippet.publishedAt,
            thumbnailUrl: video.snippet.thumbnails.medium.url,
          });

          if (success) totalNewVideos++;
        }

        // 마지막 확인 시간 업데이트
        await updateChannelLastChecked(channel.channelId);
      }

      loadFavoriteChannels(); // 상태 갱신

      if (totalNewVideos > 0) {
        alert(`${totalNewVideos}개의 새로운 영상을 발견했습니다! 🔔`);
      } else {
        alert('새로운 영상이 없습니다. ✅');
      }
    } catch (err) {
      console.error('새 영상 확인 중 오류:', err);
      alert('새 영상 확인 중 오류가 발생했습니다.');
    }

    setCheckingNewVideos(false);
  };

  // 숫자 포맷팅
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

  // 날짜 포맷팅
  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <Layout>
      <Head>
        <title>즐겨찾기 채널 - YouTube Analytics</title>
        <meta name="description" content="즐겨찾기 채널의 최신 영상을 확인하고 알림을 받으세요" />
      </Head>

      <div className="text-center mb-5">
        <h2 className="display-6 fw-bold text-primary mb-2">⭐ 즐겨찾기 채널</h2>
        <p className="lead text-muted">즐겨찾는 채널의 새로운 영상을 빠르게 확인하세요</p>
      </div>

      {/* 상단: 폴더 목록 */}
      <div className="mb-4">
        <FolderManager
          selectedFolderId={selectedFolderId}
          onSelectFolder={handleFolderSelect}
        />
      </div>

      {favoriteChannels.length === 0 ? (
        <div className="text-center py-5">
          <div style={{ fontSize: '5rem', opacity: 0.2 }}>⭐</div>
          <h4 className="text-muted mt-3">
            {selectedFolderId ? '이 폴더에 채널이 없습니다' : '즐겨찾기에 등록된 채널이 없습니다'}
          </h4>
          <p className="text-muted">
            검색 결과나 추천 페이지에서 채널 옆의 ⭐ 버튼을 눌러 즐겨찾기를 추가하세요
          </p>
        </div>
      ) : (
        <div className="row">
          {/* 왼쪽: 채널 목록 (30%) */}
          <div className="col-md-3 mb-4">
            <div className="card shadow-sm">
              <div className="card-header bg-primary text-white d-flex justify-content-between align-items-center">
                <h5 className="mb-0">채널 목록 ({favoriteChannels.length})</h5>
                <button
                  className="btn btn-sm btn-light"
                  onClick={checkAllNewVideos}
                  disabled={checkingNewVideos}
                  title="모든 채널의 새 영상 확인"
                >
                  {checkingNewVideos ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-1" />
                      확인 중...
                    </>
                  ) : (
                    <>🔔 새 영상 확인</>
                  )}
                </button>
              </div>
              <div className="list-group list-group-flush" style={{ maxHeight: '600px', overflowY: 'auto' }}>
                {favoriteChannels.map((channel) => (
                  <div
                    key={channel.channelId}
                    className={`list-group-item list-group-item-action ${
                      selectedChannel?.channelId === channel.channelId ? 'active' : ''
                    }`}
                    onClick={() => loadChannelVideos(channel)}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="d-flex justify-content-between align-items-center">
                      <div className="flex-grow-1">
                        <h6 className="mb-1">{channel.channelTitle}</h6>
                        <small className={selectedChannel?.channelId === channel.channelId ? 'text-white-50' : 'text-muted'}>
                          구독자 {formatNumber(channel.subscriberCount)}
                        </small>
                      </div>
                      <div className="d-flex gap-1">
                        <button
                          className="btn btn-sm btn-outline-secondary"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMovingChannelId(channel.channelId);
                            setShowFolderSelector(true);
                          }}
                          title="폴더 이동"
                        >
                          📁
                        </button>
                        <FavoriteButton
                          channelId={channel.channelId}
                          channelTitle={channel.channelTitle}
                          subscriberCount={channel.subscriberCount}
                          size="sm"
                          onToggle={() => loadFavoriteChannels()}
                        />
                      </div>
                    </div>
                    {channel.lastChecked && (
                      <small className={selectedChannel?.channelId === channel.channelId ? 'text-white-50' : 'text-muted'}>
                        마지막 확인: {formatDate(channel.lastChecked)}
                      </small>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 오른쪽: 선택된 채널의 영상 목록 (70%) */}
          <div className="col-md-9">
            {selectedChannel ? (
              <div className="card shadow-sm">
                <div className="card-header bg-light">
                  <h5 className="mb-0">{selectedChannel.channelTitle}의 최신 영상</h5>
                </div>
                <div className="card-body">
                  {loading ? (
                    <div className="text-center py-5">
                      <div className="spinner-border text-primary" role="status">
                        <span className="visually-hidden">로딩 중...</span>
                      </div>
                      <p className="mt-3 text-muted">영상을 불러오는 중...</p>
                    </div>
                  ) : error ? (
                    <div className="alert alert-warning">{error}</div>
                  ) : videos.length === 0 ? (
                    <div className="text-center py-5 text-muted">
                      <p>영상이 없습니다</p>
                    </div>
                  ) : (
                    <div className="row g-3">
                      {videos.map((video) => (
                        <div key={video.id} className="col-md-3">
                          <div className="card h-100 shadow-sm hover-shadow">
                            <a
                              href={`https://www.youtube.com/watch?v=${video.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-decoration-none"
                            >
                              <img
                                src={video.snippet.thumbnails.medium.url}
                                alt={video.snippet.title}
                                className="card-img-top"
                                style={{ height: '180px', objectFit: 'cover' }}
                              />
                              <div className="card-body">
                                <h6
                                  className="card-title text-dark"
                                  style={{
                                    display: '-webkit-box',
                                    WebkitLineClamp: 2,
                                    WebkitBoxOrient: 'vertical',
                                    overflow: 'hidden',
                                  }}
                                >
                                  {video.snippet.title}
                                </h6>
                                <div className="d-flex justify-content-between align-items-center mt-2">
                                  <small className="text-muted">
                                    👁️ {formatNumber(video.statistics.viewCount)}
                                  </small>
                                  <small className="text-muted">
                                    {formatDate(video.snippet.publishedAt)}
                                  </small>
                                </div>
                                {video.isShorts && (
                                  <span className="badge bg-danger mt-2">쇼츠</span>
                                )}
                              </div>
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="card shadow-sm">
                <div className="card-body text-center py-5">
                  <div style={{ fontSize: '4rem', opacity: 0.2 }}>📺</div>
                  <h5 className="text-muted mt-3">왼쪽에서 채널을 선택하세요</h5>
                  <p className="text-muted">선택한 채널의 최신 영상을 확인할 수 있습니다</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 폴더 선택 모달 */}
      {showFolderSelector && movingChannelId && (
        <>
          <div
            className="modal-backdrop fade show"
            onClick={() => {
              setShowFolderSelector(false);
              setMovingChannelId(null);
            }}
            style={{ zIndex: 1040 }}
          />
          <div
            className="modal fade show d-block"
            tabIndex={-1}
            style={{ zIndex: 1050 }}
          >
            <div className="modal-dialog modal-dialog-centered">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">폴더 선택</h5>
                  <button
                    type="button"
                    className="btn-close"
                    onClick={() => {
                      setShowFolderSelector(false);
                      setMovingChannelId(null);
                    }}
                  />
                </div>
                <div className="modal-body">
                  <p className="text-muted mb-3">채널을 이동할 폴더를 선택하세요</p>
                  <div className="list-group">
                    <button
                      className="list-group-item list-group-item-action"
                      onClick={() => handleMoveChannel(movingChannelId, null)}
                    >
                      <span className="me-2">📂</span>
                      <strong>미분류</strong>
                    </button>
                    {folders.map((folder) => (
                      <button
                        key={folder.id}
                        className="list-group-item list-group-item-action"
                        onClick={() => handleMoveChannel(movingChannelId, folder.id)}
                      >
                        <span className="me-2">{folder.icon}</span>
                        <strong>{folder.name}</strong>
                        {folder.description && (
                          <small className="d-block text-muted">{folder.description}</small>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      <style jsx>{`
        .hover-shadow {
          transition: box-shadow 0.3s ease;
        }
        .hover-shadow:hover {
          box-shadow: 0 0.5rem 1rem rgba(0, 0, 0, 0.15) !important;
        }
      `}</style>
    </Layout>
  );
}
