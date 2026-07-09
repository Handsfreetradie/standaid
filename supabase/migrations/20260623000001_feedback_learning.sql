-- Feedback learning: store question embeddings so similar past corrections
-- can be surfaced to the AI before it answers a new query.
--
-- The pgvector extension may live in `public` or `extensions` depending on
-- how the project was provisioned, and the migration search path may not
-- include it — so everything that touches the vector type/operators resolves
-- the extension schema from pg_extension and qualifies it explicitly.

DO $$
DECLARE
  ext_schema text;
BEGIN
  SELECT n.nspname INTO ext_schema
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'vector';

  IF ext_schema IS NULL THEN
    RAISE NOTICE 'pgvector extension not installed — skipping feedback learning schema';
    RETURN;
  END IF;

  EXECUTE format(
    'ALTER TABLE public.query_feedback
       ADD COLUMN IF NOT EXISTS question_text TEXT,
       ADD COLUMN IF NOT EXISTS question_embedding %I.vector(1536)',
    ext_schema);

  -- Partial index — only rows that have an embedding need the index
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS query_feedback_embedding_idx
       ON public.query_feedback
       USING ivfflat (question_embedding %I.vector_cosine_ops)
       WHERE question_embedding IS NOT NULL',
    ext_schema);

  -- RPC used by the query function to retrieve relevant past corrections.
  -- SET search_path pins the vector schema so <=> resolves at execution.
  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.match_feedback_corrections(
        query_embedding %1$I.vector(1536),
        match_threshold FLOAT DEFAULT 0.82,
        match_count INT DEFAULT 3
      )
      RETURNS TABLE (question_text TEXT, user_comment TEXT)
      LANGUAGE sql STABLE
      SET search_path = public, %1$I
      AS $fn$
        SELECT question_text, user_comment
        FROM public.query_feedback
        WHERE rating IN (''wrong'', ''unclear'')
          AND user_comment IS NOT NULL
          AND question_embedding IS NOT NULL
          AND 1 - (question_embedding <=> query_embedding) > match_threshold
        ORDER BY question_embedding <=> query_embedding
        LIMIT match_count;
      $fn$',
    ext_schema);
END $$;
