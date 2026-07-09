-- Feedback learning: store question embeddings so similar past corrections
-- can be surfaced to the AI before it answers a new query.

-- pgvector lives in the `extensions` schema on Supabase, and migrations run
-- without it on the search path — the VECTOR type and <=> operator would not
-- resolve. Scoped to this migration's transaction only.
SET LOCAL search_path = public, extensions;

ALTER TABLE query_feedback
  ADD COLUMN IF NOT EXISTS question_text TEXT,
  ADD COLUMN IF NOT EXISTS question_embedding VECTOR(1536);

-- Partial index — only rows that have an embedding need the index.
-- pgvector lives in the `extensions` schema on Supabase, so the operator
-- class must be schema-qualified.
CREATE INDEX IF NOT EXISTS query_feedback_embedding_idx
  ON query_feedback USING hnsw (question_embedding extensions.vector_cosine_ops)
  WHERE question_embedding IS NOT NULL;

-- RPC used by the query function to retrieve relevant past corrections
CREATE OR REPLACE FUNCTION match_feedback_corrections(
  query_embedding VECTOR(1536),
  match_threshold FLOAT DEFAULT 0.82,
  match_count INT DEFAULT 3
)
RETURNS TABLE (question_text TEXT, user_comment TEXT)
LANGUAGE sql STABLE
AS $$
  SELECT question_text, user_comment
  FROM query_feedback
  WHERE rating IN ('wrong', 'unclear')
    AND user_comment IS NOT NULL
    AND question_embedding IS NOT NULL
    AND 1 - (question_embedding <=> query_embedding) > match_threshold
  ORDER BY question_embedding <=> query_embedding
  LIMIT match_count;
$$;
