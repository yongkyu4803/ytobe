-- Single-user upgrade. Transactional; does not alter other applications' objects.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.youtube_app_favorite_channels
    WHERE subscriber_count IS NOT NULL AND
      CASE WHEN subscriber_count::text ~ '^[0-9]+$'
        THEN subscriber_count::numeric > 9223372036854775807 ELSE true END)
  THEN RAISE EXCEPTION 'Invalid subscriber counts: repair explicitly before migration'; END IF;
END $$;
ALTER TABLE public.youtube_app_favorite_channels ALTER COLUMN subscriber_count DROP NOT NULL;
ALTER TABLE public.youtube_app_favorite_channels ALTER COLUMN subscriber_count TYPE bigint USING subscriber_count::bigint;
ALTER TABLE public.youtube_app_favorite_channels ADD CONSTRAINT youtube_app_subscribers_nonnegative CHECK (subscriber_count >= 0);

CREATE TABLE public.youtube_app_channels (
  channel_id text PRIMARY KEY,
  title text NOT NULL,
  thumbnail_url text,
  uploads_playlist_id text,
  subscriber_count bigint CHECK (subscriber_count >= 0),
  view_count bigint CHECK (view_count >= 0),
  video_count bigint CHECK (video_count >= 0),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  next_sync_at timestamptz NOT NULL DEFAULT now(),
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.youtube_app_channels(channel_id,title,thumbnail_url,subscriber_count)
SELECT channel_id,channel_title,channel_thumbnail,subscriber_count FROM public.youtube_app_favorite_channels;
INSERT INTO public.youtube_app_channels(channel_id,title)
SELECT DISTINCT ON(channel_id) channel_id,channel_title FROM public.youtube_app_video_notifications
ON CONFLICT DO NOTHING;

CREATE TABLE public.youtube_app_videos (
  video_id text PRIMARY KEY,
  channel_id text NOT NULL REFERENCES public.youtube_app_channels(channel_id),
  title text NOT NULL,
  published_at timestamptz NOT NULL,
  thumbnail_url text,
  duration_seconds integer CHECK(duration_seconds >= 0),
  view_count bigint CHECK(view_count >= 0),
  like_count bigint CHECK(like_count >= 0),
  comment_count bigint CHECK(comment_count >= 0),
  collected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.youtube_app_videos(video_id,channel_id,title,published_at,thumbnail_url)
SELECT video_id,channel_id,video_title,published_at,thumbnail_url FROM public.youtube_app_video_notifications;
ALTER TABLE public.youtube_app_favorite_channels ADD CONSTRAINT youtube_app_favorite_channel_ref
FOREIGN KEY(channel_id) REFERENCES public.youtube_app_channels(channel_id);
ALTER TABLE public.youtube_app_video_notifications ADD CONSTRAINT youtube_app_notification_channel_ref
FOREIGN KEY(channel_id) REFERENCES public.youtube_app_channels(channel_id);

-- Keep existing browser clients compatible when a favorite is added.
CREATE FUNCTION public.youtube_app_ensure_channel() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.youtube_app_channels(channel_id,title,thumbnail_url,subscriber_count)
  VALUES(NEW.channel_id,NEW.channel_title,NEW.channel_thumbnail,NEW.subscriber_count)
  ON CONFLICT(channel_id) DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER youtube_app_ensure_favorite_channel BEFORE INSERT OR UPDATE OF channel_id
ON public.youtube_app_favorite_channels FOR EACH ROW EXECUTE FUNCTION public.youtube_app_ensure_channel();
REVOKE ALL ON FUNCTION public.youtube_app_ensure_channel() FROM PUBLIC;

CREATE TABLE public.youtube_app_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id text NOT NULL REFERENCES public.youtube_app_channels(channel_id),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running' CHECK(status IN ('running','success','failed','cancelled')),
  video_count integer NOT NULL DEFAULT 0,
  notification_count integer NOT NULL DEFAULT 0,
  api_requests integer NOT NULL DEFAULT 0,
  error_code text,
  error_message text
);
CREATE UNIQUE INDEX youtube_app_one_running_sync ON public.youtube_app_sync_runs(channel_id) WHERE status='running';
CREATE INDEX youtube_app_sync_history ON public.youtube_app_sync_runs(channel_id,started_at DESC);
CREATE INDEX youtube_app_due_channels ON public.youtube_app_channels(next_sync_at);
CREATE INDEX youtube_app_videos_channel_date ON public.youtube_app_videos(channel_id,published_at DESC,video_id);
CREATE INDEX youtube_app_favorites_folder_sort ON public.youtube_app_favorite_channels(folder_id,sort_order,channel_id);
CREATE INDEX youtube_app_notifications_unread_date ON public.youtube_app_video_notifications(notified_at DESC) WHERE NOT is_read;
-- These are already covered by UNIQUE constraint indexes.
DROP INDEX IF EXISTS public.idx_youtube_app_favorite_channels_channel_id;
DROP INDEX IF EXISTS public.idx_youtube_app_video_notifications_video_id;

CREATE TABLE public.youtube_app_channel_metric_snapshots (
  channel_id text NOT NULL REFERENCES public.youtube_app_channels(channel_id),
  bucket_at timestamptz NOT NULL,
  collected_at timestamptz NOT NULL,
  subscriber_count bigint CHECK(subscriber_count >= 0),
  view_count bigint CHECK(view_count >= 0),
  video_count bigint CHECK(video_count >= 0),
  PRIMARY KEY(channel_id,bucket_at)
);
CREATE TABLE public.youtube_app_video_metric_snapshots (
  video_id text NOT NULL REFERENCES public.youtube_app_videos(video_id),
  bucket_at timestamptz NOT NULL,
  collected_at timestamptz NOT NULL,
  view_count bigint CHECK(view_count >= 0),
  like_count bigint CHECK(like_count >= 0),
  comment_count bigint CHECK(comment_count >= 0),
  PRIMARY KEY(video_id,bucket_at)
);

-- Only workers can mutate collected content; the personal app may read it.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['youtube_app_channels','youtube_app_videos','youtube_app_sync_runs',
    'youtube_app_channel_metric_snapshots','youtube_app_video_metric_snapshots'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated',t);
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated',t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
    EXECUTE format('CREATE POLICY personal_app_read ON public.%I FOR SELECT TO anon, authenticated USING(true)',t);
  END LOOP;
END $$;

-- Claim a bounded batch using row locks; stale leases are fenced before retry.
CREATE FUNCTION public.youtube_app_claim_sync(p_limit integer DEFAULT 3)
RETURNS TABLE(run_id uuid, channel_id text, started_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c record; r public.youtube_app_sync_runs;
BEGIN
  UPDATE public.youtube_app_sync_runs SET status='failed',finished_at=now(),error_code='lease_expired',
    error_message='Previous worker did not finish within 10 minutes'
  WHERE status='running' AND youtube_app_sync_runs.started_at < now()-interval '10 minutes';
  FOR c IN SELECT ch.channel_id FROM public.youtube_app_channels ch
    WHERE ch.next_sync_at <= now()
      AND EXISTS(SELECT 1 FROM public.youtube_app_favorite_channels f WHERE f.channel_id=ch.channel_id)
      AND NOT EXISTS(SELECT 1 FROM public.youtube_app_sync_runs s WHERE s.channel_id=ch.channel_id AND s.status='running')
    ORDER BY ch.next_sync_at,ch.channel_id LIMIT greatest(1,least(p_limit,5)) FOR UPDATE OF ch SKIP LOCKED
  LOOP
    INSERT INTO public.youtube_app_sync_runs(channel_id) VALUES(c.channel_id) RETURNING * INTO r;
    UPDATE public.youtube_app_channels SET last_attempt_at=r.started_at WHERE youtube_app_channels.channel_id=c.channel_id;
    run_id:=r.id; channel_id:=r.channel_id; started_at:=r.started_at; RETURN NEXT;
  END LOOP;
END $$;

CREATE FUNCTION public.youtube_app_fail_sync(p_run_id uuid,p_code text,p_message text,p_requests integer DEFAULT 0)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.youtube_app_sync_runs;
BEGIN
  SELECT * INTO r FROM public.youtube_app_sync_runs WHERE id=p_run_id FOR UPDATE;
  IF r.status IS DISTINCT FROM 'running' THEN RETURN; END IF;
  UPDATE public.youtube_app_sync_runs SET status='failed',finished_at=now(),error_code=left(p_code,80),
    error_message=left(p_message,500),api_requests=p_requests WHERE id=p_run_id;
  UPDATE public.youtube_app_channels SET consecutive_failures=consecutive_failures+1,
    last_error=left(p_message,500),
    next_sync_at=now()+ CASE WHEN p_code IN ('quotaExceeded','dailyLimitExceeded') THEN interval '24 hours'
      ELSE make_interval(mins=>least(180,15*power(2,least(consecutive_failures,4))::integer)) END
  WHERE channel_id=r.channel_id;
END $$;

-- One transaction: metadata + snapshots + notifications + success cursor.
CREATE FUNCTION public.youtube_app_finish_sync(p_run_id uuid,p_channel jsonb,p_videos jsonb,p_requests integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.youtube_app_sync_runs; f public.youtube_app_favorite_channels; v jsonb;
  notification_since timestamptz; previous_success timestamptz; n integer:=0; inserted integer;
BEGIN
  SELECT * INTO r FROM public.youtube_app_sync_runs WHERE id=p_run_id FOR UPDATE;
  IF r.status IS DISTINCT FROM 'running' THEN RAISE EXCEPTION 'Expired or completed sync lease'; END IF;
  IF p_channel->>'channel_id' IS DISTINCT FROM r.channel_id THEN RAISE EXCEPTION 'Channel mismatch'; END IF;
  SELECT * INTO f FROM public.youtube_app_favorite_channels WHERE channel_id=r.channel_id FOR UPDATE;
  IF NOT FOUND THEN
    UPDATE public.youtube_app_sync_runs SET status='cancelled',finished_at=now() WHERE id=r.id;
    RETURN jsonb_build_object('cancelled',true);
  END IF;
  SELECT last_success_at INTO previous_success FROM public.youtube_app_channels WHERE channel_id=r.channel_id FOR UPDATE;
  notification_since:=coalesce(previous_success,f.last_checked,f.added_at);
  UPDATE public.youtube_app_channels SET title=p_channel->>'title',thumbnail_url=p_channel->>'thumbnail_url',
    uploads_playlist_id=p_channel->>'uploads_playlist_id',subscriber_count=(p_channel->>'subscriber_count')::bigint,
    view_count=(p_channel->>'view_count')::bigint,video_count=(p_channel->>'video_count')::bigint,
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
    INSERT INTO public.youtube_app_videos(video_id,channel_id,title,published_at,thumbnail_url,duration_seconds,
      view_count,like_count,comment_count,collected_at)
    VALUES(v->>'video_id',r.channel_id,v->>'title',(v->>'published_at')::timestamptz,v->>'thumbnail_url',
      (v->>'duration_seconds')::integer,(v->>'view_count')::bigint,(v->>'like_count')::bigint,(v->>'comment_count')::bigint,r.started_at)
    ON CONFLICT(video_id) DO UPDATE SET title=excluded.title,published_at=excluded.published_at,
      thumbnail_url=excluded.thumbnail_url,duration_seconds=excluded.duration_seconds,view_count=excluded.view_count,
      like_count=excluded.like_count,comment_count=excluded.comment_count,collected_at=excluded.collected_at;
    INSERT INTO public.youtube_app_video_metric_snapshots
    VALUES(v->>'video_id',date_bin(interval '3 hours',r.started_at,timestamptz '2000-01-01 00:00:00+00'),r.started_at,
      (v->>'view_count')::bigint,(v->>'like_count')::bigint,(v->>'comment_count')::bigint) ON CONFLICT DO NOTHING;
    IF (v->>'published_at')::timestamptz > notification_since THEN
      INSERT INTO public.youtube_app_video_notifications(video_id,video_title,channel_id,channel_title,published_at,thumbnail_url)
      VALUES(v->>'video_id',v->>'title',r.channel_id,p_channel->>'title',(v->>'published_at')::timestamptz,coalesce(v->>'thumbnail_url',''))
      ON CONFLICT(video_id) DO NOTHING;
      GET DIAGNOSTICS inserted=ROW_COUNT; n:=n+inserted;
    END IF;
  END LOOP;
  UPDATE public.youtube_app_favorite_channels SET channel_title=p_channel->>'title',
    channel_thumbnail=p_channel->>'thumbnail_url',subscriber_count=(p_channel->>'subscriber_count')::bigint,last_checked=r.started_at
  WHERE channel_id=r.channel_id;
  UPDATE public.youtube_app_sync_runs SET status='success',finished_at=now(),video_count=jsonb_array_length(p_videos),
    notification_count=n,api_requests=p_requests WHERE id=r.id;
  RETURN jsonb_build_object('videos',jsonb_array_length(p_videos),'notifications',n);
END $$;

-- Delete notifications and favorite atomically, including older callers deleting directly.
CREATE FUNCTION public.youtube_app_delete_favorite_notifications() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN DELETE FROM public.youtube_app_video_notifications WHERE channel_id=OLD.channel_id; RETURN OLD; END $$;
CREATE TRIGGER youtube_app_delete_favorite_notifications AFTER DELETE ON public.youtube_app_favorite_channels
FOR EACH ROW EXECUTE FUNCTION public.youtube_app_delete_favorite_notifications();
REVOKE ALL ON FUNCTION public.youtube_app_delete_favorite_notifications() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.youtube_app_claim_sync(integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.youtube_app_fail_sync(uuid,text,text,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.youtube_app_finish_sync(uuid,jsonb,jsonb,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.youtube_app_claim_sync(integer),public.youtube_app_fail_sync(uuid,text,text,integer),
  public.youtube_app_finish_sync(uuid,jsonb,jsonb,integer) TO service_role;

-- Real measured intervals; missing previous values stay NULL; decreases remain visible.
CREATE VIEW public.youtube_app_video_growth WITH(security_invoker=true) AS
SELECT video_id,collected_at,view_count,previous_collected_at,previous_view_count,
  view_count-previous_view_count AS view_delta,
  extract(epoch FROM collected_at-previous_collected_at)/3600 AS elapsed_hours,
  (view_count-previous_view_count)::numeric / nullif(extract(epoch FROM collected_at-previous_collected_at)/3600,0) AS views_per_hour
FROM (SELECT video_id,collected_at,view_count,
  lag(collected_at) OVER w AS previous_collected_at,lag(view_count) OVER w AS previous_view_count
  FROM public.youtube_app_video_metric_snapshots WINDOW w AS(PARTITION BY video_id ORDER BY collected_at)) s;
CREATE VIEW public.youtube_app_channel_growth WITH(security_invoker=true) AS
SELECT channel_id,collected_at,subscriber_count,previous_collected_at,
  subscriber_count-previous_subscriber_count AS subscriber_delta,
  (subscriber_count-previous_subscriber_count)::numeric*100/nullif(previous_subscriber_count,0) AS growth_percent
FROM (SELECT channel_id,collected_at,subscriber_count,
  lag(collected_at) OVER w AS previous_collected_at,lag(subscriber_count) OVER w AS previous_subscriber_count
  FROM public.youtube_app_channel_metric_snapshots WINDOW w AS(PARTITION BY channel_id ORDER BY collected_at)) s;
GRANT SELECT ON public.youtube_app_video_growth,public.youtube_app_channel_growth TO anon,authenticated,service_role;
COMMENT ON TABLE public.youtube_app_video_metric_snapshots IS 'Measured metrics; one observation per UTC 3-hour bucket. NULL means unavailable. No synthetic history.';
COMMIT;
