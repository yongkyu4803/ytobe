-- Number fixes found in the 2026-11-24 review.
--
-- 1. Keyword "영상·채널" for 7 days summed the daily counts, so a video measured on 7 days counted 7 times
--    ("예능": shown 7,043 videos, real ≤ 2,120) and the channel count was the best single day. Distinct counts
--    for the window are now precomputed nightly (a live distinct count takes 5–30s, too slow for the page).
-- 2. The nightly keyword job ran two day aggregations (~45s each, growing with the pool) plus retention in one
--    statement and hit the 2-minute statement timeout; 11/20–11/23 were never aggregated. It now runs with a
--    longer timeout and more sort memory.
-- 3. Rising videos showed "평소 대비 1.0배" for channels with a single measured video (median of itself).
BEGIN;

CREATE TABLE IF NOT EXISTS public.youtube_app_keyword_window (
  days smallint NOT NULL CHECK (days BETWEEN 2 AND 14),
  keyword text NOT NULL,
  end_day date NOT NULL,
  video_count integer NOT NULL CHECK (video_count >= 0),
  channel_count integer NOT NULL CHECK (channel_count >= 0),
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (days, keyword)
);
ALTER TABLE public.youtube_app_keyword_window ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.youtube_app_keyword_window FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.youtube_app_keyword_window TO service_role;

-- Distinct KR ≤180s videos (and their channels) measured inside the KST window, per keyword that has daily rows.
CREATE OR REPLACE FUNCTION public.youtube_app_aggregate_keyword_window(p_end date, p_days integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE t0 timestamptz := (p_end - p_days + 1)::timestamp AT TIME ZONE 'Asia/Seoul';
        t1 timestamptz := (p_end + 1)::timestamp AT TIME ZONE 'Asia/Seoul';
        stored integer;
BEGIN
  DELETE FROM public.youtube_app_keyword_window WHERE days = p_days;
  INSERT INTO public.youtube_app_keyword_window(days, keyword, end_day, video_count, channel_count)
  SELECT p_days, k.keyword, p_end, count(*), count(DISTINCT m.channel_id)
  FROM (
    SELECT v.video_id, v.channel_id
    FROM public.youtube_app_videos v JOIN public.youtube_app_channels c ON c.channel_id = v.channel_id
    WHERE c.country = 'KR' AND v.duration_seconds <= 180
      AND v.published_at < t1 AND v.published_at >= t0 - interval '30 days'
      AND EXISTS(SELECT 1 FROM public.youtube_app_video_metric_snapshots s
        WHERE s.video_id = v.video_id AND s.collected_at >= t0 AND s.collected_at < t1)
  ) m
  JOIN public.youtube_app_video_keywords k ON k.video_id = m.video_id
  WHERE k.keyword IN (SELECT DISTINCT d.keyword FROM public.youtube_app_keyword_daily d
    WHERE d.day BETWEEN p_end - p_days + 1 AND p_end)
  GROUP BY k.keyword;
  GET DIAGNOSTICS stored = ROW_COUNT;
  RETURN stored;
END $$;

CREATE OR REPLACE FUNCTION public.youtube_app_daily_keywords() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
        result jsonb := '{}'::jsonb; d date;
BEGIN
  -- Always (re)compute the last two days (late measurements), plus any day of the past week that has no rows
  -- because an earlier run failed.
  FOR d IN SELECT g::date FROM generate_series(today - 7, today - 1, interval '1 day') g
    WHERE g::date >= today - 2 OR NOT EXISTS(SELECT 1 FROM public.youtube_app_keyword_daily k WHERE k.day = g::date) LOOP
    result := result || jsonb_build_object(d::text, public.youtube_app_aggregate_keywords(d));
  END LOOP;
  RETURN result || jsonb_build_object(
    'window7', public.youtube_app_aggregate_keyword_window(today - 1, 7),
    'retention', public.youtube_app_explore_retention());
END $$;

-- 1-day counts are exact daily rows; longer windows use the precomputed distinct counts.
CREATE OR REPLACE FUNCTION public.youtube_app_keyword_ranking(p_days integer,p_limit integer DEFAULT 100)
RETURNS TABLE(keyword text, view_gain bigint, video_count bigint, channel_count integer, series jsonb, latest_day date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH latest AS (SELECT max(day) AS day FROM public.youtube_app_keyword_daily),
  n AS (SELECT least(greatest(p_days,1),14) AS days),
  agg AS (
    SELECT k.keyword, sum(k.view_gain)::bigint AS view_gain, max(k.video_count) AS day_videos,
      max(k.channel_count) AS day_channels, sum(k.video_count) AS summed_videos
    FROM public.youtube_app_keyword_daily k, latest, n
    WHERE k.day > latest.day - n.days
    GROUP BY k.keyword
  ), win AS (
    SELECT a.keyword, a.view_gain,
      CASE WHEN n.days = 1 THEN a.day_videos::bigint ELSE w.video_count::bigint END AS video_count,
      CASE WHEN n.days = 1 THEN a.day_channels ELSE w.channel_count END AS channel_count
    FROM agg a CROSS JOIN latest CROSS JOIN n
    LEFT JOIN public.youtube_app_keyword_window w ON w.days = n.days AND w.end_day = latest.day AND w.keyword = a.keyword
    WHERE CASE WHEN n.days = 1 THEN a.day_videos ELSE coalesce(w.video_count, a.summed_videos) END >= 3
    ORDER BY 2 DESC, 1 LIMIT least(greatest(p_limit,1),1000)
  )
  SELECT w.keyword, w.view_gain, w.video_count, w.channel_count,
    (SELECT jsonb_agg(jsonb_build_object('day',d.day,'gain',d.view_gain) ORDER BY d.day)
     FROM public.youtube_app_keyword_daily d WHERE d.keyword=w.keyword AND d.day > latest.day-14),
    latest.day
  FROM win w, latest ORDER BY w.view_gain DESC, w.keyword;
$$;

REVOKE ALL ON FUNCTION public.youtube_app_aggregate_keyword_window(date, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.youtube_app_aggregate_keyword_window(date, integer) TO service_role;

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
  SELECT channel_id,percentile_cont(0.5) WITHIN GROUP (ORDER BY views_per_hour) AS median_views_per_hour,
    count(*) AS sample_size
  FROM candidates GROUP BY channel_id
), relative_rank AS (
  SELECT video_id,cume_dist() OVER (ORDER BY (views_per_hour*1000/subscriber_count)) AS normalized_velocity_percentile
  FROM candidates WHERE subscriber_count > 0
), ranked AS (
  SELECT c.*,b.median_views_per_hour,
    cume_dist() OVER (ORDER BY c.views_per_hour) AS velocity_percentile,
    r.normalized_velocity_percentile,
    CASE WHEN c.subscriber_count > 0 THEN c.views_per_hour*1000/c.subscriber_count END AS views_per_1000_subscribers,
    -- With fewer than 3 measured videos the channel "median" is the video itself (always 1.0x).
    CASE WHEN b.sample_size >= 3 AND b.median_views_per_hour > 0 THEN c.views_per_hour/b.median_views_per_hour END AS surge_ratio,
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

COMMIT;

-- Production schedule (applied separately; pg_cron runs each command in its own session):
-- SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname='youtube-app-keywords'),
--   command := 'SET statement_timeout = ''15min''; SET work_mem = ''128MB''; SELECT public.youtube_app_daily_keywords();');
