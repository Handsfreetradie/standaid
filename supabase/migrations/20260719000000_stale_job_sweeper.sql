-- Stale-job sweeper: the safety net for every "stuck forever" state.
--
-- The pipeline has no queue worker — processing is driven entirely by
-- fire-and-forget HTTP calls between edge functions, and the only recovery
-- mechanism was the uploader's browser poll loop. If a trigger request was
-- lost, or a function isolate was OOM-killed before its own cleanup timer
-- fired, the job sat in 'pending'/'processing' forever and the user saw an
-- eternal spinner in their library.
--
-- Long-running functions now write processing_jobs.heartbeat_at each work
-- window (process-standard on every state persist, embed-chunks at the start
-- of every invocation). Anything silent for 15 minutes is genuinely dead:
-- the longest legitimate gap between heartbeats is one ~2.5 minute window.

ALTER TABLE public.processing_jobs
  ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ DEFAULT now();

CREATE OR REPLACE FUNCTION public.sweep_stale_processing_jobs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  idx_count INT;
BEGIN
  FOR r IN
    WITH stale AS (
      UPDATE processing_jobs
         SET status = 'failed',
             error_message = 'Processing stalled and was stopped automatically. Please try uploading again.',
             completed_at = now()
       WHERE status IN ('pending', 'processing')
         AND COALESCE(heartbeat_at, started_at, created_at) < now() - INTERVAL '15 minutes'
      RETURNING standard_id
    )
    SELECT standard_id FROM stale
  LOOP
    -- If embedding got partway before dying, the document is usable — ship it
    -- as complete with partial indexing rather than throwing the work away.
    SELECT count(*) INTO idx_count
      FROM standard_chunks
     WHERE standard_id = r.standard_id AND is_indexed;

    IF idx_count > 0 THEN
      UPDATE standards
         SET extraction_status = 'complete', indexed_chunks = idx_count
       WHERE id = r.standard_id
         AND extraction_status IN ('pending', 'processing');
      UPDATE processing_jobs
         SET status = 'complete',
             error_message = 'Indexing was interrupted — the document is usable with partial indexing.'
       WHERE standard_id = r.standard_id;
    ELSE
      UPDATE standards
         SET extraction_status = 'failed'
       WHERE id = r.standard_id
         AND extraction_status IN ('pending', 'processing');
    END IF;
  END LOOP;
END;
$$;

-- Cron-only function — not callable from the API roles.
REVOKE ALL ON FUNCTION public.sweep_stale_processing_jobs() FROM PUBLIC, anon, authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Re-scheduling under the same name updates the existing job (pg_cron >= 1.4),
-- so this migration is safe to re-run.
SELECT cron.schedule(
  'sweep-stale-processing-jobs',
  '*/5 * * * *',
  'SELECT public.sweep_stale_processing_jobs()'
);
