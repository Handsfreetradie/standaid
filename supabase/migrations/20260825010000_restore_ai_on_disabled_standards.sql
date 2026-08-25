-- Reverses 20260820000001_disable_ai_on_existing_sa_standards.sql — the
-- app-level AS/NZS AI block has been removed (Kyle's call, 2026-08-25:
-- repositioning as a general document search tool for tradies; the user now
-- carries responsibility for upload rights and AI-output verification via
-- the upload consent checkbox + Terms of Service, not an app deny-list).
--
-- Only restores standards that already had chunks when they were disabled
-- (the original migration's WHERE extraction_status = 'complete' clause
-- means nothing else was ever moved to ai_disabled by it). Never deleted
-- anything, so this is a direct, symmetric undo.
--
-- Standards that were blocked at upload time (see the old isAiAllowed gate
-- in upload-standard/index.ts, removed the same day) never got processed at
-- all — those have zero chunks and need a real reprocess from the stored
-- PDF, not a flag flip. See scripts/restore-ai-disabled-standards.mjs for
-- that half, which costs real OCR/AI spend and is deliberately not
-- automatic.

UPDATE public.standard_chunks
SET is_indexed = true
WHERE is_indexed = false
  AND standard_id IN (
    SELECT id FROM public.standards
    WHERE extraction_status = 'ai_disabled'
      AND total_chunks > 0
  );

UPDATE public.standards
SET extraction_status = 'complete'
WHERE extraction_status = 'ai_disabled'
  AND total_chunks > 0;
