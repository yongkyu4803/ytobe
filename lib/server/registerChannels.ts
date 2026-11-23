import { createAdminSupabase } from './adminSupabase';

interface VideoLike { snippet?: { channelId?: string; channelTitle?: string } }

/**
 * Adds channels already returned by a search/trending response to the explore pool.
 * Costs no YouTube quota. Failures are logged and never affect the user's response.
 */
export async function registerDiscoveredChannels(videos: VideoLike[], chartRegion?: string) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  // Only a regional popular chart counts as country evidence; keyword search results are too mixed.
  const regions = chartRegion && /^[A-Z]{2}$/.test(chartRegion) ? [chartRegion] : [];
  const channels = new Map<string, { channel_id: string; title: string; regions: string[] }>();
  for (const video of videos || []) {
    const id = video?.snippet?.channelId;
    if (id && /^UC[A-Za-z0-9_-]{22}$/.test(id)) channels.set(id, { channel_id: id, title: video.snippet?.channelTitle || id, regions });
  }
  if (!channels.size) return;
  try {
    const { error } = await createAdminSupabase().rpc('youtube_app_explore_register', { p_channels: [...channels.values()], p_via: 'app' });
    if (error) console.warn('Explore pool registration failed');
  } catch {
    console.warn('Explore pool registration failed');
  }
}
