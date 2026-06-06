-- Performance indexes for hot query paths.
--
-- 1. Composite index on (user_id, clause_number) for standard_chunks —
--    every clause-lookup in the query edge function filters by both columns.
--
-- 2. Replace ivfflat vector index with HNSW.
--    HNSW gives better recall at the same ef_search and doesn't require
--    a training phase (no need to wait for a minimum row count like ivfflat).
--    m=16 / ef_construction=64 are safe defaults for up to ~1M vectors.
--    The ivfflat drop is guarded so this is idempotent on fresh DBs.

-- ── clause_number composite index ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_standard_chunks_clause_number
  ON public.standard_chunks (user_id, clause_number)
  WHERE clause_number IS NOT NULL;

-- ── HNSW vector index ──────────────────────────────────────────────────────
DO $$
BEGIN
  -- Only replace the old ivfflat index if it exists; don't touch HNSW if
  -- someone already created it under a different name.
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'standard_chunks'
      AND indexname  = 'idx_standard_chunks_embedding'
  ) THEN
    DROP INDEX IF EXISTS idx_standard_chunks_embedding;

    -- Recreate as HNSW (requires pgvector >= 0.5.0, always available on Supabase)
    CREATE INDEX idx_standard_chunks_embedding
      ON public.standard_chunks
      USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64);
  END IF;
END $$;
