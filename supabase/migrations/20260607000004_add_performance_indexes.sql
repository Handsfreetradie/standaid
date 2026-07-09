-- Performance indexes for hot query paths.
--
-- 1. Composite index on (user_id, clause_number) for standard_chunks —
--    every clause-lookup in the query edge function filters by both columns.
--
-- 2. Optimize vector search with an HNSW index.
--    pgvector lives in the `extensions` schema on Supabase, and migrations
--    run without it on the search path, so the operator class must be
--    schema-qualified (extensions.vector_cosine_ops). HNSW (pgvector 0.5+,
--    remote is 0.8.0) needs no training data, unlike ivfflat which gives
--    poor recall when built on an empty or small table.

-- ── clause_number composite index ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_standard_chunks_clause_number
  ON public.standard_chunks (user_id, clause_number)
  WHERE clause_number IS NOT NULL;

-- ── HNSW vector index ─────────────────────────────────────────────────────
DROP INDEX IF EXISTS public.idx_standard_chunks_embedding;

CREATE INDEX idx_standard_chunks_embedding
  ON public.standard_chunks
  USING hnsw (embedding extensions.vector_cosine_ops);
