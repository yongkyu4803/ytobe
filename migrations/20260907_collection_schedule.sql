-- Apply after the worker is deployed and its URL/token are in Vault.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE OR REPLACE FUNCTION public.youtube_app_dispatch_sync() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE endpoint text; token text; request_id bigint;
BEGIN
  SELECT decrypted_secret INTO endpoint FROM vault.decrypted_secrets WHERE name='youtube_app_sync_url';
  SELECT decrypted_secret INTO token FROM vault.decrypted_secrets WHERE name='youtube_app_sync_token';
  IF endpoint IS NULL OR token IS NULL THEN RAISE EXCEPTION 'YouTube collection secrets are not configured'; END IF;
  SELECT net.http_post(url:=endpoint,headers:=jsonb_build_object('Content-Type','application/json','x-youtube-sync-secret',token),
    body:='{}'::jsonb,timeout_milliseconds:=120000) INTO request_id;
  RETURN request_id;
END $$;
REVOKE ALL ON FUNCTION public.youtube_app_dispatch_sync() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.youtube_app_dispatch_sync() TO service_role;
SELECT cron.schedule('youtube-app-collection','*/5 * * * *','SELECT public.youtube_app_dispatch_sync();');
COMMIT;
