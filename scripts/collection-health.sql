-- One JSON result so the Management API returns all sections, not only the last SELECT.
SELECT jsonb_build_object(
  'counts', (SELECT jsonb_build_object(
    'folders',(SELECT count(*) FROM public.youtube_app_favorite_folders),
    'favorites',(SELECT count(*) FROM public.youtube_app_favorite_channels),
    'collected_channels',(SELECT count(*) FROM public.youtube_app_channels c JOIN public.youtube_app_favorite_channels f USING(channel_id) WHERE c.last_success_at IS NOT NULL),
    'channels_with_errors',(SELECT count(*) FROM public.youtube_app_channels c JOIN public.youtube_app_favorite_channels f USING(channel_id) WHERE c.last_error IS NOT NULL),
    'collected_videos',(SELECT count(*) FROM public.youtube_app_videos WHERE collected_at IS NOT NULL),
    'channel_snapshots',(SELECT count(*) FROM public.youtube_app_channel_metric_snapshots),
    'video_snapshots',(SELECT count(*) FROM public.youtube_app_video_metric_snapshots),
    'notifications',(SELECT count(*) FROM public.youtube_app_video_notifications))),
  'runs',(SELECT jsonb_agg(s) FROM (SELECT status,count(*) AS runs,sum(video_count) AS videos,sum(api_requests) AS api_requests
    FROM public.youtube_app_sync_runs GROUP BY status) s),
  'schedule',(SELECT jsonb_agg(s) FROM (SELECT jobname,schedule,active FROM cron.job WHERE jobname='youtube-app-collection') s),
  'recent_dispatches',(SELECT jsonb_agg(s) FROM (SELECT r.status,r.start_time,r.end_time FROM cron.job_run_details r
    JOIN cron.job j ON j.jobid=r.jobid WHERE j.jobname='youtube-app-collection' ORDER BY r.start_time DESC LIMIT 5) s)
) AS health;
