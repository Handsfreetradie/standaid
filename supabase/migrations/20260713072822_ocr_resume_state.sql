-- Resumable AI OCR for scanned/protected PDFs. A 60-page scanned standard
-- needs ~10 OCR batches (~30-60s each) — far more than one 150s function
-- window. process-standard now persists accumulated OCR text and the next
-- page between self-retriggered runs, instead of stopping at the deadline
-- and passing off whatever it had as the whole document (the fake-97%
-- AS 3017 partial-extraction incident).

ALTER TABLE public.processing_jobs
  ADD COLUMN IF NOT EXISTS ocr_text TEXT,
  ADD COLUMN IF NOT EXISTS ocr_next_page INTEGER;
