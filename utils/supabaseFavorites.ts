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
    const { data, error } = await supabase
      .from('youtube_app_favorite_folders')
      .insert({
        name: folder.name,
        description: folder.description,
        color: folder.color,
        icon: folder.icon,
      })
      .select()
      .single();

    if (error) throw error;

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
    const updateData: any = {};
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.color !== undefined) updateData.color = updates.color;
    if (updates.icon !== undefined) updateData.icon = updates.icon;
    if (updates.sortOrder !== undefined) updateData.sort_order = updates.sortOrder;

    const { error } = await supabase
      .from('youtube_app_favorite_folders')
      .update(updateData)
      .eq('id', folderId);

    if (error) throw error;
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
    const { error } = await supabase
      .from('youtube_app_favorite_folders')
      .delete()
      .eq('id', folderId);

    if (error) throw error;
    return true;
  } catch (error) {
    console.error('폴더 삭제 실패:', error);
    return false;
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

    const { error } = await supabase
      .from('youtube_app_favorite_channels')
      .insert({
        channel_id: channel.channelId,
        channel_title: channel.channelTitle,
        channel_thumbnail: channel.channelThumbnail,
        subscriber_count: metricText(channel.subscriberCount),
        folder_id: channel.folderId || null,
      });

    if (error) throw error;
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
    const { error } = await supabase
      .from('youtube_app_favorite_channels')
      .update({ folder_id: folderId })
      .eq('channel_id', channelId);

    if (error) throw error;
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
    const { error } = await supabase
      .from('youtube_app_favorite_channels')
      .update({ sort_order: sortOrder })
      .eq('channel_id', channelId);

    if (error) throw error;
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
    const { error } = await supabase
      .from('youtube_app_favorite_channels')
      .delete()
      .eq('channel_id', channelId);

    if (error) throw error;

    // DB trigger removes channel notifications in this same transaction.
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
    const { error } = await supabase
      .from('youtube_app_favorite_channels')
      .update({ last_checked: new Date().toISOString() })
      .eq('channel_id', channelId);

    if (error) throw error;
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
    // 중복 체크
    const { data: existing } = await supabase
      .from('youtube_app_video_notifications')
      .select('id')
      .eq('video_id', notification.videoId)
      .single();

    if (existing) {
      return false; // 이미 존재하는 알림
    }

    const { error } = await supabase
      .from('youtube_app_video_notifications')
      .insert({
        video_id: notification.videoId,
        video_title: notification.videoTitle,
        channel_id: notification.channelId,
        channel_title: notification.channelTitle,
        published_at: notification.publishedAt,
        thumbnail_url: notification.thumbnailUrl,
      });

    if (error) throw error;
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
    const { error } = await supabase
      .from('youtube_app_video_notifications')
      .update({ is_read: true })
      .eq('video_id', videoId);

    if (error) throw error;
  } catch (error) {
    console.error('알림 읽음 표시 실패:', error);
  }
}

/**
 * 모든 알림을 읽음으로 표시
 */
export async function markAllNotificationsAsRead(): Promise<void> {
  try {
    const { error } = await supabase
      .from('youtube_app_video_notifications')
      .update({ is_read: true })
      .eq('is_read', false);

    if (error) throw error;
  } catch (error) {
    console.error('전체 알림 읽음 표시 실패:', error);
  }
}

/**
 * 특정 채널의 알림 삭제
 */
export async function removeNotificationsByChannel(channelId: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('youtube_app_video_notifications')
      .delete()
      .eq('channel_id', channelId);

    if (error) throw error;
  } catch (error) {
    console.error('채널 알림 삭제 실패:', error);
  }
}

/**
 * 알림 삭제
 */
export async function removeNotification(videoId: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('youtube_app_video_notifications')
      .delete()
      .eq('video_id', videoId);

    if (error) throw error;
  } catch (error) {
    console.error('알림 삭제 실패:', error);
  }
}

/**
 * 모든 알림 삭제
 */
export async function clearAllNotifications(): Promise<void> {
  try {
    const { error } = await supabase
      .from('youtube_app_video_notifications')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // 모든 행 삭제

    if (error) throw error;
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
