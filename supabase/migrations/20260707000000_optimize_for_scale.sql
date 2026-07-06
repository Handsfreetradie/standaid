-- Performance indices for production scale. These speed up the most common queries.

-- pgvector search on embeddings (100x faster than full table scan)
CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Standard lookups by ID (FK joins, search filtering)
CREATE INDEX IF NOT EXISTS idx_chunks_standard_id ON chunks (standard_id);

-- Audit queries by user (fetch audit list)
CREATE INDEX IF NOT EXISTS idx_audits_user_id ON audits (user_id, created_at DESC);

-- Audit photo queries (fetch photos for an audit)
CREATE INDEX IF NOT EXISTS idx_audit_photos_audit_id ON audit_photos (audit_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_audit_photos_status ON audit_photos (user_id, status);

-- Query log lookups (fetch daily count for rate limiting)
CREATE INDEX IF NOT EXISTS idx_query_log_user_kind ON query_log (user_id, kind, created_at DESC);

-- AI usage rate limiting (check daily usage)
CREATE INDEX IF NOT EXISTS idx_ai_usage_user_kind ON ai_usage (user_id, kind, created_at DESC);

-- Chat history search
CREATE INDEX IF NOT EXISTS idx_chat_history_user ON chat_history (user_id, created_at DESC);

-- Standard search by code
CREATE INDEX IF NOT EXISTS idx_standards_code ON standards (code);

-- Ensure tables have proper unique constraints (prevents duplicates on retry)
ALTER TABLE exam_answers
  ADD CONSTRAINT unique_exam_question UNIQUE (exam_id, question_id)
    ON CONFLICT DO NOTHING;

-- Cleanup: remove old indices that might exist from previous versions
DROP INDEX IF EXISTS idx_chunks_standard_code;
DROP INDEX IF EXISTS idx_query_log_user;

COMMENT ON INDEX idx_chunks_embedding IS 'Accelerates pgvector similarity search for standard clause lookup';
COMMENT ON INDEX idx_chunks_standard_id IS 'FK join optimization for filtering chunks by standard';
COMMENT ON INDEX idx_audits_user_id IS 'Fetch user audits ordered by date';
COMMENT ON INDEX idx_audit_photos_audit_id IS 'Fetch photos for a specific audit';
COMMENT ON INDEX idx_query_log_user_kind IS 'Daily query rate limiting per user';
COMMENT ON INDEX idx_ai_usage_user_kind IS 'AI call rate limiting per user per kind';
