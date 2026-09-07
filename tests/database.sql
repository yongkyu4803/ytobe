\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE r record; r2 record; result jsonb; snapshots integer; caught boolean:=false;
BEGIN
  INSERT INTO public.youtube_app_favorite_channels(channel_id,channel_title,subscriber_count,added_at)
    VALUES('test-channel','테스트',null,now()-interval '1 day');
  IF NOT EXISTS(SELECT 1 FROM public.youtube_app_channels WHERE channel_id='test-channel') THEN RAISE EXCEPTION 'favorite trigger'; END IF;
  SELECT * INTO r FROM public.youtube_app_claim_sync(1);
  IF r.run_id IS NULL THEN RAISE EXCEPTION 'no claim'; END IF;
  IF EXISTS(SELECT 1 FROM public.youtube_app_claim_sync(1)) THEN RAISE EXCEPTION 'duplicate claim'; END IF;
  result:=public.youtube_app_finish_sync(r.run_id,
    jsonb_build_object('channel_id','test-channel','title','테스트','subscriber_count',null,'view_count','0'),
    jsonb_build_array(jsonb_build_object('video_id','test-video','channel_id','test-channel','title','영상','published_at',now(),
      'view_count','0','like_count',null,'comment_count','0')),3);
  IF (result->>'notifications')::int<>1 THEN RAISE EXCEPTION 'notification missing'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.youtube_app_video_metric_snapshots WHERE video_id='test-video' AND view_count=0 AND like_count IS NULL)
    THEN RAISE EXCEPTION 'zero/null not preserved'; END IF;
  IF EXISTS(SELECT 1 FROM public.youtube_app_video_growth WHERE video_id='test-video' AND view_delta IS NOT NULL)
    THEN RAISE EXCEPTION 'fabricated baseline'; END IF;
  BEGIN
    PERFORM public.youtube_app_finish_sync(r.run_id,'{}','[]',0);
  EXCEPTION WHEN raise_exception THEN caught:=true; END;
  IF NOT caught THEN RAISE EXCEPTION 'duplicate commit accepted'; END IF;
  UPDATE public.youtube_app_channels SET next_sync_at=now() WHERE channel_id='test-channel';
  SELECT * INTO r2 FROM public.youtube_app_claim_sync(1);
  caught:=false;
  BEGIN
    PERFORM public.youtube_app_finish_sync(r2.run_id,jsonb_build_object('channel_id','test-channel','title','bad','subscriber_count','-1'),'[]',0);
  EXCEPTION WHEN check_violation THEN caught:=true; END;
  IF NOT caught THEN RAISE EXCEPTION 'negative metric accepted'; END IF;
  IF EXISTS(SELECT 1 FROM public.youtube_app_channels WHERE channel_id='test-channel' AND title='bad') THEN RAISE EXCEPTION 'failed transaction leaked'; END IF;
  PERFORM public.youtube_app_fail_sync(r2.run_id,'quotaExceeded','test quota',1);
  IF NOT EXISTS(SELECT 1 FROM public.youtube_app_channels WHERE channel_id='test-channel' AND next_sync_at>=now()+interval '23 hours')
    THEN RAISE EXCEPTION 'quota backoff missing'; END IF;
  UPDATE public.youtube_app_channels SET next_sync_at=now() WHERE channel_id='test-channel';
  SELECT * INTO r2 FROM public.youtube_app_claim_sync(1);
  result:=public.youtube_app_finish_sync(r2.run_id,
    jsonb_build_object('channel_id','test-channel','title','테스트','subscriber_count',null,'view_count','0'),
    jsonb_build_array(jsonb_build_object('video_id','test-video','channel_id','test-channel','title','영상','published_at',now(),
      'view_count','1','like_count',null,'comment_count','0')),3);
  SELECT count(*) INTO snapshots FROM public.youtube_app_video_metric_snapshots WHERE video_id='test-video';
  IF snapshots<>1 THEN RAISE EXCEPTION 'duplicate bucket'; END IF;
  IF (SELECT count(*) FROM public.youtube_app_video_notifications WHERE video_id='test-video')<>1 THEN RAISE EXCEPTION 'duplicate notification'; END IF;
  UPDATE public.youtube_app_channels SET next_sync_at=now() WHERE channel_id='test-channel';
  SELECT * INTO r FROM public.youtube_app_claim_sync(1);
  result:=public.youtube_app_finish_sync(r.run_id,
    jsonb_build_object('channel_id','test-channel','title','테스트','subscriber_count',null,'view_count','0'),
    jsonb_build_array(jsonb_build_object('video_id','test-late-video','channel_id','test-channel','title','늦게 공개된 영상',
      'published_at',r2.started_at-interval '10 seconds','view_count','1','like_count',null,'comment_count','0')),3);
  IF (result->>'notifications')::int<>1 THEN RAISE EXCEPTION 'late discovery notification missing'; END IF;
  INSERT INTO public.youtube_app_video_metric_snapshots(video_id,bucket_at,collected_at,view_count)
    SELECT video_id,bucket_at+interval '3 hours',collected_at+interval '3 hours',30
    FROM public.youtube_app_video_metric_snapshots WHERE video_id='test-video';
  IF NOT EXISTS(SELECT 1 FROM public.youtube_app_video_growth WHERE video_id='test-video' AND view_delta=30 AND elapsed_hours=3 AND views_per_hour=10)
    THEN RAISE EXCEPTION 'growth must use actual measured interval'; END IF;
  UPDATE public.youtube_app_channels SET next_sync_at=now() WHERE channel_id='test-channel';
  SELECT * INTO r FROM public.youtube_app_claim_sync(1);
  UPDATE public.youtube_app_sync_runs SET started_at=now()-interval '11 minutes' WHERE id=r.run_id;
  SELECT * INTO r2 FROM public.youtube_app_claim_sync(1);
  IF r2.run_id IS NULL OR r.run_id=r2.run_id THEN RAISE EXCEPTION 'expired lease was not reclaimed'; END IF;
  caught:=false;
  BEGIN PERFORM public.youtube_app_finish_sync(r.run_id,'{}','[]',0);
  EXCEPTION WHEN raise_exception THEN caught:=true; END;
  IF NOT caught THEN RAISE EXCEPTION 'expired worker accepted'; END IF;
  DELETE FROM public.youtube_app_favorite_channels WHERE channel_id='test-channel';
  IF EXISTS(SELECT 1 FROM public.youtube_app_video_notifications WHERE channel_id='test-channel') THEN RAISE EXCEPTION 'notification not deleted'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.youtube_app_videos WHERE video_id='test-video') THEN RAISE EXCEPTION 'archive lost'; END IF;
END $$;
SET LOCAL ROLE anon;
SELECT count(*) FROM public.youtube_app_channels;
DO $$ BEGIN
  BEGIN PERFORM public.youtube_app_claim_sync(1); RAISE EXCEPTION 'anon claim allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO public.youtube_app_channels(channel_id,title) VALUES('forbidden','forbidden'); RAISE EXCEPTION 'anon write allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO public.youtube_app_favorite_folders(name) VALUES('forbidden'); RAISE EXCEPTION 'anon folder write allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE public.youtube_app_favorite_channels SET channel_title='forbidden'; RAISE EXCEPTION 'anon favorite update allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM public.youtube_app_video_notifications; RAISE EXCEPTION 'anon notification delete allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
