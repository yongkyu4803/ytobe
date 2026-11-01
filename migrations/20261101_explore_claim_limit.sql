-- Applied 2026-11-01 after the first production run: PostgREST caps RPC results at 1000 rows,
-- so claiming more leased channels/videos the worker never received.
BEGIN;
CREATE OR REPLACE FUNCTION public.youtube_app_explore_claim_stats(p_limit integer)
RETURNS TABLE(channel_id text) LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  WITH due AS (
    SELECT c.channel_id FROM public.youtube_app_channels c
    WHERE c.stats_next_at <= now()
      AND NOT EXISTS(SELECT 1 FROM public.youtube_app_favorite_channels f WHERE f.channel_id=c.channel_id)
    ORDER BY c.stats_next_at, c.channel_id
    LIMIT least(greatest(p_limit,1),1000) -- PostgREST returns at most 1000 rows
    FOR UPDATE OF c SKIP LOCKED
  )
  UPDATE public.youtube_app_channels c SET stats_next_at=now()+interval '30 minutes'
  FROM due WHERE c.channel_id=due.channel_id
  RETURNING c.channel_id;
$$;
CREATE OR REPLACE FUNCTION public.youtube_app_explore_claim_videos(p_limit integer)
RETURNS TABLE(video_id text) LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  WITH due AS (
    SELECT v.video_id FROM public.youtube_app_videos v
    WHERE v.explore_next_at <= now() AND v.published_at >= now()-interval '30 days'
      AND NOT EXISTS(SELECT 1 FROM public.youtube_app_favorite_channels f WHERE f.channel_id=v.channel_id)
    ORDER BY v.explore_next_at, v.video_id
    LIMIT least(greatest(p_limit,1),1000) -- PostgREST returns at most 1000 rows
    FOR UPDATE OF v SKIP LOCKED
  )
  UPDATE public.youtube_app_videos v SET explore_next_at=now()+interval '30 minutes'
  FROM due WHERE v.video_id=due.video_id
  RETURNING v.video_id;
$$;
-- Release leases taken by the oversized first claim.
UPDATE public.youtube_app_channels SET stats_next_at=now() WHERE explore_status='pending' AND stats_next_at>now();
COMMIT;
