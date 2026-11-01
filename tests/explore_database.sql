\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE a text:='UC'||repeat('a',22); b text:='UC'||repeat('b',22); c text:='UC'||repeat('c',22); d text:='UC'||repeat('d',22);
  n integer; run1 uuid; run2 uuid; r record; result jsonb; day0 date; d0 timestamptz; today_bucket timestamptz;
BEGIN
  -- Registration: invalid IDs ignored, duplicates ignored, cap enforced.
  n:=public.youtube_app_explore_register(jsonb_build_array(
    jsonb_build_object('channel_id',a,'title','A'),jsonb_build_object('channel_id',b,'title','B'),
    jsonb_build_object('channel_id',c,'title','C'),jsonb_build_object('channel_id','bad','title','X'),
    jsonb_build_object('channel_id',a,'title','A again')),'chart');
  IF n<>3 THEN RAISE EXCEPTION 'register count %',n; END IF;
  IF public.youtube_app_explore_register(jsonb_build_array(jsonb_build_object('channel_id',d,'title','D')),'search',
    (SELECT count(*)::integer FROM public.youtube_app_channels WHERE explore_status IN ('pending','active')))<>0
    THEN RAISE EXCEPTION 'pool cap ignored'; END IF;

  -- Stats claim leases; second claim returns nothing.
  SELECT count(*) INTO n FROM public.youtube_app_explore_claim_stats(10);
  IF n<>3 THEN RAISE EXCEPTION 'stats claim %',n; END IF;
  IF EXISTS(SELECT 1 FROM public.youtube_app_explore_claim_stats(10)) THEN RAISE EXCEPTION 'stats lease ignored'; END IF;

  -- Save: KR active with topics, tiny channel excluded, deleted channel unavailable.
  n:=public.youtube_app_explore_save_stats(jsonb_build_array(
    jsonb_build_object('channel_id',a,'title','A','uploads_playlist_id','UUa','subscriber_count','5000','view_count','1000',
      'video_count','10','hidden_subscriber',false,'country','KR','topic_ids',jsonb_build_array('Food','Lifestyle_(sociology)')),
    jsonb_build_object('channel_id',b,'title','B','subscriber_count','10','view_count','5','video_count','1','hidden_subscriber',false,
      'country','US','topic_ids',jsonb_build_array())),ARRAY[c],1000);
  IF n<>2 THEN RAISE EXCEPTION 'save count %',n; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.youtube_app_channels WHERE channel_id=a AND explore_status='active' AND country='KR'
    AND topic_ids=ARRAY['Food','Lifestyle_(sociology)'] AND stats_next_at>now()) THEN RAISE EXCEPTION 'active save'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.youtube_app_channels WHERE channel_id=b AND explore_status='excluded' AND stats_next_at>now()+interval '29 days')
    THEN RAISE EXCEPTION 'small channel not excluded'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.youtube_app_channels WHERE channel_id=c AND explore_status='unavailable') THEN RAISE EXCEPTION 'missing channel'; END IF;
  IF (SELECT count(*) FROM public.youtube_app_channel_metric_snapshots WHERE channel_id IN (a,b))<>1 THEN RAISE EXCEPTION 'snapshot only for active'; END IF;

  -- Deltas use exact daily buckets; missing history stays NULL; unchanged totals are stale, not zero growth.
  today_bucket:=date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  INSERT INTO public.youtube_app_channel_metric_snapshots(channel_id,bucket_at,collected_at,view_count) VALUES
    (a,today_bucket-interval '2 days',now()-interval '2 days',700),(a,today_bucket-interval '7 days',now()-interval '7 days',100);
  PERFORM public.youtube_app_refresh_channel_deltas(ARRAY[a]);
  IF NOT EXISTS(SELECT 1 FROM public.youtube_app_channels WHERE channel_id=a AND view_delta_1d IS NULL AND view_delta_2d=300
    AND view_delta_7d=900 AND view_delta_30d IS NULL AND NOT views_stale) THEN RAISE EXCEPTION 'delta calculation'; END IF;
  INSERT INTO public.youtube_app_channel_metric_snapshots(channel_id,bucket_at,collected_at,view_count)
    VALUES(a,today_bucket-interval '1 day',now()-interval '1 day',1000);
  PERFORM public.youtube_app_refresh_channel_deltas(ARRAY[a]);
  IF NOT EXISTS(SELECT 1 FROM public.youtube_app_channels WHERE channel_id=a AND views_stale AND view_delta_1d IS NULL AND view_delta_2d=300)
    THEN RAISE EXCEPTION 'stale detection'; END IF;

  -- Topic counts include unclassified.
  INSERT INTO public.youtube_app_channels(channel_id,title,explore_status) VALUES(d,'D','active');
  IF NOT EXISTS(SELECT 1 FROM public.youtube_app_topic_counts() WHERE topic_id='Food' AND channel_count=1)
    OR NOT EXISTS(SELECT 1 FROM public.youtube_app_topic_counts() WHERE topic_id='__none__' AND channel_count>=1)
    THEN RAISE EXCEPTION 'topic counts'; END IF;

  -- Search: filters, unclassified/other buckets, period ordering and totals.
  IF (SELECT channel_id FROM public.youtube_app_search_channels(p_period=>'2d') LIMIT 1)<>a THEN RAISE EXCEPTION 'period sort'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.youtube_app_search_channels(p_countries=>ARRAY['OTHER'],p_topics=>ARRAY['__none__']) WHERE channel_id=d)
    OR EXISTS(SELECT 1 FROM public.youtube_app_search_channels(p_countries=>ARRAY['KR']) WHERE channel_id=d)
    THEN RAISE EXCEPTION 'country/topic buckets'; END IF;
  IF (SELECT total_count FROM public.youtube_app_search_channels(p_topics=>ARRAY['Food'],p_sub_min=>1000,p_sub_max=>9999,p_query=>'a') LIMIT 1)<>1
    THEN RAISE EXCEPTION 'search filters'; END IF;
  IF EXISTS(SELECT 1 FROM public.youtube_app_search_channels(p_query=>'%')) THEN RAISE EXCEPTION 'query wildcard not escaped'; END IF;

  -- Shorts channel claim, video save with keywords, finish cursor.
  SELECT * INTO r FROM public.youtube_app_explore_claim_shorts_channels(10,800);
  IF r.channel_id IS DISTINCT FROM a OR r.uploads_playlist_id<>'UUa' THEN RAISE EXCEPTION 'shorts claim'; END IF;
  UPDATE public.youtube_app_channels SET country='KR' WHERE channel_id=d;
  n:=public.youtube_app_explore_save_videos(jsonb_build_array(
    jsonb_build_object('video_id','vid-a-00001','channel_id',a,'title','라면 #먹방','published_at',now()-interval '3 days',
      'duration_seconds',40,'view_count','300','tags',jsonb_build_array('라면'),'keywords',jsonb_build_array('먹방','라면')),
    jsonb_build_object('video_id','vid-a-00002','channel_id',a,'title','김치 #먹방','published_at',now()-interval '3 days',
      'duration_seconds',50,'view_count','300','keywords',jsonb_build_array('먹방','김치')),
    jsonb_build_object('video_id','vid-d-00001','channel_id',d,'title','치킨 #먹방','published_at',now()-interval '3 days',
      'duration_seconds',60,'view_count','300','keywords',jsonb_build_array('먹방','치킨')),
    jsonb_build_object('video_id','vid-x-00001','channel_id','UC'||repeat('z',22),'title','unknown channel','published_at',now(),
      'duration_seconds',10,'view_count','1')),'{}');
  IF n<>3 THEN RAISE EXCEPTION 'video save %',n; END IF;
  IF (SELECT count(*) FROM public.youtube_app_video_keywords WHERE keyword='먹방')<>3 THEN RAISE EXCEPTION 'keywords stored'; END IF;
  PERFORM public.youtube_app_explore_finish_shorts_channels(ARRAY[a]);
  IF EXISTS(SELECT 1 FROM public.youtube_app_explore_claim_shorts_channels(10,800) WHERE channel_id=a) THEN RAISE EXCEPTION 'shorts cursor'; END IF;

  -- Keyword aggregation for yesterday (KST): gain = in-day last - previous last; single-channel keywords dropped.
  day0:=(now() AT TIME ZONE 'Asia/Seoul')::date-1; d0:=day0::timestamp AT TIME ZONE 'Asia/Seoul';
  DELETE FROM public.youtube_app_video_metric_snapshots WHERE video_id LIKE 'vid-%';
  INSERT INTO public.youtube_app_video_metric_snapshots(video_id,bucket_at,collected_at,view_count)
  SELECT v, d0+interval '1 hour'*o, d0+interval '1 hour'*o, val FROM (VALUES
    ('vid-a-00001',-6,100),('vid-a-00001',10,300),('vid-a-00002',-6,100),('vid-a-00002',10,250),
    ('vid-d-00001',-6,100),('vid-d-00001',10,150),('vid-d-00001',20,140)) x(v,o,val);
  n:=public.youtube_app_aggregate_keywords(day0);
  IF NOT EXISTS(SELECT 1 FROM public.youtube_app_keyword_daily WHERE keyword='먹방' AND day=day0
    AND view_gain=40+150+200 AND video_count=3 AND channel_count=2) THEN RAISE EXCEPTION 'keyword gain'; END IF;
  IF EXISTS(SELECT 1 FROM public.youtube_app_keyword_daily WHERE keyword IN ('라면','김치')) THEN RAISE EXCEPTION 'single-channel keyword kept'; END IF;
  IF public.youtube_app_aggregate_keywords(day0)<>n THEN RAISE EXCEPTION 'aggregation not idempotent'; END IF;
  IF (SELECT count(*) FROM public.youtube_app_keyword_daily WHERE day=day0)<>n THEN RAISE EXCEPTION 'duplicate keyword rows'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.youtube_app_keyword_ranking(7,100) WHERE keyword='먹방' AND view_gain=390 AND jsonb_array_length(series)=1)
    THEN RAISE EXCEPTION 'ranking'; END IF;
  IF (SELECT count(*) FROM public.youtube_app_keyword_videos('먹방',7))<>3 THEN RAISE EXCEPTION 'keyword videos'; END IF;

  -- Runs: one running per job; quota error pauses the day; units are summed.
  run1:=public.youtube_app_explore_begin('stats');
  IF run1 IS NULL OR public.youtube_app_explore_begin('stats') IS NOT NULL THEN RAISE EXCEPTION 'run lease'; END IF;
  PERFORM public.youtube_app_explore_end(run1,'success',250,10,null,'{}');
  IF public.youtube_app_api_units_today()<250 THEN RAISE EXCEPTION 'units today'; END IF;
  run2:=public.youtube_app_explore_begin('discover');
  PERFORM public.youtube_app_explore_end(run2,'failed',100,0,'quotaExceeded',null);
  IF public.youtube_app_explore_begin('shorts') IS NOT NULL THEN RAISE EXCEPTION 'quota pause ignored'; END IF;
  result:=public.youtube_app_explore_status();
  IF NOT (result->>'quota_paused')::boolean OR (result->'pool'->>'active')::integer<2 THEN RAISE EXCEPTION 'status %',result; END IF;

  -- Favorite collector stores country/topics/keywords and keeps working with old payloads.
  INSERT INTO public.youtube_app_favorite_channels(channel_id,channel_title,subscriber_count,added_at)
    VALUES('fav-explore','즐겨찾기',null,now()-interval '1 day');
  SELECT * INTO r FROM public.youtube_app_claim_sync(1);
  PERFORM public.youtube_app_finish_sync(r.run_id,
    jsonb_build_object('channel_id','fav-explore','title','즐겨찾기','view_count','10','country','JP','topic_ids',jsonb_build_array('Music')),
    jsonb_build_array(jsonb_build_object('video_id','fav-video-1','channel_id','fav-explore','title','노래 #커버','published_at',now(),
      'view_count','1','tags',jsonb_build_array('cover'),'keywords',jsonb_build_array('커버','노래'))),2);
  IF NOT EXISTS(SELECT 1 FROM public.youtube_app_channels WHERE channel_id='fav-explore' AND country='JP' AND topic_ids=ARRAY['Music']
    AND explore_status='active') THEN RAISE EXCEPTION 'favorite channel explore fields'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.youtube_app_videos WHERE video_id='fav-video-1' AND tags=ARRAY['cover'])
    OR (SELECT count(*) FROM public.youtube_app_video_keywords WHERE video_id='fav-video-1')<>2 THEN RAISE EXCEPTION 'favorite video keywords'; END IF;
  UPDATE public.youtube_app_channels SET next_sync_at=now() WHERE channel_id='fav-explore';
  SELECT * INTO r FROM public.youtube_app_claim_sync(1);
  PERFORM public.youtube_app_finish_sync(r.run_id,jsonb_build_object('channel_id','fav-explore','title','즐겨찾기','view_count','11'),'[]',1);
  IF NOT EXISTS(SELECT 1 FROM public.youtube_app_channels WHERE channel_id='fav-explore' AND country='JP' AND topic_ids=ARRAY['Music'])
    THEN RAISE EXCEPTION 'old payload erased explore fields'; END IF;
  IF EXISTS(SELECT 1 FROM public.youtube_app_explore_claim_stats(100) WHERE channel_id='fav-explore') THEN RAISE EXCEPTION 'favorite claimed by explore'; END IF;

  -- Retention removes old explore history but never favorite history.
  INSERT INTO public.youtube_app_channel_metric_snapshots(channel_id,bucket_at,collected_at,view_count) VALUES
    (a,today_bucket-interval '90 days',now()-interval '90 days',1),('fav-explore',today_bucket-interval '90 days',now()-interval '90 days',1);
  result:=public.youtube_app_explore_retention();
  IF EXISTS(SELECT 1 FROM public.youtube_app_channel_metric_snapshots WHERE channel_id=a AND collected_at<now()-interval '60 days')
    OR NOT EXISTS(SELECT 1 FROM public.youtube_app_channel_metric_snapshots WHERE channel_id='fav-explore' AND collected_at<now()-interval '60 days')
    THEN RAISE EXCEPTION 'retention scope'; END IF;
END $$;
SET LOCAL ROLE anon;
SELECT count(*) AS topics FROM public.youtube_app_topic_counts();
SELECT count(*) AS channels FROM public.youtube_app_search_channels();
SELECT count(*) AS ranking FROM public.youtube_app_keyword_ranking(7,100);
SELECT public.youtube_app_explore_status() IS NOT NULL AS status_readable;
DO $$ BEGIN
  BEGIN PERFORM public.youtube_app_explore_register('[]','app'); RAISE EXCEPTION 'anon register allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.youtube_app_explore_save_stats('[]','{}'); RAISE EXCEPTION 'anon save allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.youtube_app_aggregate_keywords(current_date); RAISE EXCEPTION 'anon aggregate allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO public.youtube_app_saved_keywords(keyword) VALUES('금지'); RAISE EXCEPTION 'anon keyword write allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
