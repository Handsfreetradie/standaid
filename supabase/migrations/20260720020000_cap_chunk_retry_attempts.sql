-- Cap retries on a single chunk that permanently fails to describe/embed.
--
-- Neither describe-figures nor embed-chunks marks an individual failed chunk
-- in any way — on error they just log and move on, leaving is_indexed/
-- embedding null. That chunk is fetched again on every future invocation
-- (self-retrigger, a fresh upload, or the resume-stalled-indexing sweep
-- added just before this migration) with no limit. One chunk whose content
-- or page image the API can never process would otherwise be retried
-- forever, spending vision/embedding tokens on it every single time.

ALTER TABLE public.standard_chunks
  ADD COLUMN IF NOT EXISTS index_attempts INT NOT NULL DEFAULT 0;

-- Give up on a chunk after 3 failed attempts; resume-stalled-indexing must
-- stop treating a standard as "needs resuming" once its only gaps are
-- give-up chunks, or it would re-invoke the same functions every 10 minutes
-- forever for no gain.
CREATE OR REPLACE FUNCTION public.resume_stalled_indexing()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  key text;
BEGIN
  SELECT decrypted_secret INTO key FROM vault.decrypted_secrets WHERE name = 'service_role_key';
  IF key IS NULL OR key = '' THEN
    RAISE WARNING '[resume-stalled-indexing] vault secret "service_role_key" not set — skipping';
    RETURN;
  END IF;

  FOR r IN
    SELECT DISTINCT s.id AS standard_id, s.user_id
    FROM standards s
    JOIN standard_chunks c ON c.standard_id = s.id
    WHERE s.extraction_status = 'complete'
      AND c.embedding IS NULL
      AND c.index_attempts < 3
      AND (c.content ILIKE '%will be generated shortly%')
  LOOP
    PERFORM net.http_post(
      url     := 'https://wyxeqkgpwkcckyntqcns.supabase.co/functions/v1/describe-figures',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || key),
      body    := jsonb_build_object('standard_id', r.standard_id, 'user_id', r.user_id)
    );
  END LOOP;

  FOR r IN
    SELECT DISTINCT s.id AS standard_id
    FROM standards s
    JOIN standard_chunks c ON c.standard_id = s.id
    WHERE s.extraction_status = 'complete'
      AND c.embedding IS NULL
      AND c.index_attempts < 3
      AND c.content NOT ILIKE '%will be generated shortly%'
      AND c.content NOT ILIKE '%transcription of this table will be generated shortly%'
  LOOP
    PERFORM net.http_post(
      url     := 'https://wyxeqkgpwkcckyntqcns.supabase.co/functions/v1/embed-chunks',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || key),
      body    := jsonb_build_object('standard_id', r.standard_id)
    );
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[resume-stalled-indexing] failed: %', SQLERRM;
END;
$$;
