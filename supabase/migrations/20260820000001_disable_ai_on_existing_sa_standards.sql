-- Soft-disable AI processing on already-processed standards that aren't
-- clearly an allow-listed non-SA publisher (NCC/BCA). Mirrors the deny-by-
-- default polarity in supabase/functions/_shared/standard-licence.ts
-- (ALLOWED_PUBLISHER_PATTERN) — keep these two in sync if that ever changes.
--
-- Nothing is deleted: chunks/figures/tables/embeddings all stay in place,
-- just excluded from retrieval via is_indexed = false. Fully reversible.

UPDATE public.standards
SET extraction_status = 'ai_disabled'
WHERE extraction_status = 'complete'
  AND NOT (
    coalesce(standard_code, '') || ' ' || coalesce(title, '')
  ) ~* '\bNCC\b|national construction code|\bBCA\b|building code of australia';

UPDATE public.standard_chunks
SET is_indexed = false
WHERE is_indexed = true
  AND standard_id IN (
    SELECT id FROM public.standards WHERE extraction_status = 'ai_disabled'
  );
