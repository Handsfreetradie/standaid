-- Performance indexes for hot query paths.
--
-- 1. Composite index on (user_id, clause_number) for standard_chunks —
--    every clause-lookup in the query edge function filters by both columns.
--
-- 2. ivfflat vector index on embeddings.
--    The pgvector extension may live in either the `public` or `extensions`
--    schema depending on how the project was provisioned, and the operator
--    class (vector_cosine_ops) lives with it. Migrations run with a search
--    path that may not include that schema, so we look it up from pg_extension
--    and schema-qualify the operator class explicitly.

-- ── clause_number composite index ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_standard_chunks_clause_number
  ON public.standard_chunks (user_id, clause_number)
  WHERE clause_number IS NOT NULL;

-- ── ivfflat vector index ──────────────────────────────────────────────────
DO $$
DECLARE
  ext_schema text;
BEGIN
  SELECT n.nspname INTO ext_schema
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'vector';

  IF ext_schema IS NULL THEN
    RAISE NOTICE 'pgvector extension not installed — skipping embedding index';
    RETURN;
  END IF;

  DROP INDEX IF EXISTS public.idx_standard_chunks_embedding;

  EXECUTE format(
    'CREATE INDEX idx_standard_chunks_embedding
       ON public.standard_chunks
       USING ivfflat (embedding %I.vector_cosine_ops)
       WITH (lists = 100)',
    ext_schema
  );
END $$;
