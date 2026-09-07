import { formatMetric } from '../utils/metrics';
import { useState, useEffect } from 'react';
import Head from 'next/head';
import axios from 'axios';
import Layout from '../components/Layout';
import FavoriteButton from '../components/FavoriteButton';
import FolderManager from '../components/FolderManager';
import CollectionStatus from '../components/CollectionStatus';
import AddChannelForm from '../components/AddChannelForm';
import {
  getFavoriteChannels,
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
  const [collectionNote, setCollectionNote] = useState('');
  const [syncMessage, setSyncMessage] = useState('');
  const [statusVersion, setStatusVersion] = useState(0);
  const [folderVersion, setFolderVersion] = useState(0);
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

  // 폴더 배지는 마운트 시 한 번만 세므로, 채널이 바뀌면 다시 세도록 알린다.
  const reloadAfterChannelChange = async () => {
    await loadFavoriteChannels();
    setFolderVersion(v => v + 1);
  };

  const handleFolderSelect = (folderId: string | null) => {
    setSelectedFolderId(folderId);
    setSelectedChannel(null);
  };

  const handleMoveChannel = async (channelId: string, targetFolderId: string | null) => {
    const success = await moveChannelToFolder(channelId, targetFolderId);
    if (success) {
      await reloadAfterChannelChange();
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
    setCollectionNote('');

    try {
      const response = await axios.get(`/api/channel-videos`, {
        params: {
          channelId: channel.channelId,
          maxResults: 20,
        },
      });

      setVideos(response.data.items || []);
      if (response.data.collectedAt) {
        setCollectionNote(`${response.data.source === 'database' ? '저장된 영상' : '실시간 조회'} · ${formatDate(response.data.collectedAt)}${response.data.stale ? ' · 갱신 지연: 마지막으로 수집한 정보를 표시합니다.' : ''}`);
      }
      if (!response.data.items || response.data.items.length === 0) {
        setError('최근 영상이 없습니다.');
      }

      // Viewing a channel must not advance the background notification cursor.
    } catch (err: any) {
      const message = err.response?.data?.message || '영상을 불러오는 데 실패했습니다.';
      setError(message);
      console.error(err);
    }

    setLoading(false);
  };

  // Run the next due batch; the scheduler continues independently of this page.
  const checkAllNewVideos = async () => {
    setCheckingNewVideos(true);
    setSyncMessage('수집할 채널을 확인하고 있습니다.');
    try {
      const response = await axios.post('/api/collection/run');
      const results = response.data.results || [];
      const succeeded = results.filter((r: {status: string}) => r.status === 'success').length;
      const failed = results.filter((r: {status: string}) => r.status === 'failed').length;
      setSyncMessage(results.length ? `${succeeded}개 채널 수집 완료${failed ? `, ${failed}개 실패. 자동으로 재시도합니다.` : '.'} 나머지 대상은 예약 순서대로 수집합니다.` : '현재 수집 예정 시각이 된 채널이 없습니다.');
      await loadFavoriteChannels();
      if (selectedChannel) await loadChannelVideos(selectedChannel);
    } catch (err: unknown) {
      setSyncMessage(axios.isAxiosError(err) ? err.response?.data?.message || '수집 요청에 실패했습니다.' : '수집 요청에 실패했습니다.');
    } finally {
      setCheckingNewVideos(false);
      setStatusVersion(v => v + 1);
    }
  };

  // 숫자 포맷팅
  const formatNumber = formatMetric;

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

      <div className="page-heading">
        <h2 className="display-6 fw-bold text-primary mb-2">즐겨찾기 채널</h2>
        <p className="lead text-muted">즐겨찾는 채널의 새로운 영상을 빠르게 확인하세요</p>
      </div>

      {/* 상단: 폴더 목록 */}
      <div className="mb-4">
        <CollectionStatus refreshKey={statusVersion} />
        {syncMessage && <p className="alert alert-info" role="status">{syncMessage}</p>}

        <FolderManager
          selectedFolderId={selectedFolderId}
          onSelectFolder={handleFolderSelect}
          refreshKey={folderVersion}
        />
      </div>

      <AddChannelForm folderId={selectedFolderId} onAdded={reloadAfterChannelChange} />

      {favoriteChannels.length === 0 ? (
        <div className="text-center py-5">
          <div style={{ fontSize: '5rem', opacity: 0.2 }}>⭐</div>
          <h4 className="text-muted mt-3">
            {selectedFolderId ? '이 폴더에 채널이 없습니다' : '즐겨찾기에 등록된 채널이 없습니다'}
          </h4>
          <p className="text-muted">
            위에서 채널 주소나 이름으로 추가하거나, 검색·추천 페이지에서 채널 옆의 ⭐ 버튼을 누르세요
          </p>
        </div>
      ) : (
        <div className="row">
          {/* 왼쪽: 채널 목록 (35%) */}
          <div className="favorites-channel-list mb-4">
            <div className="card shadow-sm">
              <div className="card-header bg-primary text-white d-flex justify-content-between align-items-center">
                <h5 className="mb-0">채널 목록 ({favoriteChannels.length})</h5>
                <button
                  className="btn btn-sm btn-light"
                  onClick={checkAllNewVideos}
                  disabled={checkingNewVideos}
                  title="수집 예정 시각이 된 채널을 최대 3개 수집"
                  aria-busy={checkingNewVideos}
                >
                  {checkingNewVideos ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-1" />
                      확인 중...
                    </>
                  ) : (
                    <>수집 실행</>
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
                          onToggle={() => reloadAfterChannelChange()}
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

          {/* 오른쪽: 선택된 채널의 영상 목록 (65%) */}
          <div className="favorites-channel-detail">
            {selectedChannel ? (
              <div className="card shadow-sm">
                <div className="card-header bg-light">
                  <h5 className="mb-0">{selectedChannel.channelTitle}의 최신 영상</h5>
                  {collectionNote && <p className="small text-muted mt-2 mb-0" role="status">{collectionNote}</p>}
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
        .favorites-channel-list,
        .favorites-channel-detail {
          min-width: 0;
          width: 100%;
        }
        @media (min-width: 768px) {
          .favorites-channel-list {
            flex: 0 0 35%;
            width: 35%;
          }
          .favorites-channel-detail {
            flex: 0 0 65%;
            width: 65%;
          }
        }
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
