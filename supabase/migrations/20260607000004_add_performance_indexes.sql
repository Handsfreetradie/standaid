-- Performance indexes for hot query paths.
--
-- 1. Composite index on (user_id, clause_number) for standard_chunks —
--    every clause-lookup in the query edge function filters by both columns.
--
-- 2. Optimize vector search with ivfflat index.
--    ivfflat is the most stable pgvector index type across Supabase instances.
--    lists=100 is suitable for ~10k vectors. The ivfflat drop is guarded
--    so this is idempotent on fresh DBs.

-- ── clause_number composite index ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_standard_chunks_clause_number
  ON public.standard_chunks (user_id, clause_number)
  WHERE clause_number IS NOT NULL;

-- ── ivfflat vector index ──────────────────────────────────────────────────
DO $$
BEGIN
  -- Only replace the old ivfflat index if it exists.
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'standard_chunks'
      AND indexname  = 'idx_standard_chunks_embedding'
  ) THEN
    DROP INDEX IF EXISTS idx_standard_chunks_embedding;
  END IF;

  -- Create ivfflat index (compatible with all Supabase pgvector versions)
  CREATE INDEX idx_standard_chunks_embedding
    ON public.standard_chunks
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);
END $$;
