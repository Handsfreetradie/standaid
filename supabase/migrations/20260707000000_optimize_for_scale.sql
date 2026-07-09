-- Performance indices for production scale, written against the real schema.
--
-- Notes on what is deliberately NOT here:
--   • Embedding (pgvector) index — created in 20260607000004 with the
--     extension schema resolved dynamically.
--   • audits / audit_photos (audit_id) indexes — created in 20260706000000.
--   • ai_usage (user_id, kind, created_at) — created in 20260704000003.
--   • queries (user_id, created_at) — already exists as idx_queries_user_created.
--   • capstone_exam_answers unique constraint — added in 20260704000002.

-- FK join: fetch all chunks for a standard (used by re-embedding + deletes)
CREATE INDEX IF NOT EXISTS idx_standard_chunks_standard_id
  ON public.standard_chunks (standard_id);

-- Audit photo status checks per user (pending/analysed filtering)
CREATE INDEX IF NOT EXISTS idx_audit_photos_status
  ON public.audit_photos (user_id, status);

-- Standard search by code (e.g. "AS/NZS 3000")
CREATE INDEX IF NOT EXISTS idx_standards_standard_code
  ON public.standards (standard_code);

-- Cleanup: remove old indices that might exist from previous versions
DROP INDEX IF EXISTS public.idx_chunks_standard_code;
DROP INDEX IF EXISTS public.idx_query_log_user;
