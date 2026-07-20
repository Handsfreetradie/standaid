-- Auto-resume for indexing chains that die silently.
--
-- describe-figures and embed-chunks call each other via fire-and-forget
-- background HTTP requests (no queue, no worker). Confirmed in production
-- (Jeromee's AS/NZS 3000 + 3008 Part 1 uploads, 2026-07-20): the chain can
-- run a few hops then just stop, with no error logged — the standard is
-- already marked 'complete' at that point (by design, so users aren't
-- blocked on indexing), so the stale-job sweeper never sees it; it only
-- watches jobs still stuck in pending/processing.
--
-- This sweep finds 'complete' standards that still have un-embedded chunks
-- and re-invokes the right function. Each call is cheap and idempotent —
-- if there's nothing left to do it's a fast no-op — so re-kicking on a
-- timer is a simpler fix than trying to detect exactly when a chain died.
--
-- Requires vault secret 'service_role_key' (run once):
--   SELECT vault.create_secret('<service role secret key>', 'service_role_key');
-- Until it's set, the sweep skips silently (fails closed).

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

  -- Figures/tables still waiting on their Claude description.
  FOR r IN
    SELECT DISTINCT s.id AS standard_id, s.user_id
    FROM standards s
    JOIN standard_chunks c ON c.standard_id = s.id
    WHERE s.extraction_status = 'complete'
      AND c.embedding IS NULL
      AND (c.content ILIKE '%will be generated shortly%')
  LOOP
    PERFORM net.http_post(
      url     := 'https://wyxeqkgpwkcckyntqcns.supabase.co/functions/v1/describe-figures',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || key),
      body    := jsonb_build_object('standard_id', r.standard_id, 'user_id', r.user_id)
    );
  END LOOP;

  -- Ordinary text chunks that never got embedded.
  FOR r IN
    SELECT DISTINCT s.id AS standard_id
    FROM standards s
    JOIN standard_chunks c ON c.standard_id = s.id
    WHERE s.extraction_status = 'complete'
      AND c.embedding IS NULL
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

REVOKE ALL ON FUNCTION public.resume_stalled_indexing() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule(
  'resume-stalled-indexing',
  '*/10 * * * *',
  'SELECT public.resume_stalled_indexing()'
);
