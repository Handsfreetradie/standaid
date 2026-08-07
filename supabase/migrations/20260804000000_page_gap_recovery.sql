-- Auto-resume for pages the OCR pass silently drops entirely (a page
-- produces zero/near-zero text — confirmed in production 2026-08-03,
-- AS/NZS 3000's Table 8.1/8.2 went missing this way). chunkAndPersist
-- (process-standard/pipeline.ts) flags candidate pages as lightweight
-- "PAGE-GAP {N}" placeholder chunks; this sweep finds standards with open
-- placeholders and hands them to recover-page-gap, which re-photographs
-- just that page, re-runs it through the normal clause/table/figure
-- classifier, and replaces the placeholder with whatever it finds.
--
-- Sibling to resume_stalled_indexing/poll_vision_batches (same Vault-key +
-- net.http_post pattern), not a third loop bolted onto either of those —
-- different query shape, different target function, same precedent already
-- established by poll_vision_batches being its own migration rather than a
-- third loop in resume_stalled_indexing.
--
-- Requires vault secret 'service_role_key' (already set — resume_stalled_indexing
-- depends on the same secret). Until it's set, the sweep skips silently (fails closed).

CREATE OR REPLACE FUNCTION public.recover_page_gaps()
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
    RAISE WARNING '[recover-page-gaps] vault secret "service_role_key" not set — skipping';
    RETURN;
  END IF;

  -- One dispatch per standard (recover-page-gap processes every open
  -- PAGE-GAP row for that standard in a single invocation, matching how
  -- describe-figures already batches per-standard rather than per-row).
  FOR r IN
    SELECT DISTINCT s.id AS standard_id, s.user_id
    FROM standards s
    JOIN standard_chunks c ON c.standard_id = s.id
    WHERE s.extraction_status = 'complete'
      AND c.clause_number LIKE 'PAGE-GAP %'
      AND c.index_attempts < 3
  LOOP
    PERFORM net.http_post(
      url     := 'https://wyxeqkgpwkcckyntqcns.supabase.co/functions/v1/recover-page-gap',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || key),
      body    := jsonb_build_object('standard_id', r.standard_id, 'user_id', r.user_id)
    );
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[recover-page-gaps] failed: %', SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.recover_page_gaps() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule(
  'recover-page-gaps',
  '*/10 * * * *',
  'SELECT public.recover_page_gaps()'
);
