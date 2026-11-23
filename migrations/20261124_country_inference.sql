-- Country inference for channels without an official country.
--
-- snippet.country is an optional owner setting: ~20% of active channels (incl. 쯔양) leave it empty and were
-- shown as 미분류. The official value stays in `country`; an estimate goes to `country_inferred` with its source:
--   language  : owner's defaultLanguage (ko/ja), else Hangul/kana dominating the channel title + description
--   discovery : the channel surfaced in exactly one region's popular chart / channel search (KR, US, JP)
-- Language wins over discovery (a Korean channel can chart in Japan). Latin-only text gives no language
-- evidence, so English-language channels are only placed when a single region's chart found them.
BEGIN;

ALTER TABLE public.youtube_app_channels
  ADD COLUMN IF NOT EXISTS discovered_regions text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS default_language text,
  ADD COLUMN IF NOT EXISTS lang_hint text CHECK (lang_hint IN ('ko','ja')),
  ADD COLUMN IF NOT EXISTS country_inferred text,
  ADD COLUMN IF NOT EXISTS country_source text CHECK (country_source IN ('official','language','discovery'));

-- Same rule as scriptHint() in supabase/functions/_shared/channel.mjs.
CREATE OR REPLACE FUNCTION public.youtube_app_script_hint(p_text text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN h >= 2 AND h >= k THEN 'ko' WHEN k >= 2 THEN 'ja' END
  FROM (SELECT pg_catalog.regexp_count(coalesce(p_text,''), '[가-힣]') AS h,
               pg_catalog.regexp_count(coalesce(p_text,''), '[ぁ-ゟ゠-ヿ]') AS k) x;
$$;

CREATE OR REPLACE FUNCTION public.youtube_app_infer_country(p_ids text[]) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  WITH e AS (
    SELECT c.channel_id, c.country,
      CASE WHEN c.default_language LIKE 'ko%' THEN 'KR' WHEN c.default_language LIKE 'ja%' THEN 'JP'
        ELSE CASE coalesce(c.lang_hint, public.youtube_app_script_hint(c.title)) WHEN 'ko' THEN 'KR' WHEN 'ja' THEN 'JP' END
      END AS by_language,
      CASE WHEN cardinality(c.discovered_regions) = 1 THEN c.discovered_regions[1] END AS by_discovery
    FROM public.youtube_app_channels c WHERE c.channel_id = ANY(p_ids)
  )
  UPDATE public.youtube_app_channels c SET
    country_inferred = CASE WHEN e.country IS NULL THEN coalesce(e.by_language, e.by_discovery) END,
    country_source = CASE WHEN e.country IS NOT NULL THEN 'official'
      WHEN e.by_language IS NOT NULL THEN 'language' WHEN e.by_discovery IS NOT NULL THEN 'discovery' END
  FROM e WHERE c.channel_id = e.channel_id;
$$;

-- Register now also merges the regions that surfaced a channel, for new and already-known channels.
CREATE OR REPLACE FUNCTION public.youtube_app_explore_register(p_channels jsonb, p_via text, p_cap integer DEFAULT 20000)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE remaining integer; inserted integer; touched text[];
BEGIN
  IF p_via NOT IN ('chart','search','app') THEN RAISE EXCEPTION 'Invalid discovery source'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('youtube_app_explore_register',0));

  WITH r AS (
    SELECT c->>'channel_id' AS id, array_agg(DISTINCT upper(x) ORDER BY upper(x)) AS regions
    FROM jsonb_array_elements(p_channels) c,
      jsonb_array_elements_text(CASE WHEN jsonb_typeof(c->'regions')='array' THEN c->'regions' ELSE '[]'::jsonb END) x
    WHERE x ~ '^[A-Za-z]{2}$'
    GROUP BY 1
  ), upd AS (
    UPDATE public.youtube_app_channels ch SET discovered_regions =
      (SELECT array_agg(DISTINCT e ORDER BY e) FROM unnest(ch.discovered_regions || r.regions) e)
    FROM r WHERE ch.channel_id = r.id AND NOT (r.regions <@ ch.discovered_regions)
    RETURNING ch.channel_id
  )
  SELECT array_agg(channel_id) INTO touched FROM upd;
  IF touched IS NOT NULL THEN PERFORM public.youtube_app_infer_country(touched); END IF;

  SELECT p_cap-count(*) INTO remaining FROM public.youtube_app_channels WHERE explore_status IN ('pending','active');
  IF remaining <= 0 THEN RETURN 0; END IF;
  INSERT INTO public.youtube_app_channels(channel_id,title,thumbnail_url,explore_status,discovered_via,discovered_at,stats_next_at,discovered_regions)
  SELECT DISTINCT ON (c->>'channel_id') c->>'channel_id', left(coalesce(nullif(c->>'title',''),c->>'channel_id'),200),
    nullif(c->>'thumbnail_url',''),'pending',p_via,now(),now(),
    coalesce((SELECT array_agg(DISTINCT upper(x) ORDER BY upper(x))
      FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(c->'regions')='array' THEN c->'regions' ELSE '[]'::jsonb END) x
      WHERE x ~ '^[A-Za-z]{2}$'), '{}')
  FROM jsonb_array_elements(p_channels) c
  WHERE c->>'channel_id' ~ '^UC[A-Za-z0-9_-]{22}$'
    AND NOT EXISTS(SELECT 1 FROM public.youtube_app_channels x WHERE x.channel_id=c->>'channel_id')
  LIMIT remaining
  ON CONFLICT(channel_id) DO NOTHING;
  GET DIAGNOSTICS inserted=ROW_COUNT;
  RETURN inserted;
END $$;

-- Stats save stores the language evidence the collector extracts (no extra API cost) and re-infers.
CREATE OR REPLACE FUNCTION public.youtube_app_explore_save_stats(p_channels jsonb, p_missing text[], p_min_subscribers integer DEFAULT 1000)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE saved integer; ids text[]; all_ids text[]; next_day timestamptz;
BEGIN
  next_day := (date_trunc('day', now() AT TIME ZONE 'UTC') + interval '1 day 1 hour') AT TIME ZONE 'UTC';
  WITH rows AS (
    SELECT * FROM jsonb_to_recordset(p_channels) AS x(channel_id text,title text,thumbnail_url text,uploads_playlist_id text,
      subscriber_count bigint,view_count bigint,video_count bigint,hidden_subscriber boolean,country text,topic_ids text[],
      default_language text,lang_hint text)
  ), updated AS (
    UPDATE public.youtube_app_channels c SET
      title=left(coalesce(nullif(r.title,''),c.title),200), thumbnail_url=r.thumbnail_url,
      uploads_playlist_id=r.uploads_playlist_id, subscriber_count=r.subscriber_count, view_count=r.view_count,
      video_count=r.video_count, hidden_subscriber=r.hidden_subscriber, country=r.country,
      topic_ids=coalesce(r.topic_ids,'{}'),
      default_language=left(r.default_language,16),
      lang_hint=CASE WHEN r.lang_hint IN ('ko','ja') THEN r.lang_hint END,
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
  SELECT array_agg(channel_id) FILTER (WHERE explore_status='active'), array_agg(channel_id), count(*)
    INTO ids, all_ids, saved FROM updated;
  IF ids IS NOT NULL THEN PERFORM public.youtube_app_refresh_channel_deltas(ids); END IF;
  IF all_ids IS NOT NULL THEN PERFORM public.youtube_app_infer_country(all_ids); END IF;
  UPDATE public.youtube_app_channels SET explore_status='unavailable', stats_next_at=now()+interval '30 days', updated_at=now()
  WHERE channel_id = ANY(coalesce(p_missing,'{}'))
    AND NOT EXISTS(SELECT 1 FROM public.youtube_app_favorite_channels f WHERE f.channel_id=youtube_app_channels.channel_id);
  RETURN saved;
END $$;

-- Search filters and buckets by the effective country (official, else inferred) and returns both.
DROP FUNCTION public.youtube_app_search_channels(text, text, bigint, bigint, bigint, bigint, text[], text[], text, integer, integer);
CREATE FUNCTION public.youtube_app_search_channels(p_period text DEFAULT NULL, p_sort text DEFAULT 'views',
  p_sub_min bigint DEFAULT NULL, p_sub_max bigint DEFAULT NULL, p_video_min bigint DEFAULT NULL, p_video_max bigint DEFAULT NULL,
  p_countries text[] DEFAULT NULL, p_topics text[] DEFAULT NULL, p_query text DEFAULT NULL,
  p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS TABLE(channel_id text, title text, thumbnail_url text, country text, topic_ids text[], subscriber_count bigint,
  hidden_subscriber boolean, video_count bigint, view_count bigint, view_delta bigint, views_stale boolean,
  view_delta_suspect boolean, deltas_at timestamptz, is_favorite boolean, total_count bigint,
  country_inferred text, country_source text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH f AS (
    SELECT c.*, coalesce(c.country, c.country_inferred) AS effective_country,
      CASE p_period WHEN '1d' THEN c.view_delta_1d WHEN '2d' THEN c.view_delta_2d
      WHEN '7d' THEN c.view_delta_7d WHEN '30d' THEN c.view_delta_30d END AS delta,
      coalesce(c.view_anomaly_days < CASE p_period WHEN '1d' THEN 1 WHEN '2d' THEN 2 WHEN '7d' THEN 7 WHEN '30d' THEN 30 END, false) AS suspect
    FROM public.youtube_app_channels c
    WHERE c.explore_status='active'
      AND (p_sub_min IS NULL OR c.subscriber_count >= p_sub_min)
      AND (p_sub_max IS NULL OR c.subscriber_count <= p_sub_max)
      AND (p_video_min IS NULL OR c.video_count >= p_video_min)
      AND (p_video_max IS NULL OR c.video_count <= p_video_max)
      AND (coalesce(cardinality(p_countries),0)=0 OR coalesce(c.country, c.country_inferred) = ANY(p_countries)
        OR ('OTHER' = ANY(p_countries) AND (coalesce(c.country, c.country_inferred) IS NULL
          OR coalesce(c.country, c.country_inferred) NOT IN ('KR','US','JP'))))
      AND (coalesce(cardinality(p_topics),0)=0 OR c.topic_ids && p_topics
        OR ('__none__' = ANY(p_topics) AND c.topic_ids='{}'))
      AND (coalesce(p_query,'')='' OR c.title ILIKE '%'||replace(replace(replace(left(p_query,100),'\','\\'),'%','\%'),'_','\_')||'%')
  )
  SELECT f.channel_id, f.title, f.thumbnail_url, f.country, f.topic_ids, f.subscriber_count, f.hidden_subscriber,
    f.video_count, f.view_count, f.delta, f.views_stale, f.suspect, f.deltas_at,
    EXISTS(SELECT 1 FROM public.youtube_app_favorite_channels fc WHERE fc.channel_id=f.channel_id),
    count(*) OVER (), f.country_inferred, f.country_source
  FROM f
  ORDER BY CASE WHEN p_period IN ('1d','2d','7d','30d') THEN f.delta END DESC NULLS LAST,
    CASE WHEN p_sort='subscribers' THEN f.subscriber_count END DESC NULLS LAST,
    f.view_count DESC NULLS LAST, f.channel_id
  LIMIT least(greatest(p_limit,1),100) OFFSET least(greatest(p_offset,0),20000);
$$;

REVOKE ALL ON FUNCTION public.youtube_app_search_channels(text, text, bigint, bigint, bigint, bigint, text[], text[], text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.youtube_app_search_channels(text, text, bigint, bigint, bigint, bigint, text[], text[], text, integer, integer)
  TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.youtube_app_infer_country(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.youtube_app_infer_country(text[]) TO service_role;

-- Backfill: existing channels have no stored regions/description yet, so this uses the channel title;
-- the daily stats job adds defaultLanguage/description hints and discover adds regions over the next days.
SELECT public.youtube_app_infer_country(array_agg(channel_id)) FROM public.youtube_app_channels;

COMMIT;
