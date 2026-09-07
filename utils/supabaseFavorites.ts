// Supabase를 사용한 즐겨찾기 채널 및 알림 관리
import { supabase } from '../lib/supabase';
import { metricText } from './metrics';

export interface FavoriteFolder {
  id: string;
  name: string;
  description?: string;
  color: string;
  icon: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface FavoriteChannel {
  channelId: string;
  channelTitle: string;
  channelThumbnail?: string;
  subscriberCount: string | null;
  folderId?: string;
  sortOrder: number;
  addedAt: string;
  lastChecked?: string;
}

export interface VideoNotification {
  videoId: string;
  videoTitle: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  thumbnailUrl: string;
  isRead: boolean;
  notifiedAt: string;
}

async function mutate<T = unknown>(action: string, payload: Record<string, unknown> = {}): Promise<T | null> {
  const response = await fetch('/api/personal-data', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || '데이터를 변경하지 못했습니다.');
  return data.data ?? null;
}

// === 폴더 관리 ===

/**
 * 모든 폴더 조회
 */
export async function getFolders(): Promise<FavoriteFolder[]> {
  try {
    const { data, error } = await supabase
      .from('youtube_app_favorite_folders')
      .select('*')
      .order('sort_order', { ascending: true });

    if (error) throw error;

    return (data || []).map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      color: row.color,
      icon: row.icon,
      sortOrder: row.sort_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  } catch (error) {
    console.error('폴더 조회 실패:', error);
    return [];
  }
}

/**
 * 폴더 생성
 */
export async function createFolder(
  folder: Pick<FavoriteFolder, 'name' | 'description' | 'color' | 'icon'>
): Promise<FavoriteFolder | null> {
  try {
    const data = await mutate<Record<string, any>>('createFolder', folder);
    if (!data) return null;

    return {
      id: data.id,
      name: data.name,
      description: data.description,
      color: data.color,
      icon: data.icon,
      sortOrder: data.sort_order,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  } catch (error) {
    console.error('폴더 생성 실패:', error);
    return null;
  }
}

/**
 * 폴더 수정
 */
export async function updateFolder(
  folderId: string,
  updates: Partial<Pick<FavoriteFolder, 'name' | 'description' | 'color' | 'icon' | 'sortOrder'>>
): Promise<boolean> {
  try {
    await mutate('updateFolder', { folderId, ...updates });
    return true;
  } catch (error) {
    console.error('폴더 수정 실패:', error);
    return false;
  }
}

/**
 * 폴더 삭제
 */
export async function deleteFolder(folderId: string): Promise<boolean> {
  try {
    await mutate('deleteFolder', { folderId });
    return true;
  } catch (error) {
    console.error('폴더 삭제 실패:', error);
    return false;
  }
}

/**
 * 미분류 채널을 포함한 전체 즐겨찾기 채널 개수 조회
 */
export async function getFavoriteChannelCount(): Promise<number> {
  try {
    const { count, error } = await supabase
      .from('youtube_app_favorite_channels')
      .select('*', { count: 'exact', head: true });

    if (error) throw error;
    return count || 0;
  } catch (error) {
    console.error('전체 채널 개수 조회 실패:', error);
    return 0;
  }
}

/**
 * 특정 폴더의 채널 개수 조회
 */
export async function getFolderChannelCount(folderId: string): Promise<number> {
  try {
    const { count, error } = await supabase
      .from('youtube_app_favorite_channels')
      .select('*', { count: 'exact', head: true })
      .eq('folder_id', folderId);

    if (error) throw error;
    return count || 0;
  } catch (error) {
    console.error('폴더 채널 개수 조회 실패:', error);
    return 0;
  }
}

// === 즐겨찾기 채널 관리 ===

/**
 * 모든 즐겨찾기 채널 조회
 */
export async function getFavoriteChannels(folderId?: string): Promise<FavoriteChannel[]> {
  try {
    let query = supabase
      .from('youtube_app_favorite_channels')
      .select('*');

    // 폴더 ID가 제공되면 필터링
    if (folderId !== undefined) {
      if (folderId === null || folderId === '') {
        query = query.is('folder_id', null);
      } else {
        query = query.eq('folder_id', folderId);
      }
    }

    const data: Record<string, any>[] = [];
    const orderedQuery = query.order('sort_order', { ascending: true }).order('channel_id');
    for (let offset = 0; ; offset += 500) {
      const { data: page, error } = await orderedQuery.range(offset, offset + 499);
      if (error) throw error;
      data.push(...(page || []));
      if (!page || page.length < 500) break;
    }

    return (data || []).map(row => ({
      channelId: row.channel_id,
      channelTitle: row.channel_title,
      channelThumbnail: row.channel_thumbnail,
      subscriberCount: metricText(row.subscriber_count),
      folderId: row.folder_id,
      sortOrder: row.sort_order,
      addedAt: row.added_at,
      lastChecked: row.last_checked,
    }));
  } catch (error) {
    console.error('즐겨찾기 채널 조회 실패:', error);
    return [];
  }
}

/**
 * 채널이 즐겨찾기에 있는지 확인
 */
export async function isFavoriteChannel(channelId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('youtube_app_favorite_channels')
      .select('id')
      .eq('channel_id', channelId)
      .limit(1);

    if (error) {
      console.error('즐겨찾기 확인 실패:', error);
      return false;
    }

    return data && data.length > 0;
  } catch (error) {
    console.error('즐겨찾기 확인 실패:', error);
    return false;
  }
}

/**
 * 즐겨찾기 채널 추가
 */
export async function addFavoriteChannel(
  channel: Omit<FavoriteChannel, 'addedAt' | 'lastChecked' | 'sortOrder'>
): Promise<boolean> {
  try {
    // 중복 체크
    const exists = await isFavoriteChannel(channel.channelId);
    if (exists) {
      console.warn('이미 즐겨찾기에 추가된 채널입니다.');
      return false;
    }

    await mutate('addFavoriteChannel', {
      ...channel,
      subscriberCount: metricText(channel.subscriberCount),
      folderId: channel.folderId || null,
    });
    return true;
  } catch (error) {
    console.error('즐겨찾기 추가 실패:', error);
    return false;
  }
}

/**
 * 채널을 다른 폴더로 이동
 */
export async function moveChannelToFolder(
  channelId: string,
  folderId: string | null
): Promise<boolean> {
  try {
    await mutate('moveChannelToFolder', { channelId, folderId });
    return true;
  } catch (error) {
    console.error('채널 이동 실패:', error);
    return false;
  }
}

/**
 * 채널의 정렬 순서 업데이트
 */
export async function updateChannelSortOrder(
  channelId: string,
  sortOrder: number
): Promise<boolean> {
  try {
    await mutate('updateChannelSortOrder', { channelId, sortOrder });
    return true;
  } catch (error) {
    console.error('채널 정렬 순서 업데이트 실패:', error);
    return false;
  }
}

/**
 * 즐겨찾기 채널 삭제
 */
export async function removeFavoriteChannel(channelId: string): Promise<boolean> {
  try {
    await mutate('removeFavoriteChannel', { channelId });
    return true;
  } catch (error) {
    console.error('즐겨찾기 삭제 실패:', error);
    return false;
  }
}

/**
 * 채널의 마지막 확인 시간 업데이트
 */
export async function updateChannelLastChecked(channelId: string): Promise<void> {
  try {
    await mutate('updateChannelLastChecked', { channelId });
  } catch (error) {
    console.error('마지막 확인 시간 업데이트 실패:', error);
  }
}

// === 알림 관리 ===

/**
 * 모든 알림 조회
 */
export async function getNotifications(): Promise<VideoNotification[]> {
  try {
    const { data, error } = await supabase
      .from('youtube_app_video_notifications')
      .select('*')
      .order('notified_at', { ascending: false })
      .limit(100);

    if (error) throw error;

    return (data || []).map(row => ({
      videoId: row.video_id,
      videoTitle: row.video_title,
      channelId: row.channel_id,
      channelTitle: row.channel_title,
      publishedAt: row.published_at,
      thumbnailUrl: row.thumbnail_url,
      isRead: row.is_read,
      notifiedAt: row.notified_at,
    }));
  } catch (error) {
    console.error('알림 조회 실패:', error);
    return [];
  }
}

/**
 * 읽지 않은 알림 개수 조회
 */
export async function getUnreadNotificationCount(): Promise<number> {
  try {
    const { count, error } = await supabase
      .from('youtube_app_video_notifications')
      .select('*', { count: 'exact', head: true })
      .eq('is_read', false);

    if (error) throw error;
    return count || 0;
  } catch (error) {
    console.error('읽지 않은 알림 개수 조회 실패:', error);
    return 0;
  }
}

/**
 * 새 알림 추가
 */
export async function addNotification(
  notification: Omit<VideoNotification, 'isRead' | 'notifiedAt'>
): Promise<boolean> {
  try {
    await mutate('addNotification', notification);
    return true;
  } catch (error) {
    console.error('알림 추가 실패:', error);
    return false;
  }
}

/**
 * 알림을 읽음으로 표시
 */
export async function markNotificationAsRead(videoId: string): Promise<void> {
  try {
    await mutate('markNotificationAsRead', { videoId });
  } catch (error) {
    console.error('알림 읽음 표시 실패:', error);
  }
}

/**
 * 모든 알림을 읽음으로 표시
 */
export async function markAllNotificationsAsRead(): Promise<void> {
  try {
    await mutate('markAllNotificationsAsRead');
  } catch (error) {
    console.error('전체 알림 읽음 표시 실패:', error);
  }
}

/**
 * 특정 채널의 알림 삭제
 */
export async function removeNotificationsByChannel(channelId: string): Promise<void> {
  try {
    await mutate('removeNotificationsByChannel', { channelId });
  } catch (error) {
    console.error('채널 알림 삭제 실패:', error);
  }
}

/**
 * 알림 삭제
 */
export async function removeNotification(videoId: string): Promise<void> {
  try {
    await mutate('removeNotification', { videoId });
  } catch (error) {
    console.error('알림 삭제 실패:', error);
  }
}

/**
 * 모든 알림 삭제
 */
export async function clearAllNotifications(): Promise<void> {
  try {
    await mutate('clearAllNotifications');
  } catch (error) {
    console.error('전체 알림 삭제 실패:', error);
  }
}

/**
 * 전체 알림 시스템의 마지막 확인 시간 조회 (선택사항)
 * Note: Supabase에서는 last_checked를 각 채널별로 관리하므로 이 함수는 사용하지 않을 수 있음
 */
export async function getLastNotificationCheck(): Promise<string | null> {
  // Supabase 버전에서는 필요시 별도 테이블 생성 또는 로컬 스토리지 활용
  return null;
}

/**
 * 전체 알림 시스템의 마지막 확인 시간 업데이트 (선택사항)
 */
export async function updateLastNotificationCheck(): Promise<void> {
  // Supabase 버전에서는 필요시 별도 구현
}
