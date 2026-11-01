-- Channel explore pool, topic/country filters, Shorts keyword ranking.
-- Plan: docs/channel-explore-keywords-plan.md. Additive; existing favorite collection keeps its behavior.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- Channels: explore metadata and precomputed view deltas
-- ---------------------------------------------------------------------------
ALTER TABLE public.youtube_app_channels
  ADD COLUMN country text CHECK (country ~ '^[A-Z]{2}$'),
  ADD COLUMN topic_ids text[] NOT NULL DEFAULT '{}',
  ADD COLUMN hidden_subscriber boolean,
  ADD COLUMN explore_status text NOT NULL DEFAULT 'pending'
    CHECK (explore_status IN ('pending','active','excluded','unavailable')),
  ADD COLUMN discovered_via text CHECK (discovered_via IN ('chart','search','app')),
  ADD COLUMN discovered_at timestamptz,
  ADD COLUMN stats_next_at timestamptz,
  ADD COLUMN stats_success_at timestamptz,
  ADD COLUMN shorts_next_at timestamptz,
  ADD COLUMN view_delta_1d bigint,
  ADD COLUMN view_delta_2d bigint,
  ADD COLUMN view_delta_7d bigint,
  ADD COLUMN view_delta_30d bigint,
  ADD COLUMN views_stale boolean NOT NULL DEFAULT false,
  ADD COLUMN deltas_at timestamptz;

-- Existing rows are favorites that already have collected statistics.
UPDATE public.youtube_app_channels SET explore_status='active';

CREATE INDEX youtube_app_channels_explore_subs ON public.youtube_app_channels(explore_status, subscriber_count DESC NULLS LAST);
CREATE INDEX youtube_app_channels_explore_views ON public.youtube_app_channels(explore_status, view_count DESC NULLS LAST);
CREATE INDEX youtube_app_channels_topics ON public.youtube_app_channels USING gin(topic_ids);
CREATE INDEX youtube_app_channels_stats_due ON public.youtube_app_channels(stats_next_at);
CREATE INDEX youtube_app_channels_shorts_due ON public.youtube_app_channels(country, shorts_next_at);
CREATE INDEX youtube_app_channel_snapshots_latest ON public.youtube_app_channel_metric_snapshots(channel_id, bucket_at DESC);

-- ---------------------------------------------------------------------------
-- Videos: tags, keywords and explore refresh cursor
-- ---------------------------------------------------------------------------
ALTER TABLE public.youtube_app_videos
  ADD COLUMN tags text[],
  ADD COLUMN explore_next_at timestamptz;
CREATE INDEX youtube_app_videos_explore_due ON public.youtube_app_videos(explore_next_at) WHERE explore_next_at IS NOT NULL;
CREATE INDEX youtube_app_videos_short_recent ON public.youtube_app_videos(published_at DESC) WHERE duration_seconds <= 180;

CREATE TABLE public.youtube_app_video_keywords (
  video_id text NOT NULL REFERENCES public.youtube_app_videos(video_id) ON DELETE CASCADE,
  keyword text NOT NULL CHECK (char_length(keyword) BETWEEN 2 AND 30),
  PRIMARY KEY (video_id, keyword)
);
CREATE INDEX youtube_app_video_keywords_keyword ON public.youtube_app_video_keywords(keyword);

CREATE TABLE public.youtube_app_keyword_daily (
  keyword text NOT NULL,
  day date NOT NULL,
  view_gain bigint NOT NULL CHECK (view_gain >= 0),
  video_count integer NOT NULL CHECK (video_count >= 0),
  channel_count integer NOT NULL CHECK (channel_count >= 0),
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (keyword, day)
);
CREATE INDEX youtube_app_keyword_daily_day ON public.youtube_app_keyword_daily(day, view_gain DESC);

CREATE TABLE public.youtube_app_saved_keywords (
  keyword text PRIMARY KEY CHECK (char_length(keyword) BETWEEN 2 AND 30),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Explore job log; api_units counts quota units (search.list = 100), not requests.
CREATE TABLE public.youtube_app_explore_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job text NOT NULL CHECK (job IN ('discover','stats','shorts')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','partial','failed','skipped')),
  api_units integer NOT NULL DEFAULT 0 CHECK (api_units >= 0),
  items integer NOT NULL DEFAULT 0 CHECK (items >= 0),
  error_code text,
  detail jsonb
);
CREATE UNIQUE INDEX youtube_app_one_running_explore ON public.youtube_app_explore_runs(job) WHERE status='running';
CREATE INDEX youtube_app_explore_runs_recent ON public.youtube_app_explore_runs(started_at DESC);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['youtube_app_video_keywords','youtube_app_keyword_daily',
    'youtube_app_saved_keywords','youtube_app_explore_runs'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated',t);
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated',t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
    EXECUTE format('CREATE POLICY personal_app_read ON public.%I FOR SELECT TO anon, authenticated USING(true)',t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Quota accounting (YouTube resets at midnight Pacific time)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.youtube_app_quota_day_start() RETURNS timestamptz
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT date_trunc('day', now() AT TIME ZONE 'America/Los_Angeles') AT TIME ZONE 'America/Los_Angeles';
$$;

-- Units spent by the collectors today. Web search/trending calls are not logged and come on top.
CREATE FUNCTION public.youtube_app_api_units_today() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (coalesce((SELECT sum(api_requests) FROM public.youtube_app_sync_runs
            WHERE started_at >= public.youtube_app_quota_day_start()),0)
        + coalesce((SELECT sum(api_units) FROM public.youtube_app_explore_runs
            WHERE started_at >= public.youtube_app_quota_day_start()),0))::integer;
$$;

-- ---------------------------------------------------------------------------
-- View deltas: latest daily snapshot minus the exact snapshot N days earlier
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.youtube_app_refresh_channel_deltas(p_ids text[]) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  WITH latest AS (
    SELECT DISTINCT ON (s.channel_id) s.channel_id, s.bucket_at, s.view_count, s.collected_at
    FROM public.youtube_app_channel_metric_snapshots s
    WHERE s.channel_id = ANY(p_ids)
    ORDER BY s.channel_id, s.bucket_at DESC
  ), d AS (
    SELECT l.channel_id, l.view_count AS v, l.collected_at,
      (SELECT s.view_count FROM public.youtube_app_channel_metric_snapshots s WHERE s.channel_id=l.channel_id AND s.bucket_at=l.bucket_at-interval '1 day') AS v1,
      (SELECT s.view_count FROM public.youtube_app_channel_metric_snapshots s WHERE s.channel_id=l.channel_id AND s.bucket_at=l.bucket_at-interval '2 days') AS v2,
      (SELECT s.view_count FROM public.youtube_app_channel_metric_snapshots s WHERE s.channel_id=l.channel_id AND s.bucket_at=l.bucket_at-interval '7 days') AS v7,
      (SELECT s.view_count FROM public.youtube_app_channel_metric_snapshots s WHERE s.channel_id=l.channel_id AND s.bucket_at=l.bucket_at-interval '30 days') AS v30
    FROM latest l
  )
  UPDATE public.youtube_app_channels c SET
    -- Same total as yesterday usually means YouTube served a stale value; do not report it as zero growth.
    views_stale = coalesce(d.v = d.v1, false),
    view_delta_1d = CASE WHEN d.v = d.v1 THEN NULL ELSE d.v - d.v1 END,
    view_delta_2d = d.v - d.v2,
    view_delta_7d = d.v - d.v7,
    view_delta_30d = d.v - d.v30,
    deltas_at = d.collected_at
  FROM d WHERE c.channel_id = d.channel_id;
$$;

-- ---------------------------------------------------------------------------
-- Favorite collector: also store country/topics/tags/keywords (old payloads stay valid)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.youtube_app_store_keywords(p_video_id text, p_keywords jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_keywords IS NULL OR jsonb_typeof(p_keywords) <> 'array' THEN RETURN; END IF;
  DELETE FROM public.youtube_app_video_keywords WHERE video_id=p_video_id;
  INSERT INTO public.youtube_app_video_keywords(video_id,keyword)
  SELECT DISTINCT p_video_id, k FROM jsonb_array_elements_text(p_keywords) k
  WHERE char_length(k) BETWEEN 2 AND 30
  ON CONFLICT DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION public.youtube_app_finish_sync(p_run_id uuid,p_channel jsonb,p_videos jsonb,p_requests integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.youtube_app_sync_runs; f public.youtube_app_favorite_channels; v jsonb;
  n integer:=0; inserted integer; is_new_video boolean;
BEGIN
  SELECT * INTO r FROM public.youtube_app_sync_runs WHERE id=p_run_id FOR UPDATE;
  IF r.status IS DISTINCT FROM 'running' THEN RAISE EXCEPTION 'Expired or completed sync lease'; END IF;
  IF p_channel->>'channel_id' IS DISTINCT FROM r.channel_id THEN RAISE EXCEPTION 'Channel mismatch'; END IF;
  SELECT * INTO f FROM public.youtube_app_favorite_channels WHERE channel_id=r.channel_id FOR UPDATE;
  IF NOT FOUND THEN
    UPDATE public.youtube_app_sync_runs SET status='cancelled',finished_at=now() WHERE id=r.id;
    RETURN jsonb_build_object('cancelled',true);
  END IF;
  PERFORM 1 FROM public.youtube_app_channels WHERE channel_id=r.channel_id FOR UPDATE;
  UPDATE public.youtube_app_channels SET title=p_channel->>'title',thumbnail_url=p_channel->>'thumbnail_url',
    uploads_playlist_id=p_channel->>'uploads_playlist_id',subscriber_count=(p_channel->>'subscriber_count')::bigint,
    view_count=(p_channel->>'view_count')::bigint,video_count=(p_channel->>'video_count')::bigint,
    country=CASE WHEN p_channel ? 'country' THEN p_channel->>'country' ELSE country END,
    topic_ids=CASE WHEN jsonb_typeof(p_channel->'topic_ids')='array'
      THEN ARRAY(SELECT jsonb_array_elements_text(p_channel->'topic_ids')) ELSE topic_ids END,
    explore_status='active',
    last_success_at=r.started_at,next_sync_at=r.started_at+interval '3 hours',consecutive_failures=0,last_error=null,updated_at=now()
  WHERE channel_id=r.channel_id;
  INSERT INTO public.youtube_app_channel_metric_snapshots
  VALUES(r.channel_id,date_trunc('day',r.started_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',r.started_at,
    (p_channel->>'subscriber_count')::bigint,(p_channel->>'view_count')::bigint,(p_channel->>'video_count')::bigint)
  ON CONFLICT DO NOTHING;
  FOR v IN SELECT value FROM jsonb_array_elements(p_videos) LOOP
    IF v->>'channel_id' IS DISTINCT FROM r.channel_id THEN RAISE EXCEPTION 'Video channel mismatch'; END IF;
    IF EXISTS(SELECT 1 FROM public.youtube_app_videos WHERE video_id=v->>'video_id' AND channel_id<>r.channel_id)
      THEN RAISE EXCEPTION 'Video ownership mismatch'; END IF;
    SELECT NOT EXISTS(SELECT 1 FROM public.youtube_app_videos WHERE video_id=v->>'video_id') INTO is_new_video;
    INSERT INTO public.youtube_app_videos(video_id,channel_id,title,published_at,thumbnail_url,duration_seconds,
      view_count,like_count,comment_count,collected_at,tags)
    VALUES(v->>'video_id',r.channel_id,v->>'title',(v->>'published_at')::timestamptz,v->>'thumbnail_url',
      (v->>'duration_seconds')::integer,(v->>'view_count')::bigint,(v->>'like_count')::bigint,(v->>'comment_count')::bigint,r.started_at,
      CASE WHEN jsonb_typeof(v->'tags')='array' THEN ARRAY(SELECT jsonb_array_elements_text(v->'tags')) END)
    ON CONFLICT(video_id) DO UPDATE SET title=excluded.title,published_at=excluded.published_at,
      thumbnail_url=excluded.thumbnail_url,duration_seconds=excluded.duration_seconds,view_count=excluded.view_count,
      like_count=excluded.like_count,comment_count=excluded.comment_count,collected_at=excluded.collected_at,
      tags=coalesce(excluded.tags,public.youtube_app_videos.tags);
    PERFORM public.youtube_app_store_keywords(v->>'video_id',v->'keywords');
    INSERT INTO public.youtube_app_video_metric_snapshots
    VALUES(v->>'video_id',date_bin(interval '3 hours',r.started_at,timestamptz '2000-01-01 00:00:00+00'),r.started_at,
      (v->>'view_count')::bigint,(v->>'like_count')::bigint,(v->>'comment_count')::bigint) ON CONFLICT DO NOTHING;
    IF is_new_video AND (v->>'published_at')::timestamptz >= f.added_at THEN
      INSERT INTO public.youtube_app_video_notifications(video_id,video_title,channel_id,channel_title,published_at,thumbnail_url)
      VALUES(v->>'video_id',v->>'title',r.channel_id,p_channel->>'title',(v->>'published_at')::timestamptz,coalesce(v->>'thumbnail_url',''))
      ON CONFLICT(video_id) DO NOTHING;
      GET DIAGNOSTICS inserted=ROW_COUNT; n:=n+inserted;
    END IF;
  END LOOP;
  PERFORM public.youtube_app_refresh_channel_deltas(ARRAY[r.channel_id]);
  UPDATE public.youtube_app_favorite_channels SET channel_title=p_channel->>'title',
    channel_thumbnail=p_channel->>'thumbnail_url',subscriber_count=(p_channel->>'subscriber_count')::bigint,last_checked=r.started_at
  WHERE channel_id=r.channel_id;
  UPDATE public.youtube_app_sync_runs SET status='success',finished_at=now(),video_count=jsonb_array_length(p_videos),
    notification_count=n,api_requests=p_requests WHERE id=r.id;
  RETURN jsonb_build_object('videos',jsonb_array_length(p_videos),'notifications',n);
END $$;

-- ---------------------------------------------------------------------------
-- Explore worker RPCs (service_role only)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.youtube_app_explore_begin(p_job text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE run_id uuid;
BEGIN
  UPDATE public.youtube_app_explore_runs SET status='failed',finished_at=now(),error_code='lease_expired'
  WHERE status='running' AND started_at < now()-interval '10 minutes';
  -- After a quota error, pause every explore job until the next Pacific-time reset.
  IF EXISTS(SELECT 1 FROM public.youtube_app_explore_runs WHERE error_code IN ('quotaExceeded','dailyLimitExceeded')
      AND started_at >= public.youtube_app_quota_day_start()) THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.youtube_app_explore_runs(job) VALUES(p_job) ON CONFLICT DO NOTHING RETURNING id INTO run_id;
  RETURN run_id;
END $$;

CREATE FUNCTION public.youtube_app_explore_end(p_run_id uuid,p_status text,p_units integer,p_items integer,p_error text,p_detail jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.youtube_app_explore_runs SET status=p_status,finished_at=now(),api_units=greatest(p_units,0),
    items=greatest(p_items,0),error_code=left(p_error,80),detail=p_detail
  WHERE id=p_run_id AND status='running';
$$;

-- Register discovered channels as stubs; statistics arrive with the next stats batch. Pool is capped.
CREATE FUNCTION public.youtube_app_explore_register(p_channels jsonb,p_via text,p_cap integer DEFAULT 20000)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE remaining integer; inserted integer;
BEGIN
  IF p_via NOT IN ('chart','search','app') THEN RAISE EXCEPTION 'Invalid discovery source'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('youtube_app_explore_register',0));
  SELECT p_cap-count(*) INTO remaining FROM public.youtube_app_channels WHERE explore_status IN ('pending','active');
  IF remaining <= 0 THEN RETURN 0; END IF;
  INSERT INTO public.youtube_app_channels(channel_id,title,thumbnail_url,explore_status,discovered_via,discovered_at,stats_next_at)
  SELECT DISTINCT ON (c->>'channel_id') c->>'channel_id', left(coalesce(nullif(c->>'title',''),c->>'channel_id'),200),
    nullif(c->>'thumbnail_url',''),'pending',p_via,now(),now()
  FROM jsonb_array_elements(p_channels) c
  WHERE c->>'channel_id' ~ '^UC[A-Za-z0-9_-]{22}$'
    AND NOT EXISTS(SELECT 1 FROM public.youtube_app_channels x WHERE x.channel_id=c->>'channel_id')
  LIMIT remaining
  ON CONFLICT(channel_id) DO NOTHING;
  GET DIAGNOSTICS inserted=ROW_COUNT;
  RETURN inserted;
END $$;

-- Due non-favorite channels; a 30 minute lease prevents double processing.
CREATE FUNCTION public.youtube_app_explore_claim_stats(p_limit integer)
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

-- Save one batch of channels.list results. Snapshots use the same UTC day buckets as favorites.
CREATE FUNCTION public.youtube_app_explore_save_stats(p_channels jsonb,p_missing text[],p_min_subscribers integer DEFAULT 1000)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE saved integer; ids text[]; next_day timestamptz;
BEGIN
  next_day := (date_trunc('day', now() AT TIME ZONE 'UTC') + interval '1 day 1 hour') AT TIME ZONE 'UTC';
  WITH rows AS (
    SELECT * FROM jsonb_to_recordset(p_channels) AS x(channel_id text,title text,thumbnail_url text,uploads_playlist_id text,
      subscriber_count bigint,view_count bigint,video_count bigint,hidden_subscriber boolean,country text,topic_ids text[])
  ), updated AS (
    UPDATE public.youtube_app_channels c SET
      title=left(coalesce(nullif(r.title,''),c.title),200), thumbnail_url=r.thumbnail_url,
      uploads_playlist_id=r.uploads_playlist_id, subscriber_count=r.subscriber_count, view_count=r.view_count,
      video_count=r.video_count, hidden_subscriber=r.hidden_subscriber, country=r.country,
      topic_ids=coalesce(r.topic_ids,'{}'),
      explore_status=CASE WHEN r.hidden_subscriber OR r.subscriber_count>=p_min_subscribers THEN 'active' ELSE 'excluded' END,
      stats_success_at=now(),
      stats_next_at=CASE WHEN r.hidden_subscriber OR r.subscriber_count>=p_min_subscribers THEN next_day ELSE now()+interval '30 days' END,
      updated_at=now()
    FROM rows r WHERE c.channel_id=r.channel_id
    RETURNING c.channel_id, c.explore_status, r.subscriber_count, r.view_count, r.video_count
  ), snap AS (
    INSERT INTO public.youtube_app_channel_metric_snapshots(channel_id,bucket_at,collected_at,subscriber_count,view_count,video_count)
    SELECT u.channel_id, date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC', now(), u.subscriber_count, u.view_count, u.video_count
    FROM updated u WHERE u.explore_status='active'
    ON CONFLICT DO NOTHING
  )
  SELECT array_agg(channel_id) FILTER (WHERE explore_status='active'), count(*) INTO ids, saved FROM updated;
  IF ids IS NOT NULL THEN PERFORM public.youtube_app_refresh_channel_deltas(ids); END IF;
  UPDATE public.youtube_app_channels SET explore_status='unavailable', stats_next_at=now()+interval '30 days', updated_at=now()
  WHERE channel_id = ANY(coalesce(p_missing,'{}'))
    AND NOT EXISTS(SELECT 1 FROM public.youtube_app_favorite_channels f WHERE f.channel_id=youtube_app_channels.channel_id);
  RETURN saved;
END $$;

-- KR channels with the strongest recent growth get their newest uploads scanned once a day.
CREATE FUNCTION public.youtube_app_explore_claim_shorts_channels(p_limit integer,p_pool integer DEFAULT 800)
RETURNS TABLE(channel_id text, uploads_playlist_id text) LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  WITH ranked AS (
    SELECT c.channel_id FROM public.youtube_app_channels c
    WHERE c.country='KR' AND c.explore_status='active' AND c.uploads_playlist_id IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM public.youtube_app_favorite_channels f WHERE f.channel_id=c.channel_id)
    ORDER BY c.view_delta_7d DESC NULLS LAST, c.subscriber_count DESC NULLS LAST, c.channel_id
    LIMIT p_pool
  ), due AS (
    SELECT c.channel_id FROM public.youtube_app_channels c JOIN ranked USING(channel_id)
    WHERE coalesce(c.shorts_next_at,'-infinity') <= now()
    ORDER BY c.shorts_next_at NULLS FIRST, c.channel_id
    LIMIT least(greatest(p_limit,1),200)
    FOR UPDATE OF c SKIP LOCKED
  )
  UPDATE public.youtube_app_channels c SET shorts_next_at=now()+interval '30 minutes'
  FROM due WHERE c.channel_id=due.channel_id
  RETURNING c.channel_id, c.uploads_playlist_id;
$$;

CREATE FUNCTION public.youtube_app_explore_finish_shorts_channels(p_ids text[]) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.youtube_app_channels
  SET shorts_next_at=(date_trunc('day', now() AT TIME ZONE 'UTC') + interval '1 day 3 hours') AT TIME ZONE 'UTC'
  WHERE channel_id = ANY(p_ids);
$$;

-- Recent short videos of non-favorite channels whose daily refresh is due.
CREATE FUNCTION public.youtube_app_explore_claim_videos(p_limit integer)
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

-- Upsert short videos for explore channels with tags/keywords and one snapshot per 3-hour bucket.
CREATE FUNCTION public.youtube_app_explore_save_videos(p_videos jsonb,p_missing text[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v jsonb; saved integer:=0; next_day timestamptz; now_at timestamptz:=now();
BEGIN
  next_day := (date_trunc('day', now() AT TIME ZONE 'UTC') + interval '1 day 2 hours') AT TIME ZONE 'UTC';
  FOR v IN SELECT value FROM jsonb_array_elements(p_videos) LOOP
    IF NOT EXISTS(SELECT 1 FROM public.youtube_app_channels WHERE channel_id=v->>'channel_id') THEN CONTINUE; END IF;
    IF EXISTS(SELECT 1 FROM public.youtube_app_videos WHERE video_id=v->>'video_id' AND channel_id<>v->>'channel_id') THEN CONTINUE; END IF;
    INSERT INTO public.youtube_app_videos(video_id,channel_id,title,published_at,thumbnail_url,duration_seconds,
      view_count,like_count,comment_count,collected_at,tags,explore_next_at)
    VALUES(v->>'video_id',v->>'channel_id',v->>'title',(v->>'published_at')::timestamptz,v->>'thumbnail_url',
      (v->>'duration_seconds')::integer,(v->>'view_count')::bigint,(v->>'like_count')::bigint,(v->>'comment_count')::bigint,now_at,
      CASE WHEN jsonb_typeof(v->'tags')='array' THEN ARRAY(SELECT jsonb_array_elements_text(v->'tags')) END,next_day)
    ON CONFLICT(video_id) DO UPDATE SET title=excluded.title,thumbnail_url=excluded.thumbnail_url,
      duration_seconds=excluded.duration_seconds,view_count=excluded.view_count,like_count=excluded.like_count,
      comment_count=excluded.comment_count,collected_at=excluded.collected_at,
      tags=coalesce(excluded.tags,public.youtube_app_videos.tags),explore_next_at=excluded.explore_next_at;
    PERFORM public.youtube_app_store_keywords(v->>'video_id',v->'keywords');
    INSERT INTO public.youtube_app_video_metric_snapshots
    VALUES(v->>'video_id',date_bin(interval '3 hours',now_at,timestamptz '2000-01-01 00:00:00+00'),now_at,
      (v->>'view_count')::bigint,(v->>'like_count')::bigint,(v->>'comment_count')::bigint) ON CONFLICT DO NOTHING;
    saved:=saved+1;
  END LOOP;
  -- Deleted/private videos stop being refreshed; history stays.
  UPDATE public.youtube_app_videos SET explore_next_at=NULL WHERE video_id = ANY(coalesce(p_missing,'{}'));
  RETURN saved;
END $$;

-- ---------------------------------------------------------------------------
-- Keyword aggregation (KST days) and retention
-- ---------------------------------------------------------------------------
-- Gain per video = last measurement inside the day minus the last measurement before it
-- (at most 36h earlier). Videos published that day start from 0. Decreases count as 0.
-- Only keywords seen on 2+ channels that day are stored, to drop single-channel tag spam.
CREATE FUNCTION public.youtube_app_aggregate_keywords(p_day date) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE d0 timestamptz := p_day::timestamp AT TIME ZONE 'Asia/Seoul'; d1 timestamptz; stored integer;
BEGIN
  d1 := d0 + interval '1 day';
  DELETE FROM public.youtube_app_keyword_daily WHERE day=p_day;
  WITH vids AS (
    SELECT v.video_id, v.channel_id, v.published_at
    FROM public.youtube_app_videos v JOIN public.youtube_app_channels c ON c.channel_id=v.channel_id
    WHERE c.country='KR' AND v.duration_seconds <= 180
      AND v.published_at < d1 AND v.published_at >= d0 - interval '30 days'
  ), end_v AS (
    SELECT DISTINCT ON (s.video_id) s.video_id, s.view_count
    FROM public.youtube_app_video_metric_snapshots s JOIN vids ON vids.video_id=s.video_id
    WHERE s.collected_at >= d0 AND s.collected_at < d1 AND s.view_count IS NOT NULL
    ORDER BY s.video_id, s.collected_at DESC
  ), start_v AS (
    SELECT DISTINCT ON (s.video_id) s.video_id, s.view_count
    FROM public.youtube_app_video_metric_snapshots s JOIN vids ON vids.video_id=s.video_id
    WHERE s.collected_at < d0 AND s.collected_at >= d0 - interval '36 hours' AND s.view_count IS NOT NULL
    ORDER BY s.video_id, s.collected_at DESC
  ), gains AS (
    SELECT vids.video_id, vids.channel_id,
      greatest(0, e.view_count - CASE WHEN vids.published_at >= d0 THEN 0 ELSE s.view_count END) AS gain
    FROM vids JOIN end_v e ON e.video_id=vids.video_id LEFT JOIN start_v s ON s.video_id=vids.video_id
    WHERE vids.published_at >= d0 OR s.view_count IS NOT NULL
  )
  INSERT INTO public.youtube_app_keyword_daily(keyword,day,view_gain,video_count,channel_count)
  SELECT k.keyword, p_day, sum(g.gain), count(DISTINCT g.video_id), count(DISTINCT g.channel_id)
  FROM gains g JOIN public.youtube_app_video_keywords k ON k.video_id=g.video_id
  GROUP BY k.keyword
  HAVING count(DISTINCT g.channel_id) >= 2 AND sum(g.gain) > 0;
  GET DIAGNOSTICS stored=ROW_COUNT;
  RETURN stored;
END $$;

-- Explore history is kept 60 days; favorite-channel history keeps the original no-expiry policy.
CREATE FUNCTION public.youtube_app_explore_retention() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE cutoff timestamptz := now()-interval '60 days'; a integer; b integer; c integer;
BEGIN
  DELETE FROM public.youtube_app_channel_metric_snapshots s WHERE s.collected_at < cutoff
    AND NOT EXISTS(SELECT 1 FROM public.youtube_app_favorite_channels f WHERE f.channel_id=s.channel_id);
  GET DIAGNOSTICS a=ROW_COUNT;
  DELETE FROM public.youtube_app_video_metric_snapshots s USING public.youtube_app_videos v
  WHERE v.video_id=s.video_id AND s.collected_at < cutoff
    AND NOT EXISTS(SELECT 1 FROM public.youtube_app_favorite_channels f WHERE f.channel_id=v.channel_id);
  GET DIAGNOSTICS b=ROW_COUNT;
  DELETE FROM public.youtube_app_keyword_daily WHERE day < (now() AT TIME ZONE 'Asia/Seoul')::date - 60;
  GET DIAGNOSTICS c=ROW_COUNT;
  DELETE FROM public.youtube_app_explore_runs WHERE started_at < cutoff;
  RETURN jsonb_build_object('channel_snapshots',a,'video_snapshots',b,'keyword_days',c);
END $$;

CREATE FUNCTION public.youtube_app_daily_keywords() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
  -- Recompute the previous day too: late measurements can still land in it.
  RETURN jsonb_build_object(
    'yesterday', public.youtube_app_aggregate_keywords(today-1),
    'before', public.youtube_app_aggregate_keywords(today-2),
    'retention', public.youtube_app_explore_retention());
END $$;

-- ---------------------------------------------------------------------------
-- Read RPCs for the browser (aggregates only, no secrets)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.youtube_app_topic_counts()
RETURNS TABLE(topic_id text, channel_count bigint) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT t, count(*) FROM public.youtube_app_channels c, unnest(c.topic_ids) t
  WHERE c.explore_status='active' GROUP BY t
  UNION ALL
  SELECT '__none__', count(*) FROM public.youtube_app_channels c
  WHERE c.explore_status='active' AND c.topic_ids='{}';
$$;

-- Channel explore search. A selected period sorts by that view delta; otherwise by total views or subscribers.
-- Countries: KR/US/JP plus OTHER (missing or any other code). Topics: overlap, plus __none__ for unclassified.
CREATE FUNCTION public.youtube_app_search_channels(p_period text DEFAULT NULL, p_sort text DEFAULT 'views',
  p_sub_min bigint DEFAULT NULL, p_sub_max bigint DEFAULT NULL, p_video_min bigint DEFAULT NULL, p_video_max bigint DEFAULT NULL,
  p_countries text[] DEFAULT NULL, p_topics text[] DEFAULT NULL, p_query text DEFAULT NULL,
  p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS TABLE(channel_id text, title text, thumbnail_url text, country text, topic_ids text[], subscriber_count bigint,
  hidden_subscriber boolean, video_count bigint, view_count bigint, view_delta bigint, views_stale boolean,
  deltas_at timestamptz, is_favorite boolean, total_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH f AS (
    SELECT c.*, CASE p_period WHEN '1d' THEN c.view_delta_1d WHEN '2d' THEN c.view_delta_2d
      WHEN '7d' THEN c.view_delta_7d WHEN '30d' THEN c.view_delta_30d END AS delta
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
    f.video_count, f.view_count, f.delta, f.views_stale, f.deltas_at,
    EXISTS(SELECT 1 FROM public.youtube_app_favorite_channels fc WHERE fc.channel_id=f.channel_id),
    count(*) OVER ()
  FROM f
  ORDER BY CASE WHEN p_period IN ('1d','2d','7d','30d') THEN f.delta END DESC NULLS LAST,
    CASE WHEN p_sort='subscribers' THEN f.subscriber_count END DESC NULLS LAST,
    f.view_count DESC NULLS LAST, f.channel_id
  LIMIT least(greatest(p_limit,1),100) OFFSET least(greatest(p_offset,0),20000);
$$;

CREATE FUNCTION public.youtube_app_keyword_ranking(p_days integer,p_limit integer DEFAULT 100)
RETURNS TABLE(keyword text, view_gain bigint, video_count bigint, channel_count integer, series jsonb, latest_day date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH latest AS (SELECT max(day) AS day FROM public.youtube_app_keyword_daily),
  win AS (
    SELECT k.keyword, sum(k.view_gain)::bigint AS view_gain, sum(k.video_count)::bigint AS video_count,
      max(k.channel_count) AS channel_count
    FROM public.youtube_app_keyword_daily k, latest
    WHERE k.day > latest.day - least(greatest(p_days,1),14)
    GROUP BY k.keyword
    HAVING sum(k.video_count) >= 3
    ORDER BY 2 DESC, 1 LIMIT least(greatest(p_limit,1),1000)
  )
  SELECT w.keyword, w.view_gain, w.video_count, w.channel_count,
    (SELECT jsonb_agg(jsonb_build_object('day',d.day,'gain',d.view_gain) ORDER BY d.day)
     FROM public.youtube_app_keyword_daily d WHERE d.keyword=w.keyword AND d.day > latest.day-14),
    latest.day
  FROM win w, latest ORDER BY w.view_gain DESC, w.keyword;
$$;

CREATE FUNCTION public.youtube_app_keyword_series(p_keywords text[])
RETURNS TABLE(keyword text, series jsonb) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT k, (SELECT jsonb_agg(jsonb_build_object('day',d.day,'gain',d.view_gain) ORDER BY d.day)
    FROM public.youtube_app_keyword_daily d
    WHERE d.keyword=k AND d.day > (SELECT max(day) FROM public.youtube_app_keyword_daily)-14)
  FROM unnest(p_keywords[1:200]) k;
$$;

-- Videos carrying a keyword, with view gain across the window (0 baseline for videos published inside it).
CREATE FUNCTION public.youtube_app_keyword_videos(p_keyword text,p_days integer)
RETURNS TABLE(video_id text, channel_id text, channel_title text, title text, thumbnail_url text,
  published_at timestamptz, view_count bigint, view_gain bigint, collected_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH since AS (SELECT now()-make_interval(days=>least(greatest(p_days,1),7)) AS at)
  SELECT v.video_id, v.channel_id, c.title, v.title, v.thumbnail_url, v.published_at, v.view_count,
    CASE WHEN v.published_at >= since.at THEN v.view_count
      ELSE v.view_count - (SELECT s.view_count FROM public.youtube_app_video_metric_snapshots s
        WHERE s.video_id=v.video_id AND s.collected_at <= since.at AND s.collected_at >= since.at-interval '36 hours'
        ORDER BY s.collected_at DESC LIMIT 1) END,
    v.collected_at
  FROM public.youtube_app_video_keywords k
  JOIN public.youtube_app_videos v ON v.video_id=k.video_id
  JOIN public.youtube_app_channels c ON c.channel_id=v.channel_id, since
  WHERE k.keyword=p_keyword AND c.country='KR' AND v.duration_seconds <= 180
    AND v.published_at >= now()-interval '30 days'
  ORDER BY 8 DESC NULLS LAST, v.view_count DESC NULLS LAST LIMIT 100;
$$;

CREATE FUNCTION public.youtube_app_explore_status() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'units_today', public.youtube_app_api_units_today(),
    'quota_day_start', public.youtube_app_quota_day_start(),
    'quota_paused', EXISTS(SELECT 1 FROM public.youtube_app_explore_runs WHERE error_code IN ('quotaExceeded','dailyLimitExceeded')
      AND started_at >= public.youtube_app_quota_day_start()),
    'pool', (SELECT jsonb_build_object(
        'active', count(*) FILTER (WHERE explore_status='active'),
        'pending', count(*) FILTER (WHERE explore_status='pending'),
        'excluded', count(*) FILTER (WHERE explore_status='excluded'),
        'kr', count(*) FILTER (WHERE explore_status='active' AND country='KR'),
        'us', count(*) FILTER (WHERE explore_status='active' AND country='US'),
        'jp', count(*) FILTER (WHERE explore_status='active' AND country='JP'),
        'stats_latest', max(stats_success_at))
      FROM public.youtube_app_channels),
    'jobs', (SELECT coalesce(jsonb_object_agg(job, jsonb_build_object('finished_at',finished_at,'status',status,'error_code',error_code)),'{}')
      FROM (SELECT DISTINCT ON (job) job, finished_at, status, error_code FROM public.youtube_app_explore_runs
        WHERE status <> 'running' ORDER BY job, started_at DESC) j),
    'keyword_latest_day', (SELECT max(day) FROM public.youtube_app_keyword_daily),
    'keyword_computed_at', (SELECT max(computed_at) FROM public.youtube_app_keyword_daily));
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.youtube_app_quota_day_start(), public.youtube_app_api_units_today(),
  public.youtube_app_refresh_channel_deltas(text[]), public.youtube_app_store_keywords(text,jsonb),
  public.youtube_app_finish_sync(uuid,jsonb,jsonb,integer),
  public.youtube_app_explore_begin(text), public.youtube_app_explore_end(uuid,text,integer,integer,text,jsonb),
  public.youtube_app_explore_register(jsonb,text,integer), public.youtube_app_explore_claim_stats(integer),
  public.youtube_app_explore_save_stats(jsonb,text[],integer),
  public.youtube_app_explore_claim_shorts_channels(integer,integer), public.youtube_app_explore_finish_shorts_channels(text[]),
  public.youtube_app_explore_claim_videos(integer), public.youtube_app_explore_save_videos(jsonb,text[]),
  public.youtube_app_aggregate_keywords(date), public.youtube_app_explore_retention(), public.youtube_app_daily_keywords(),
  public.youtube_app_topic_counts(), public.youtube_app_keyword_ranking(integer,integer),
  public.youtube_app_keyword_series(text[]), public.youtube_app_keyword_videos(text,integer),
  public.youtube_app_explore_status(),
  public.youtube_app_search_channels(text,text,bigint,bigint,bigint,bigint,text[],text[],text,integer,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.youtube_app_quota_day_start(), public.youtube_app_api_units_today(),
  public.youtube_app_refresh_channel_deltas(text[]), public.youtube_app_store_keywords(text,jsonb),
  public.youtube_app_finish_sync(uuid,jsonb,jsonb,integer),
  public.youtube_app_explore_begin(text), public.youtube_app_explore_end(uuid,text,integer,integer,text,jsonb),
  public.youtube_app_explore_register(jsonb,text,integer), public.youtube_app_explore_claim_stats(integer),
  public.youtube_app_explore_save_stats(jsonb,text[],integer),
  public.youtube_app_explore_claim_shorts_channels(integer,integer), public.youtube_app_explore_finish_shorts_channels(text[]),
  public.youtube_app_explore_claim_videos(integer), public.youtube_app_explore_save_videos(jsonb,text[]),
  public.youtube_app_aggregate_keywords(date), public.youtube_app_explore_retention(), public.youtube_app_daily_keywords()
  TO service_role;
-- Read-only aggregates for the personal app (same exposure as the readable tables).
GRANT EXECUTE ON FUNCTION public.youtube_app_quota_day_start(), public.youtube_app_api_units_today(),
  public.youtube_app_topic_counts(), public.youtube_app_keyword_ranking(integer,integer),
  public.youtube_app_keyword_series(text[]), public.youtube_app_keyword_videos(text,integer),
  public.youtube_app_explore_status(),
  public.youtube_app_search_channels(text,text,bigint,bigint,bigint,bigint,text[],text[],text,integer,integer)
  TO anon, authenticated, service_role;

-- Backfill deltas for channels that already have history.
SELECT public.youtube_app_refresh_channel_deltas(ARRAY(SELECT channel_id FROM public.youtube_app_channels));

COMMENT ON TABLE public.youtube_app_keyword_daily IS
  'KST daily view gain of KR-channel videos <=180s per keyword. Only keywords seen on 2+ channels that day. Pool-relative, not all of YouTube.';
COMMIT;
