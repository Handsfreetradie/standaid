-- Name the specific figures/tables that permanently failed, not just a count.
--
-- failed_chunks_count (20260721010000) tells the user "N figures/tables
-- couldn't be processed" with no way to know which — disconnected from the
-- moment it actually matters (a chat question that depends on exactly one of
-- them). This adds the actual clause labels alongside the count, computed at
-- the same two points failed_chunks_count already is: sweep_stale_processing_jobs()
-- (below) and embed-chunks/index.ts (see that file's own edit).

ALTER TABLE public.standards
  ADD COLUMN IF NOT EXISTS failed_chunks_labels text[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION public.sweep_stale_processing_jobs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  idx_count INT;
  failed_count INT;
  failed_labels text[];
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

    SELECT count(*), coalesce(array_agg(clause_number ORDER BY clause_number), '{}')
      INTO failed_count, failed_labels
      FROM standard_chunks
     WHERE standard_id = r.standard_id AND embedding IS NULL AND index_attempts >= 3;

    IF idx_count > 0 THEN
      UPDATE standards
         SET extraction_status = 'complete', indexed_chunks = idx_count,
             failed_chunks_count = failed_count, failed_chunks_labels = failed_labels
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

-- One-time backfill: standards that already show a nonzero count today
-- (computed before this column existed) get their real labels immediately,
-- rather than waiting for a processing cycle that may never run again for an
-- otherwise-complete standard.
UPDATE public.standards s
   SET failed_chunks_labels = sub.labels
  FROM (
    SELECT standard_id, array_agg(clause_number ORDER BY clause_number) AS labels
      FROM standard_chunks
     WHERE embedding IS NULL AND index_attempts >= 3
     GROUP BY standard_id
  ) sub
 WHERE s.id = sub.standard_id
   AND s.failed_chunks_count > 0;
