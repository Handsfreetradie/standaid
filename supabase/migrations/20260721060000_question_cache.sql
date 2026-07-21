-- Shared team question cache — a close-enough repeat question within an
-- organisation reuses a previous answer instead of re-running the full
-- Claude pipeline. Deliberately conservative (high similarity threshold,
-- bounded age) since answers here are safety-critical compliance content —
-- see query/index.ts for how this is consumed. Chat/question history stays
-- private per person; this is an internal lookup, not a shared history —
-- every hit still writes a normal queries/citations row under the asking
-- user's own user_id.

CREATE TABLE public.question_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Primary/top-cited standard only — cascades away if that standard is
  -- deleted or replaced, bounding staleness for the common single-standard
  -- case without building full multi-citation invalidation.
  standard_id UUID REFERENCES standards(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  question_embedding extensions.vector(1536) NOT NULL,
  -- Full answer shape: answer text, citations, figures_referenced,
  -- tables_referenced, confidence, follow_up_questions — the same fields
  -- already carried on the SSE "done" event in query/index.ts.
  response JSONB NOT NULL,
  hit_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_question_cache_org ON public.question_cache (organization_id);

ALTER TABLE public.question_cache ENABLE ROW LEVEL SECURITY;

-- Readable by active org members; no client INSERT/UPDATE/DELETE policy —
-- writes only happen via the service-role query edge function.
CREATE POLICY "Question cache visible to active org members" ON public.question_cache FOR SELECT USING (
  public.is_active_org_member(organization_id, auth.uid())
);

-- Modeled directly on match_chunks (20260310055500_...). Locked to
-- service_role like every other retrieval RPC in this project.
CREATE OR REPLACE FUNCTION public.match_cached_question(
  query_embedding extensions.vector(1536),
  match_organization_id UUID,
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
    AND qc.created_at > now() - (match_cached_question.max_age_days || ' days')::interval
    AND (1 - (qc.question_embedding <=> match_cached_question.query_embedding)) > match_cached_question.match_threshold
  ORDER BY qc.question_embedding <=> match_cached_question.query_embedding
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.match_cached_question(extensions.vector, UUID, FLOAT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_cached_question(extensions.vector, UUID, FLOAT, INT) TO service_role;

-- Bumped by the query function on a cache hit.
CREATE OR REPLACE FUNCTION public.bump_question_cache_hit(p_id UUID)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.question_cache
  SET hit_count = hit_count + 1, last_used_at = now()
  WHERE id = p_id;
$$;

REVOKE ALL ON FUNCTION public.bump_question_cache_hit(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bump_question_cache_hit(UUID) TO service_role;
