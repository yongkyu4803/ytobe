-- Rank recently observed favorite-channel videos by current viewing velocity.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS youtube_app_video_snapshots_latest
  ON public.youtube_app_video_metric_snapshots(video_id,collected_at DESC);

CREATE OR REPLACE VIEW public.youtube_app_rising_videos WITH (security_invoker=true) AS
WITH latest_growth AS (
  SELECT DISTINCT ON (g.video_id)
    g.video_id,g.collected_at AS observed_at,g.view_count,g.previous_view_count,
    g.view_delta,g.elapsed_hours,g.views_per_hour
  FROM public.youtube_app_video_growth g
  WHERE g.view_delta >= 0
    AND g.elapsed_hours > 0
    AND g.elapsed_hours <= 8
    AND g.collected_at >= now()-interval '8 hours'
  ORDER BY g.video_id,g.collected_at DESC
), observation_counts AS (
  SELECT video_id,count(*)::integer AS observation_count
  FROM public.youtube_app_video_metric_snapshots
  GROUP BY video_id
), candidates AS (
  SELECT g.video_id,v.channel_id,v.title,v.thumbnail_url,v.published_at,v.view_count,
    f.folder_id,ch.title AS channel_title,ch.subscriber_count,
    g.observed_at,g.previous_view_count,g.view_delta,g.elapsed_hours,g.views_per_hour,
    o.observation_count
  FROM latest_growth g
  JOIN public.youtube_app_videos v ON v.video_id=g.video_id
  JOIN public.youtube_app_favorite_channels f ON f.channel_id=v.channel_id
  JOIN public.youtube_app_channels ch ON ch.channel_id=v.channel_id
  JOIN observation_counts o ON o.video_id=g.video_id
  WHERE v.published_at >= now()-interval '30 days'
), channel_baselines AS (
  SELECT channel_id,percentile_cont(0.5) WITHIN GROUP (ORDER BY views_per_hour) AS median_views_per_hour
  FROM candidates GROUP BY channel_id
), relative_rank AS (
  SELECT video_id,cume_dist() OVER (ORDER BY (views_per_hour*1000/subscriber_count)) AS normalized_velocity_percentile
  FROM candidates WHERE subscriber_count > 0
), ranked AS (
  SELECT c.*,b.median_views_per_hour,
    cume_dist() OVER (ORDER BY c.views_per_hour) AS velocity_percentile,
    r.normalized_velocity_percentile,
    CASE WHEN c.subscriber_count > 0 THEN c.views_per_hour*1000/c.subscriber_count END AS views_per_1000_subscribers,
    CASE WHEN b.median_views_per_hour > 0 THEN c.views_per_hour/b.median_views_per_hour END AS surge_ratio,
    greatest(0::double precision,1-extract(epoch FROM now()-c.published_at)/604800) AS freshness
  FROM candidates c
  JOIN channel_baselines b ON b.channel_id=c.channel_id
  LEFT JOIN relative_rank r ON r.video_id=c.video_id
)
SELECT video_id,channel_id,title,thumbnail_url,published_at,view_count,folder_id,channel_title,subscriber_count,
  observed_at,previous_view_count,view_delta,elapsed_hours,views_per_hour,observation_count,
  median_views_per_hour,views_per_1000_subscribers,surge_ratio,
  round((100*(0.45*velocity_percentile
    +0.25*coalesce(normalized_velocity_percentile,0.5)
    +0.20*coalesce(least(surge_ratio/3,1),0.33)
    +0.10*freshness))::numeric,1) AS trend_score
FROM ranked;

REVOKE ALL ON public.youtube_app_rising_videos FROM PUBLIC;
GRANT SELECT ON public.youtube_app_rising_videos TO anon,authenticated,service_role;
COMMENT ON VIEW public.youtube_app_rising_videos IS
  'Favorite-channel videos with two recent real measurements. Score combines viewing velocity, subscriber-normalized velocity, channel median comparison, and freshness.';
COMMIT;
