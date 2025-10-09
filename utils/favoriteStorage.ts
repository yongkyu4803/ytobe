// 즐겨찾기 채널 및 알림 관리를 위한 TypeScript 인터페이스와 유틸리티

export interface FavoriteChannel {
  channelId: string;
  channelTitle: string;
  channelThumbnail?: string;
  subscriberCount: string;
  addedAt: string; // ISO 날짜 문자열
  lastChecked?: string; // 마지막 새 영상 확인 시간
}

export interface VideoNotification {
  videoId: string;
  videoTitle: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  thumbnailUrl: string;
  isRead: boolean;
  notifiedAt: string; // 알림 생성 시간
}

const STORAGE_KEYS = {
  FAVORITES: 'youtube_favorite_channels',
  NOTIFICATIONS: 'youtube_video_notifications',
  LAST_CHECK: 'youtube_last_notification_check',
};

// === 즐겨찾기 채널 관리 ===

/**
 * 모든 즐겨찾기 채널 조회
 */
export function getFavoriteChannels(): FavoriteChannel[] {
  if (typeof window === 'undefined') return [];

  try {
    const stored = localStorage.getItem(STORAGE_KEYS.FAVORITES);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('즐겨찾기 채널 조회 실패:', error);
    return [];
  }
}

/**
 * 채널이 즐겨찾기에 있는지 확인
 */
export function isFavoriteChannel(channelId: string): boolean {
  const favorites = getFavoriteChannels();
  return favorites.some(fav => fav.channelId === channelId);
}

/**
 * 즐겨찾기 채널 추가
 */
export function addFavoriteChannel(channel: Omit<FavoriteChannel, 'addedAt' | 'lastChecked'>): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const favorites = getFavoriteChannels();

    // 중복 체크
    if (favorites.some(fav => fav.channelId === channel.channelId)) {
      console.warn('이미 즐겨찾기에 추가된 채널입니다.');
      return false;
    }

    const newFavorite: FavoriteChannel = {
      ...channel,
      addedAt: new Date().toISOString(),
    };

    favorites.push(newFavorite);
    localStorage.setItem(STORAGE_KEYS.FAVORITES, JSON.stringify(favorites));
    return true;
  } catch (error) {
    console.error('즐겨찾기 추가 실패:', error);
    return false;
  }
}

/**
 * 즐겨찾기 채널 삭제
 */
export function removeFavoriteChannel(channelId: string): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const favorites = getFavoriteChannels();
    const filtered = favorites.filter(fav => fav.channelId !== channelId);

    if (filtered.length === favorites.length) {
      console.warn('삭제할 채널을 찾을 수 없습니다.');
      return false;
    }

    localStorage.setItem(STORAGE_KEYS.FAVORITES, JSON.stringify(filtered));

    // 해당 채널의 알림도 삭제
    removeNotificationsByChannel(channelId);
    return true;
  } catch (error) {
    console.error('즐겨찾기 삭제 실패:', error);
    return false;
  }
}

/**
 * 채널의 마지막 확인 시간 업데이트
 */
export function updateChannelLastChecked(channelId: string): void {
  if (typeof window === 'undefined') return;

  try {
    const favorites = getFavoriteChannels();
    const updated = favorites.map(fav =>
      fav.channelId === channelId
        ? { ...fav, lastChecked: new Date().toISOString() }
        : fav
    );

    localStorage.setItem(STORAGE_KEYS.FAVORITES, JSON.stringify(updated));
  } catch (error) {
    console.error('마지막 확인 시간 업데이트 실패:', error);
  }
}

// === 알림 관리 ===

/**
 * 모든 알림 조회
 */
export function getNotifications(): VideoNotification[] {
  if (typeof window === 'undefined') return [];

  try {
    const stored = localStorage.getItem(STORAGE_KEYS.NOTIFICATIONS);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('알림 조회 실패:', error);
    return [];
  }
}

/**
 * 읽지 않은 알림 개수 조회
 */
export function getUnreadNotificationCount(): number {
  const notifications = getNotifications();
  return notifications.filter(n => !n.isRead).length;
}

/**
 * 새 알림 추가
 */
export function addNotification(notification: Omit<VideoNotification, 'isRead' | 'notifiedAt'>): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const notifications = getNotifications();

    // 중복 체크 (같은 videoId)
    if (notifications.some(n => n.videoId === notification.videoId)) {
      return false;
    }

    const newNotification: VideoNotification = {
      ...notification,
      isRead: false,
      notifiedAt: new Date().toISOString(),
    };

    // 최신 알림이 먼저 오도록 배열 앞에 추가
    notifications.unshift(newNotification);

    // 최대 100개까지만 저장 (오래된 알림 자동 삭제)
    const trimmed = notifications.slice(0, 100);

    localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(trimmed));
    return true;
  } catch (error) {
    console.error('알림 추가 실패:', error);
    return false;
  }
}

/**
 * 알림을 읽음으로 표시
 */
export function markNotificationAsRead(videoId: string): void {
  if (typeof window === 'undefined') return;

  try {
    const notifications = getNotifications();
    const updated = notifications.map(n =>
      n.videoId === videoId ? { ...n, isRead: true } : n
    );

    localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(updated));
  } catch (error) {
    console.error('알림 읽음 표시 실패:', error);
  }
}

/**
 * 모든 알림을 읽음으로 표시
 */
export function markAllNotificationsAsRead(): void {
  if (typeof window === 'undefined') return;

  try {
    const notifications = getNotifications();
    const updated = notifications.map(n => ({ ...n, isRead: true }));

    localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(updated));
  } catch (error) {
    console.error('전체 알림 읽음 표시 실패:', error);
  }
}

/**
 * 특정 채널의 알림 삭제
 */
export function removeNotificationsByChannel(channelId: string): void {
  if (typeof window === 'undefined') return;

  try {
    const notifications = getNotifications();
    const filtered = notifications.filter(n => n.channelId !== channelId);

    localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(filtered));
  } catch (error) {
    console.error('채널 알림 삭제 실패:', error);
  }
}

/**
 * 알림 삭제
 */
export function removeNotification(videoId: string): void {
  if (typeof window === 'undefined') return;

  try {
    const notifications = getNotifications();
    const filtered = notifications.filter(n => n.videoId !== videoId);

    localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(filtered));
  } catch (error) {
    console.error('알림 삭제 실패:', error);
  }
}

/**
 * 모든 알림 삭제
 */
export function clearAllNotifications(): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify([]));
  } catch (error) {
    console.error('전체 알림 삭제 실패:', error);
  }
}

// === 마지막 확인 시간 관리 ===

/**
 * 전체 알림 시스템의 마지막 확인 시간 조회
 */
export function getLastNotificationCheck(): string | null {
  if (typeof window === 'undefined') return null;

  try {
    return localStorage.getItem(STORAGE_KEYS.LAST_CHECK);
  } catch (error) {
    console.error('마지막 확인 시간 조회 실패:', error);
    return null;
  }
}

/**
 * 전체 알림 시스템의 마지막 확인 시간 업데이트
 */
export function updateLastNotificationCheck(): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(STORAGE_KEYS.LAST_CHECK, new Date().toISOString());
  } catch (error) {
    console.error('마지막 확인 시간 업데이트 실패:', error);
  }
}
