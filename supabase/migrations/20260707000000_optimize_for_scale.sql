-- Performance indices for production scale, written against the actual schema.
--
-- Notes on what is deliberately NOT here:
--   * Vector index on standard_chunks.embedding — created in
--     20260607000004_add_performance_indexes.sql (HNSW).
--   * audits / audit_photos / ai_usage indices — created alongside their
--     tables in 20260706000000 and 20260704000003.
--   * exam answer uniqueness — enforced on capstone_exam_answers in
--     20260704000002_exam_answer_unique.sql.

-- FK joins / filtering chunks by standard
CREATE INDEX IF NOT EXISTS idx_standard_chunks_standard_id
  ON public.standard_chunks (standard_id);

-- Audit photo status lookups (poll pending/analyzing photos per user)
CREATE INDEX IF NOT EXISTS idx_audit_photos_status
  ON public.audit_photos (user_id, status);

-- Query log lookups (daily rate-limit counts per user)
CREATE INDEX IF NOT EXISTS idx_query_log_user_time
  ON public.query_log (user_id, created_at DESC);

-- Standard search by code
CREATE INDEX IF NOT EXISTS idx_standards_code
  ON public.standards (standard_code);

-- Cleanup: remove old indices that might exist from previous versions
DROP INDEX IF EXISTS idx_chunks_standard_code;
DROP INDEX IF EXISTS idx_query_log_user;
