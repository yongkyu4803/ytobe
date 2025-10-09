import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  getNotifications,
  getUnreadNotificationCount,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  clearAllNotifications,
  type VideoNotification,
} from '../utils/favoriteStorage';

export default function NotificationDropdown() {
  const [notifications, setNotifications] = useState<VideoNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showDropdown, setShowDropdown] = useState(false);

  // 알림 데이터 로드
  const loadNotifications = () => {
    setNotifications(getNotifications());
    setUnreadCount(getUnreadNotificationCount());
  };

  useEffect(() => {
    loadNotifications();

    // 5초마다 알림 갱신 (새로운 알림 확인)
    const interval = setInterval(loadNotifications, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleNotificationClick = (videoId: string) => {
    markNotificationAsRead(videoId);
    loadNotifications();
    setShowDropdown(false);
  };

  const handleMarkAllAsRead = () => {
    markAllNotificationsAsRead();
    loadNotifications();
  };

  const handleClearAll = () => {
    if (confirm('모든 알림을 삭제하시겠습니까?')) {
      clearAllNotifications();
      loadNotifications();
    }
  };

  const formatTimeAgo = (dateString: string): string => {
    const now = new Date();
    const past = new Date(dateString);
    const diffMs = now.getTime() - past.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return '방금 전';
    if (diffMins < 60) return `${diffMins}분 전`;
    if (diffHours < 24) return `${diffHours}시간 전`;
    if (diffDays < 7) return `${diffDays}일 전`;
    return past.toLocaleDateString('ko-KR');
  };

  return (
    <div className="position-relative">
      {/* 알림 벨 버튼 */}
      <button
        className="btn btn-outline-light position-relative"
        onClick={() => setShowDropdown(!showDropdown)}
        style={{ border: 'none' }}
      >
        <span style={{ fontSize: '1.5rem' }}>🔔</span>
        {unreadCount > 0 && (
          <span
            className="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger"
            style={{ fontSize: '0.7rem' }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* 드롭다운 메뉴 */}
      {showDropdown && (
        <>
          {/* 배경 클릭 시 닫기 */}
          <div
            className="position-fixed top-0 start-0 w-100 h-100"
            style={{ zIndex: 1040 }}
            onClick={() => setShowDropdown(false)}
          />

          {/* 알림 목록 */}
          <div
            className="position-absolute end-0 bg-white shadow-lg rounded-3 border"
            style={{
              width: '380px',
              maxHeight: '500px',
              zIndex: 1050,
              top: 'calc(100% + 0.5rem)',
            }}
          >
            {/* 헤더 */}
            <div className="d-flex justify-content-between align-items-center p-3 border-bottom bg-light rounded-top">
              <h6 className="mb-0 fw-bold text-dark">알림</h6>
              <div className="d-flex gap-2">
                {unreadCount > 0 && (
                  <button
                    className="btn btn-sm btn-outline-primary"
                    onClick={handleMarkAllAsRead}
                    title="모두 읽음으로 표시"
                  >
                    ✓ 모두 읽음
                  </button>
                )}
                {notifications.length > 0 && (
                  <button
                    className="btn btn-sm btn-outline-danger"
                    onClick={handleClearAll}
                    title="모든 알림 삭제"
                  >
                    🗑️
                  </button>
                )}
              </div>
            </div>

            {/* 알림 목록 */}
            <div
              className="overflow-auto"
              style={{ maxHeight: '420px' }}
            >
              {notifications.length === 0 ? (
                <div className="text-center py-5 text-muted">
                  <div style={{ fontSize: '3rem', opacity: 0.3 }}>🔕</div>
                  <p className="mb-0 mt-2">새로운 알림이 없습니다</p>
                </div>
              ) : (
                notifications.map((notification) => (
                  <Link
                    key={notification.videoId}
                    href={`https://www.youtube.com/watch?v=${notification.videoId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-decoration-none"
                    onClick={() => handleNotificationClick(notification.videoId)}
                  >
                    <div
                      className={`p-3 border-bottom ${
                        notification.isRead ? 'bg-white' : 'bg-primary bg-opacity-10'
                      } hover-bg-light`}
                      style={{
                        cursor: 'pointer',
                        transition: 'background-color 0.2s',
                      }}
                    >
                      <div className="d-flex gap-3">
                        {/* 썸네일 */}
                        <img
                          src={notification.thumbnailUrl}
                          alt={notification.videoTitle}
                          className="rounded"
                          style={{
                            width: '100px',
                            height: '56px',
                            objectFit: 'cover',
                            flexShrink: 0,
                          }}
                        />

                        {/* 알림 내용 */}
                        <div className="flex-grow-1 overflow-hidden">
                          <div className="d-flex align-items-start justify-content-between gap-2">
                            <p
                              className="mb-1 fw-semibold text-dark small"
                              style={{
                                display: '-webkit-box',
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden',
                                lineHeight: '1.3',
                              }}
                            >
                              {notification.videoTitle}
                            </p>
                            {!notification.isRead && (
                              <span
                                className="badge bg-primary rounded-circle"
                                style={{ width: '8px', height: '8px', padding: 0 }}
                                title="읽지 않음"
                              />
                            )}
                          </div>
                          <p className="mb-1 text-muted small">{notification.channelTitle}</p>
                          <p className="mb-0 text-muted" style={{ fontSize: '0.75rem' }}>
                            {formatTimeAgo(notification.publishedAt)}
                          </p>
                        </div>
                      </div>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>
        </>
      )}

      <style jsx>{`
        .hover-bg-light:hover {
          background-color: #f8f9fa !important;
        }
      `}</style>
    </div>
  );
}
