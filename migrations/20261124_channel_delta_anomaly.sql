-- YouTube occasionally serves broken channel totals for a day or more (e.g. 57,987,586 → 2,900 → 4,034
-- → 51,236,390), and channels that delete or privatize videos lose total views. A period delta that spans
-- such a step is meaningless (it showed "+5,123만 in 48h" for a channel gaining ~4,000/day), so it is
-- now NULL and flagged instead of reported as growth.
--
-- Anomaly = day-over-day total drop > 2%, or a jump to > 5x that also adds > 100,000 views.
-- view_anomaly_days = days between the latest snapshot and the most recent anomaly (NULL if none in 31 days).
-- A window of N days is valid only when view_anomaly_days >= N (the step happened at or before its start).
BEGIN;

ALTER TABLE public.youtube_app_channels ADD COLUMN IF NOT EXISTS view_anomaly_days smallint;

CREATE OR REPLACE FUNCTION public.youtube_app_refresh_channel_deltas(p_ids text[]) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  WITH latest AS (
    SELECT DISTINCT ON (s.channel_id) s.channel_id, s.bucket_at, s.view_count, s.collected_at
    FROM public.youtube_app_channel_metric_snapshots s
    WHERE s.channel_id = ANY(p_ids)
    ORDER BY s.channel_id, s.bucket_at DESC
  ), series AS (
    SELECT s.channel_id, s.bucket_at, s.view_count AS v,
      lag(s.view_count) OVER (PARTITION BY s.channel_id ORDER BY s.bucket_at) AS p
    FROM public.youtube_app_channel_metric_snapshots s
    JOIN latest l ON l.channel_id = s.channel_id
    WHERE s.bucket_at BETWEEN l.bucket_at - interval '31 days' AND l.bucket_at
  ), anomaly AS (
    SELECT channel_id, max(bucket_at) AS at FROM series
    WHERE p IS NOT NULL AND v IS NOT NULL AND (v < p * 0.98 OR (v > p * 5 AND v - p > 100000))
    GROUP BY channel_id
  ), d AS (
    SELECT l.channel_id, l.view_count AS v, l.collected_at,
      (extract(epoch FROM l.bucket_at - a.at) / 86400)::smallint AS anomaly_days,
      (SELECT s.view_count FROM public.youtube_app_channel_metric_snapshots s WHERE s.channel_id=l.channel_id AND s.bucket_at=l.bucket_at-interval '1 day') AS v1,
      (SELECT s.view_count FROM public.youtube_app_channel_metric_snapshots s WHERE s.channel_id=l.channel_id AND s.bucket_at=l.bucket_at-interval '2 days') AS v2,
      (SELECT s.view_count FROM public.youtube_app_channel_metric_snapshots s WHERE s.channel_id=l.channel_id AND s.bucket_at=l.bucket_at-interval '7 days') AS v7,
      (SELECT s.view_count FROM public.youtube_app_channel_metric_snapshots s WHERE s.channel_id=l.channel_id AND s.bucket_at=l.bucket_at-interval '30 days') AS v30
    FROM latest l LEFT JOIN anomaly a ON a.channel_id = l.channel_id
  )
  UPDATE public.youtube_app_channels c SET
    -- Same total as yesterday usually means YouTube served a stale value; do not report it as zero growth.
    views_stale = coalesce(d.v = d.v1, false),
    view_anomaly_days = d.anomaly_days,
    view_delta_1d = CASE WHEN d.v = d.v1 OR d.anomaly_days < 1 THEN NULL ELSE d.v - d.v1 END,
    view_delta_2d = CASE WHEN d.anomaly_days < 2 THEN NULL ELSE d.v - d.v2 END,
    view_delta_7d = CASE WHEN d.anomaly_days < 7 THEN NULL ELSE d.v - d.v7 END,
    view_delta_30d = CASE WHEN d.anomaly_days < 30 THEN NULL ELSE d.v - d.v30 END,
    deltas_at = d.collected_at
  FROM d WHERE c.channel_id = d.channel_id;
$$;

-- Return type gains view_delta_suspect, so the function must be recreated.
DROP FUNCTION public.youtube_app_search_channels(text, text, bigint, bigint, bigint, bigint, text[], text[], text, integer, integer);
CREATE FUNCTION public.youtube_app_search_channels(p_period text DEFAULT NULL, p_sort text DEFAULT 'views',
  p_sub_min bigint DEFAULT NULL, p_sub_max bigint DEFAULT NULL, p_video_min bigint DEFAULT NULL, p_video_max bigint DEFAULT NULL,
  p_countries text[] DEFAULT NULL, p_topics text[] DEFAULT NULL, p_query text DEFAULT NULL,
  p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS TABLE(channel_id text, title text, thumbnail_url text, country text, topic_ids text[], subscriber_count bigint,
  hidden_subscriber boolean, video_count bigint, view_count bigint, view_delta bigint, views_stale boolean,
  view_delta_suspect boolean, deltas_at timestamptz, is_favorite boolean, total_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH f AS (
    SELECT c.*, CASE p_period WHEN '1d' THEN c.view_delta_1d WHEN '2d' THEN c.view_delta_2d
      WHEN '7d' THEN c.view_delta_7d WHEN '30d' THEN c.view_delta_30d END AS delta,
      coalesce(c.view_anomaly_days < CASE p_period WHEN '1d' THEN 1 WHEN '2d' THEN 2 WHEN '7d' THEN 7 WHEN '30d' THEN 30 END, false) AS suspect
    FROM public.youtube_app_channels c
    WHERE c.explore_status='active'
      AND (p_sub_min IS NULL OR c.subscriber_count >= p_sub_min)
      AND (p_sub_max IS NULL OR c.subscriber_count <= p_sub_max)
      AND (p_video_min IS NULL OR c.video_count >= p_video_min)
      AND (p_video_max IS NULL OR c.video_count <= p_video_max)
      AND (coalesce(cardinality(p_countries),0)=0 OR c.country = ANY(p_countries)
        OR ('OTHER' = ANY(p_countries) AND (c.country IS NULL OR c.country NOT IN ('KR','US','JP'))))
      AND (coalesce(cardinality(p_topics),0)=0 OR c.topic_ids && p_topics
        OR ('__none__' = ANY(p_topics) AND c.topic_ids='{}'))
      AND (coalesce(p_query,'')='' OR c.title ILIKE '%'||replace(replace(replace(left(p_query,100),'\','\\'),'%','\%'),'_','\_')||'%')
  )
  SELECT f.channel_id, f.title, f.thumbnail_url, f.country, f.topic_ids, f.subscriber_count, f.hidden_subscriber,
    f.video_count, f.view_count, f.delta, f.views_stale, f.suspect, f.deltas_at,
    EXISTS(SELECT 1 FROM public.youtube_app_favorite_channels fc WHERE fc.channel_id=f.channel_id),
    count(*) OVER ()
  FROM f
  ORDER BY CASE WHEN p_period IN ('1d','2d','7d','30d') THEN f.delta END DESC NULLS LAST,
    CASE WHEN p_sort='subscribers' THEN f.subscriber_count END DESC NULLS LAST,
    f.view_count DESC NULLS LAST, f.channel_id
  LIMIT least(greatest(p_limit,1),100) OFFSET least(greatest(p_offset,0),20000);
$$;
REVOKE ALL ON FUNCTION public.youtube_app_search_channels(text, text, bigint, bigint, bigint, bigint, text[], text[], text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.youtube_app_search_channels(text, text, bigint, bigint, bigint, bigint, text[], text[], text, integer, integer)
  TO anon, authenticated, service_role;

-- Recompute every channel that has history so existing bad deltas disappear immediately.
SELECT public.youtube_app_refresh_channel_deltas(array_agg(channel_id))
FROM public.youtube_app_channels WHERE deltas_at IS NOT NULL;

COMMIT;
