-- Surface permanently-failed chunks to the user instead of hiding them.
--
-- A figure/table chunk that hits the index_attempts cap (3) without ever
-- getting embedded is silently missing from search results forever — the
-- user has no way to know part of their standard didn't make it in. This
-- adds a counter, kept in sync at the same points extraction_status flips
-- to 'complete', so the library UI can show "N figures/tables couldn't be
-- processed" instead of quietly serving an incomplete document.

ALTER TABLE public.standards
  ADD COLUMN IF NOT EXISTS failed_chunks_count INT NOT NULL DEFAULT 0;

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

    SELECT count(*) INTO failed_count
      FROM standard_chunks
     WHERE standard_id = r.standard_id AND embedding IS NULL AND index_attempts >= 3;

    IF idx_count > 0 THEN
      UPDATE standards
         SET extraction_status = 'complete', indexed_chunks = idx_count, failed_chunks_count = failed_count
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
