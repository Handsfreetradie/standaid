-- reprocess-standard needs the same multi-window OCR resume as process-standard
-- (ocr_text/ocr_next_page, added in 20260713072822_ocr_resume_state.sql), plus
-- one more thing process-standard never needed: reprocess-standard re-runs
-- against an ALREADY-complete standard and must revert extraction_status back
-- to whatever it was before the reprocess attempt if something fails — but by
-- the second OCR window the standards row already reads 'processing' (set by
-- window 1), so the pre-reprocess status has to be persisted somewhere that
-- survives across the self-retriggered windows. It lives on the job row.

ALTER TABLE public.processing_jobs
  ADD COLUMN IF NOT EXISTS revert_extraction_status TEXT;
