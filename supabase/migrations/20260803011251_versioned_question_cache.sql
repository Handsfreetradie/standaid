-- Tag cached answers with a hash of the prompt/synonym logic that produced
-- them. A cache hit is only served if that hash still matches what's live —
-- any deploy that changes the system prompt or tradie-synonym map (e.g. a
-- prompt fix) invalidates every previously cached answer instead of leaving
-- pre-fix answers in circulation for up to 30 days (the existing max_age_days
-- window). Old rows without a version simply never match again.

ALTER TABLE public.question_cache ADD COLUMN prompt_version TEXT;

-- Old 4-arg signature is a distinct overload in Postgres, not replaced by
-- CREATE OR REPLACE below (different parameter list) — drop it explicitly.
DROP FUNCTION IF EXISTS public.match_cached_question(extensions.vector, UUID, FLOAT, INT);

CREATE OR REPLACE FUNCTION public.match_cached_question(
  query_embedding extensions.vector(1536),
  match_organization_id UUID,
  match_prompt_version TEXT,
  match_threshold FLOAT DEFAULT 0.96,
  max_age_days INT DEFAULT 30
)
RETURNS TABLE (
  id UUID,
  response JSONB,
  similarity FLOAT
)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    qc.id,
    qc.response,
    (1 - (qc.question_embedding <=> match_cached_question.query_embedding))::FLOAT AS similarity
  FROM public.question_cache qc
  WHERE qc.organization_id = match_cached_question.match_organization_id
    AND qc.prompt_version = match_cached_question.match_prompt_version
    AND qc.created_at > now() - (match_cached_question.max_age_days || ' days')::interval
    AND (1 - (qc.question_embedding <=> match_cached_question.query_embedding)) > match_cached_question.match_threshold
  ORDER BY qc.question_embedding <=> match_cached_question.query_embedding
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.match_cached_question(extensions.vector, UUID, TEXT, FLOAT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_cached_question(extensions.vector, UUID, TEXT, FLOAT, INT) TO service_role;
