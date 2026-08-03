-- Tags each standard with the pipeline (chunking/extraction/tagging) version
-- that built its current chunks, so ingestion improvements can be rolled out
-- to already-uploaded standards without asking users to re-upload the PDF.
--
-- Existing rows default to 0 — "processed before versioning existed", which
-- is always considered stale once PIPELINE_VERSION (process-standard/
-- extraction.ts) moves past 0. This is a label only: it does not read or
-- change extraction_status/indexed_chunks/is_indexed, so a working, fully
-- indexed standard is completely unaffected until reprocess-standard is
-- explicitly invoked for it (supabase/functions/reprocess-standard).

ALTER TABLE public.standards
  ADD COLUMN IF NOT EXISTS pipeline_version INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.standards.pipeline_version IS
  'Chunking/extraction/tagging pipeline version that built this standard''s current chunks. Compare against PIPELINE_VERSION in process-standard/extraction.ts to find standards that would benefit from reprocess-standard.';

-- Supports "list stale standards" admin queries (pipeline_version < current)
-- without a sequential scan as the table grows.
CREATE INDEX IF NOT EXISTS standards_pipeline_version_idx
  ON public.standards (pipeline_version);
