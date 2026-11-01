-- Apply after the youtube-app-explore Edge Function is deployed.
-- Reuses the existing Vault entries: the sync URL (function name swapped) and the shared worker token.
BEGIN;
CREATE OR REPLACE FUNCTION public.youtube_app_dispatch_explore(p_job text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE endpoint text; token text; request_id bigint;
BEGIN
  IF p_job NOT IN ('discover','stats','shorts') THEN RAISE EXCEPTION 'Unknown explore job'; END IF;
  SELECT replace(decrypted_secret,'/functions/v1/youtube-app-sync','/functions/v1/youtube-app-explore') INTO endpoint
    FROM vault.decrypted_secrets WHERE name='youtube_app_sync_url';
  SELECT decrypted_secret INTO token FROM vault.decrypted_secrets WHERE name='youtube_app_sync_token';
  IF endpoint IS NULL OR token IS NULL OR endpoint NOT LIKE '%/youtube-app-explore' THEN
    RAISE EXCEPTION 'YouTube explore secrets are not configured';
  END IF;
  SELECT net.http_post(url:=endpoint,headers:=jsonb_build_object('Content-Type','application/json','x-youtube-sync-secret',token),
    body:=jsonb_build_object('job',p_job),timeout_milliseconds:=150000) INTO request_id;
  RETURN request_id;
END $$;
REVOKE ALL ON FUNCTION public.youtube_app_dispatch_explore(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.youtube_app_dispatch_explore(text) TO service_role;

-- 08:30 UTC = 17:30 KST, right after the Pacific-time quota reset.
SELECT cron.schedule('youtube-app-explore-discover','30 8 * * *','SELECT public.youtube_app_dispatch_explore(''discover'');');
SELECT cron.schedule('youtube-app-explore-stats','*/10 * * * *','SELECT public.youtube_app_dispatch_explore(''stats'');');
SELECT cron.schedule('youtube-app-explore-shorts','5-59/10 * * * *','SELECT public.youtube_app_dispatch_explore(''shorts'');');
-- 15:40 UTC = 00:40 KST: aggregate the KST day that just ended, then apply retention.
SELECT cron.schedule('youtube-app-keywords','40 15 * * *','SELECT public.youtube_app_daily_keywords();');
COMMIT;
