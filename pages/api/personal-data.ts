import type { NextApiRequest, NextApiResponse } from 'next';
import { createAdminSupabase } from '../../lib/server/adminSupabase';
import { hasSameOrigin, hasValidPersonalSession } from '../../lib/server/personalSession';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const channelId = /^UC[A-Za-z0-9_-]{22}$/;
const videoId = /^[A-Za-z0-9_-]{11}$/;
const color = /^#[0-9a-f]{6}$/i;
const metric = /^\d{1,19}$/;

function text(value: unknown, max: number, required = true) {
  if (typeof value !== 'string') throw new Error('invalid');
  const normalized = value.trim();
  if ((required && !normalized) || normalized.length > max) throw new Error('invalid');
  return normalized;
}

function optionalText(value: unknown, max: number) {
  return value === undefined || value === null ? undefined : text(value, max, false);
}

function optionalUrl(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  const raw = text(value, 2048);
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new Error('invalid'); }
  if (parsed.protocol !== 'https:') throw new Error('invalid');
  return raw;
}

function folder(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !uuid.test(value)) throw new Error('invalid');
  return value;
}

function count(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const raw = String(value);
  if (!metric.test(raw) || BigInt(raw) > BigInt('9223372036854775807')) throw new Error('invalid');
  return raw;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ message: 'POST 요청이 필요합니다.' });
  }
  if (!hasSameOrigin(req)) return res.status(403).json({ message: '허용되지 않은 요청입니다.' });
  if (!hasValidPersonalSession(req)) return res.status(401).json({ message: '로그인이 필요합니다.' });

  try {
    const db = createAdminSupabase();
    const action = req.body?.action;
    const payload = req.body?.payload || {};
    let result;

    switch (action) {
      case 'createFolder': {
        const values = {
          name: text(payload.name, 100),
          description: optionalText(payload.description, 500) || null,
          color: text(payload.color, 7),
          icon: text(payload.icon, 16),
        };
        if (!color.test(values.color)) throw new Error('invalid');
        result = await db.from('youtube_app_favorite_folders').insert(values).select().single();
        break;
      }
      case 'updateFolder': {
        if (!uuid.test(String(payload.folderId))) throw new Error('invalid');
        const values: Record<string, string | number | null> = {};
        if (payload.name !== undefined) values.name = text(payload.name, 100);
        if (payload.description !== undefined) values.description = optionalText(payload.description, 500) || null;
        if (payload.color !== undefined) {
          values.color = text(payload.color, 7);
          if (!color.test(String(values.color))) throw new Error('invalid');
        }
        if (payload.icon !== undefined) values.icon = text(payload.icon, 16);
        if (payload.sortOrder !== undefined) {
          if (!Number.isInteger(payload.sortOrder) || Math.abs(payload.sortOrder) > 1_000_000) throw new Error('invalid');
          values.sort_order = payload.sortOrder;
        }
        if (!Object.keys(values).length) throw new Error('invalid');
        result = await db.from('youtube_app_favorite_folders').update(values).eq('id', payload.folderId);
        break;
      }
      case 'deleteFolder':
        if (!uuid.test(String(payload.folderId))) throw new Error('invalid');
        result = await db.from('youtube_app_favorite_folders').delete().eq('id', payload.folderId);
        break;
      case 'addFavoriteChannel': {
        if (!channelId.test(String(payload.channelId))) throw new Error('invalid');
        const values = {
          channel_id: payload.channelId,
          channel_title: text(payload.channelTitle, 500),
          channel_thumbnail: optionalUrl(payload.channelThumbnail),
          subscriber_count: count(payload.subscriberCount),
          folder_id: folder(payload.folderId),
        };
        result = await db.from('youtube_app_favorite_channels').insert(values);
        break;
      }
      case 'moveChannelToFolder':
        if (!channelId.test(String(payload.channelId))) throw new Error('invalid');
        result = await db.from('youtube_app_favorite_channels').update({ folder_id: folder(payload.folderId) }).eq('channel_id', payload.channelId);
        break;
      case 'updateChannelSortOrder':
        if (!channelId.test(String(payload.channelId)) || !Number.isInteger(payload.sortOrder) || Math.abs(payload.sortOrder) > 1_000_000) throw new Error('invalid');
        result = await db.from('youtube_app_favorite_channels').update({ sort_order: payload.sortOrder }).eq('channel_id', payload.channelId);
        break;
      case 'removeFavoriteChannel':
        if (!channelId.test(String(payload.channelId))) throw new Error('invalid');
        result = await db.from('youtube_app_favorite_channels').delete().eq('channel_id', payload.channelId);
        break;
      case 'updateChannelLastChecked':
        if (!channelId.test(String(payload.channelId))) throw new Error('invalid');
        result = await db.from('youtube_app_favorite_channels').update({ last_checked: new Date().toISOString() }).eq('channel_id', payload.channelId);
        break;
      case 'addNotification': {
        if (!videoId.test(String(payload.videoId)) || !channelId.test(String(payload.channelId))) throw new Error('invalid');
        const publishedAt = new Date(payload.publishedAt);
        if (!Number.isFinite(publishedAt.getTime())) throw new Error('invalid');
        result = await db.from('youtube_app_video_notifications').insert({
          video_id: payload.videoId,
          video_title: text(payload.videoTitle, 500),
          channel_id: payload.channelId,
          channel_title: text(payload.channelTitle, 500),
          published_at: publishedAt.toISOString(),
          thumbnail_url: optionalUrl(payload.thumbnailUrl) || '',
        });
        break;
      }
      case 'markNotificationAsRead':
        if (!videoId.test(String(payload.videoId))) throw new Error('invalid');
        result = await db.from('youtube_app_video_notifications').update({ is_read: true }).eq('video_id', payload.videoId);
        break;
      case 'markAllNotificationsAsRead':
        result = await db.from('youtube_app_video_notifications').update({ is_read: true }).eq('is_read', false);
        break;
      case 'removeNotificationsByChannel':
        if (!channelId.test(String(payload.channelId))) throw new Error('invalid');
        result = await db.from('youtube_app_video_notifications').delete().eq('channel_id', payload.channelId);
        break;
      case 'removeNotification':
        if (!videoId.test(String(payload.videoId))) throw new Error('invalid');
        result = await db.from('youtube_app_video_notifications').delete().eq('video_id', payload.videoId);
        break;
      case 'clearAllNotifications':
        result = await db.from('youtube_app_video_notifications').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        break;
      default:
        return res.status(400).json({ message: '지원하지 않는 작업입니다.' });
    }

    if (result.error) throw result.error;
    return res.status(200).json({ ok: true, data: result.data || null });
  } catch (error) {
    if (error instanceof Error && error.message === 'invalid') return res.status(400).json({ message: '입력값이 올바르지 않습니다.' });
    console.error('개인 데이터 변경 실패:', error instanceof Error ? error.message : 'unknown');
    return res.status(500).json({ message: '데이터를 변경하지 못했습니다.' });
  }
}
