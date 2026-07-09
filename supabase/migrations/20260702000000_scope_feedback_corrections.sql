-- Security fix: match_feedback_corrections had no user filter, so one user's
-- flagged question text and comments could be injected into another user's
-- AI answer context. Corrections now surface only from the asking user's own
-- feedback, plus corrections an admin has explicitly approved for training.

-- pgvector lives in the `extensions` schema — needed to resolve the VECTOR
-- type in the function signature. Scoped to this migration's transaction.
SET LOCAL search_path = public, extensions;

DROP FUNCTION IF EXISTS match_feedback_corrections(VECTOR, FLOAT, INT);

CREATE OR REPLACE FUNCTION match_feedback_corrections(
  query_embedding VECTOR(1536),
  match_user_id UUID,
  match_threshold FLOAT DEFAULT 0.82,
  match_count INT DEFAULT 3
)
RETURNS TABLE (question_text TEXT, user_comment TEXT)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT question_text, user_comment
  FROM query_feedback
  WHERE rating IN ('wrong', 'unclear')
    AND user_comment IS NOT NULL
    AND question_embedding IS NOT NULL
    AND (user_id = match_user_id OR approved_for_training = TRUE)
    AND 1 - (question_embedding <=> query_embedding) > match_threshold
  ORDER BY question_embedding <=> query_embedding
  LIMIT match_count;
$$;
