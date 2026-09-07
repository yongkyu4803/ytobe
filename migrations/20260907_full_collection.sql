-- Resumable full collection batches for the single-user application.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE public.youtube_app_full_syncs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed')),
  total_channels integer NOT NULL DEFAULT 0 CHECK (total_channels >= 0),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE UNIQUE INDEX youtube_app_one_active_full_sync
  ON public.youtube_app_full_syncs ((true)) WHERE status IN ('queued','running');

CREATE TABLE public.youtube_app_full_sync_items (
  full_sync_id uuid NOT NULL REFERENCES public.youtube_app_full_syncs(id) ON DELETE CASCADE,
  channel_id text NOT NULL REFERENCES public.youtube_app_channels(channel_id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','success','failed','skipped')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 2),
  started_at timestamptz,
  finished_at timestamptz,
  last_error text,
  PRIMARY KEY (full_sync_id,channel_id)
);

CREATE INDEX youtube_app_full_sync_pending
  ON public.youtube_app_full_sync_items(full_sync_id,status,attempts,channel_id);

ALTER TABLE public.youtube_app_sync_runs
  ADD COLUMN full_sync_id uuid REFERENCES public.youtube_app_full_syncs(id);
CREATE INDEX youtube_app_sync_runs_full_sync
  ON public.youtube_app_sync_runs(full_sync_id,started_at DESC) WHERE full_sync_id IS NOT NULL;

ALTER TABLE public.youtube_app_full_syncs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.youtube_app_full_sync_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.youtube_app_full_syncs, public.youtube_app_full_sync_items FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.youtube_app_full_syncs, public.youtube_app_full_sync_items TO service_role;

CREATE FUNCTION public.youtube_app_start_full_sync() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE batch public.youtube_app_full_syncs; total integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('youtube_app_full_sync_start',0));
  SELECT * INTO batch FROM public.youtube_app_full_syncs
    WHERE status IN ('queued','running') ORDER BY started_at LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object('id',batch.id,'total',batch.total_channels,'resumed',true);
  END IF;

  SELECT count(*) INTO total FROM public.youtube_app_favorite_channels;
  INSERT INTO public.youtube_app_full_syncs(total_channels,status,finished_at)
    VALUES(total,CASE WHEN total=0 THEN 'completed' ELSE 'queued' END,CASE WHEN total=0 THEN now() ELSE NULL END)
    RETURNING * INTO batch;
  INSERT INTO public.youtube_app_full_sync_items(full_sync_id,channel_id)
    SELECT batch.id,f.channel_id FROM public.youtube_app_favorite_channels f;
  RETURN jsonb_build_object('id',batch.id,'total',total,'resumed',false);
END $$;

CREATE FUNCTION public.youtube_app_active_full_sync() RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = '' STABLE AS $$
  SELECT id FROM public.youtube_app_full_syncs
  WHERE status IN ('queued','running') ORDER BY started_at LIMIT 1;
$$;

CREATE FUNCTION public.youtube_app_full_sync_status(p_full_sync_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = '' STABLE AS $$
  SELECT jsonb_build_object(
    'id',b.id,
    'status',b.status,
    'total',b.total_channels,
    'completed',count(i.*) FILTER (WHERE i.status IN ('success','failed','skipped')),
    'succeeded',count(i.*) FILTER (WHERE i.status='success'),
    'failed',count(i.*) FILTER (WHERE i.status='failed'),
    'skipped',count(i.*) FILTER (WHERE i.status='skipped'),
    'pending',count(i.*) FILTER (WHERE i.status='pending'),
    'running',count(i.*) FILTER (WHERE i.status='running'),
    'retrying',count(i.*) FILTER (WHERE i.status='pending' AND i.attempts>0),
    'startedAt',b.started_at,
    'finishedAt',b.finished_at
  )
  FROM public.youtube_app_full_syncs b
  LEFT JOIN public.youtube_app_full_sync_items i ON i.full_sync_id=b.id
  WHERE b.id=p_full_sync_id
  GROUP BY b.id;
$$;

CREATE FUNCTION public.youtube_app_claim_full_sync(p_full_sync_id uuid,p_limit integer DEFAULT 3)
RETURNS TABLE(run_id uuid,channel_id text,started_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE item record; run public.youtube_app_sync_runs; available_slots integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('youtube_app_sync_global',0));

  UPDATE public.youtube_app_sync_runs r SET status='failed',finished_at=now(),error_code='lease_expired',
    error_message='Previous worker did not finish within 10 minutes'
  WHERE r.status='running' AND r.started_at < now()-interval '10 minutes';

  UPDATE public.youtube_app_full_sync_items i SET status='skipped',finished_at=now(),last_error='Channel is no longer a favorite'
  WHERE i.full_sync_id=p_full_sync_id AND i.status='pending'
    AND NOT EXISTS(SELECT 1 FROM public.youtube_app_favorite_channels f WHERE f.channel_id=i.channel_id);

  IF NOT EXISTS(SELECT 1 FROM public.youtube_app_full_syncs WHERE id=p_full_sync_id AND status IN ('queued','running') FOR UPDATE)
    THEN RETURN; END IF;
  UPDATE public.youtube_app_full_syncs SET status='running' WHERE id=p_full_sync_id AND status='queued';

  SELECT greatest(0,3-count(*)) INTO available_slots
    FROM public.youtube_app_sync_runs WHERE status='running';
  IF available_slots=0 THEN RETURN; END IF;

  FOR item IN
    SELECT i.channel_id FROM public.youtube_app_full_sync_items i
    JOIN public.youtube_app_favorite_channels f ON f.channel_id=i.channel_id
    WHERE i.full_sync_id=p_full_sync_id AND i.status='pending' AND i.attempts<2
      AND NOT EXISTS(SELECT 1 FROM public.youtube_app_sync_runs r WHERE r.channel_id=i.channel_id AND r.status='running')
    ORDER BY i.attempts,f.sort_order,i.channel_id
    LIMIT least(greatest(p_limit,1),5,available_slots)
    FOR UPDATE OF i SKIP LOCKED
  LOOP
    UPDATE public.youtube_app_full_sync_items SET status='running',attempts=attempts+1,
      started_at=now(),finished_at=NULL WHERE full_sync_id=p_full_sync_id AND youtube_app_full_sync_items.channel_id=item.channel_id;
    INSERT INTO public.youtube_app_sync_runs(channel_id,full_sync_id)
      VALUES(item.channel_id,p_full_sync_id) RETURNING * INTO run;
    UPDATE public.youtube_app_channels SET last_attempt_at=run.started_at WHERE youtube_app_channels.channel_id=item.channel_id;
    run_id:=run.id; channel_id:=run.channel_id; started_at:=run.started_at; RETURN NEXT;
  END LOOP;

  IF NOT EXISTS(SELECT 1 FROM public.youtube_app_full_sync_items
    WHERE full_sync_id=p_full_sync_id AND status IN ('pending','running')) THEN
    UPDATE public.youtube_app_full_syncs SET status='completed',finished_at=now() WHERE id=p_full_sync_id;
  END IF;
END $$;

CREATE FUNCTION public.youtube_app_update_full_sync_item() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.full_sync_id IS NULL OR OLD.status IS DISTINCT FROM 'running' OR NEW.status='running' THEN RETURN NEW; END IF;

  IF NEW.status='success' THEN
    UPDATE public.youtube_app_full_sync_items SET status='success',finished_at=coalesce(NEW.finished_at,now()),last_error=NULL
      WHERE full_sync_id=NEW.full_sync_id AND channel_id=NEW.channel_id;
  ELSIF NEW.status='cancelled' THEN
    UPDATE public.youtube_app_full_sync_items SET status='skipped',finished_at=coalesce(NEW.finished_at,now()),last_error='Channel is no longer a favorite'
      WHERE full_sync_id=NEW.full_sync_id AND channel_id=NEW.channel_id;
  ELSIF NEW.status='failed' THEN
    UPDATE public.youtube_app_full_sync_items SET
      status=CASE WHEN attempts<2 AND coalesce(NEW.error_code,'') NOT IN ('quotaExceeded','dailyLimitExceeded') THEN 'pending' ELSE 'failed' END,
      finished_at=CASE WHEN attempts<2 AND coalesce(NEW.error_code,'') NOT IN ('quotaExceeded','dailyLimitExceeded') THEN NULL ELSE coalesce(NEW.finished_at,now()) END,
      last_error=coalesce(NEW.error_message,NEW.error_code,'Collection failed')
      WHERE full_sync_id=NEW.full_sync_id AND channel_id=NEW.channel_id;
  END IF;

  IF NOT EXISTS(SELECT 1 FROM public.youtube_app_full_sync_items
    WHERE full_sync_id=NEW.full_sync_id AND status IN ('pending','running')) THEN
    UPDATE public.youtube_app_full_syncs SET status='completed',finished_at=now() WHERE id=NEW.full_sync_id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER youtube_app_update_full_sync_item
AFTER UPDATE OF status ON public.youtube_app_sync_runs
FOR EACH ROW EXECUTE FUNCTION public.youtube_app_update_full_sync_item();

-- Scheduled work leaves channels in an active full sweep to the full-sweep claimant.
CREATE OR REPLACE FUNCTION public.youtube_app_claim_sync(p_limit integer DEFAULT 3)
RETURNS TABLE(run_id uuid,channel_id text,started_at timestamptz)
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
      AND NOT EXISTS(
        SELECT 1 FROM public.youtube_app_full_sync_items i
        JOIN public.youtube_app_full_syncs b ON b.id=i.full_sync_id
        WHERE i.channel_id=ch.channel_id AND i.status IN ('pending','running') AND b.status IN ('queued','running')
      )
    ORDER BY ch.next_sync_at,ch.channel_id
    LIMIT least(greatest(p_limit,1),5,available_slots) FOR UPDATE OF ch SKIP LOCKED
  LOOP
    INSERT INTO public.youtube_app_sync_runs(channel_id) VALUES(c.channel_id) RETURNING * INTO r;
    UPDATE public.youtube_app_channels SET last_attempt_at=r.started_at WHERE youtube_app_channels.channel_id=c.channel_id;
    run_id:=r.id; channel_id:=r.channel_id; started_at:=r.started_at; RETURN NEXT;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.youtube_app_start_full_sync() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.youtube_app_active_full_sync() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.youtube_app_full_sync_status(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.youtube_app_claim_full_sync(uuid,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.youtube_app_update_full_sync_item() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.youtube_app_claim_sync(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.youtube_app_start_full_sync(),public.youtube_app_active_full_sync(),
  public.youtube_app_full_sync_status(uuid),public.youtube_app_claim_full_sync(uuid,integer),
  public.youtube_app_claim_sync(integer) TO service_role;

COMMIT;
