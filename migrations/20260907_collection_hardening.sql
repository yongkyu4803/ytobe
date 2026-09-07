-- Single-user hardening: browser reads stay public; all mutations move to the server API.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.youtube_app_favorite_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.youtube_app_favorite_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.youtube_app_video_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all access to favorite_folders" ON public.youtube_app_favorite_folders;
DROP POLICY IF EXISTS "Allow all access to favorite_channels" ON public.youtube_app_favorite_channels;
DROP POLICY IF EXISTS "Allow all access to video_notifications" ON public.youtube_app_video_notifications;
DROP POLICY IF EXISTS youtube_app_personal_read ON public.youtube_app_favorite_folders;
DROP POLICY IF EXISTS youtube_app_personal_read ON public.youtube_app_favorite_channels;
DROP POLICY IF EXISTS youtube_app_personal_read ON public.youtube_app_video_notifications;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.youtube_app_favorite_folders, public.youtube_app_favorite_channels,
     public.youtube_app_video_notifications FROM anon, authenticated;
GRANT SELECT ON public.youtube_app_favorite_folders, public.youtube_app_favorite_channels,
  public.youtube_app_video_notifications TO anon, authenticated;
GRANT ALL ON public.youtube_app_favorite_folders, public.youtube_app_favorite_channels,
  public.youtube_app_video_notifications TO service_role;

CREATE POLICY youtube_app_personal_read ON public.youtube_app_favorite_folders
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY youtube_app_personal_read ON public.youtube_app_favorite_channels
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY youtube_app_personal_read ON public.youtube_app_video_notifications
  FOR SELECT TO anon, authenticated USING (true);

-- Serialize claims and allow no more than three globally running channel jobs.
CREATE OR REPLACE FUNCTION public.youtube_app_claim_sync(p_limit integer DEFAULT 3)
RETURNS TABLE(run_id uuid, channel_id text, started_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c record; r public.youtube_app_sync_runs; available_slots integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('youtube_app_sync_global',0));
  UPDATE public.youtube_app_sync_runs SET status='failed',finished_at=now(),error_code='lease_expired',
    error_message='Previous worker did not finish within 10 minutes'
  WHERE status='running' AND youtube_app_sync_runs.started_at < now()-interval '10 minutes';
  SELECT greatest(0,3-count(*)) INTO available_slots FROM public.youtube_app_sync_runs WHERE status='running';
  IF available_slots=0 THEN RETURN; END IF;
  FOR c IN SELECT ch.channel_id FROM public.youtube_app_channels ch
    WHERE ch.next_sync_at <= now()
      AND EXISTS(SELECT 1 FROM public.youtube_app_favorite_channels f WHERE f.channel_id=ch.channel_id)
      AND NOT EXISTS(SELECT 1 FROM public.youtube_app_sync_runs s WHERE s.channel_id=ch.channel_id AND s.status='running')
    ORDER BY ch.next_sync_at,ch.channel_id
    LIMIT least(greatest(p_limit,1),5,available_slots) FOR UPDATE OF ch SKIP LOCKED
  LOOP
    INSERT INTO public.youtube_app_sync_runs(channel_id) VALUES(c.channel_id) RETURNING * INTO r;
    UPDATE public.youtube_app_channels SET last_attempt_at=r.started_at WHERE youtube_app_channels.channel_id=c.channel_id;
    run_id:=r.id; channel_id:=r.channel_id; started_at:=r.started_at; RETURN NEXT;
  END LOOP;
END $$;

-- Notify only when a video is first discovered during the current favorite period.
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
      view_count,like_count,comment_count,collected_at)
    VALUES(v->>'video_id',r.channel_id,v->>'title',(v->>'published_at')::timestamptz,v->>'thumbnail_url',
      (v->>'duration_seconds')::integer,(v->>'view_count')::bigint,(v->>'like_count')::bigint,(v->>'comment_count')::bigint,r.started_at)
    ON CONFLICT(video_id) DO UPDATE SET title=excluded.title,published_at=excluded.published_at,
      thumbnail_url=excluded.thumbnail_url,duration_seconds=excluded.duration_seconds,view_count=excluded.view_count,
      like_count=excluded.like_count,comment_count=excluded.comment_count,collected_at=excluded.collected_at;
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
  UPDATE public.youtube_app_favorite_channels SET channel_title=p_channel->>'title',
    channel_thumbnail=p_channel->>'thumbnail_url',subscriber_count=(p_channel->>'subscriber_count')::bigint,last_checked=r.started_at
  WHERE channel_id=r.channel_id;
  UPDATE public.youtube_app_sync_runs SET status='success',finished_at=now(),video_count=jsonb_array_length(p_videos),
    notification_count=n,api_requests=p_requests WHERE id=r.id;
  RETURN jsonb_build_object('videos',jsonb_array_length(p_videos),'notifications',n);
END $$;

-- Lets the worker recover the authoritative DB result after an ambiguous network response.
CREATE OR REPLACE FUNCTION public.youtube_app_sync_result(p_run_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN r.status='success' THEN jsonb_build_object(
    'status',r.status,'videos',r.video_count,'notifications',r.notification_count,'apiRequests',r.api_requests
  ) ELSE jsonb_build_object('status',coalesce(r.status,'missing')) END
  FROM public.youtube_app_sync_runs r WHERE r.id=p_run_id;
$$;

REVOKE ALL ON FUNCTION public.youtube_app_claim_sync(integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.youtube_app_finish_sync(uuid,jsonb,jsonb,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.youtube_app_sync_result(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.youtube_app_claim_sync(integer),
  public.youtube_app_finish_sync(uuid,jsonb,jsonb,integer),public.youtube_app_sync_result(uuid) TO service_role;

COMMIT;
