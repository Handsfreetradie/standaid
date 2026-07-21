-- Extend chunk retrieval (vector + full-text search) to include a team's
-- shared standards, not just the caller's own uploads. Chat/question history
-- stays private per person — this only affects which STANDARDS are
-- searchable, mirroring the RLS extension already applied to the tables
-- themselves in 20260721030000_team_organizations.sql.

CREATE OR REPLACE FUNCTION public.match_chunks(
  query_embedding extensions.vector(1536),
  match_user_id UUID,
  match_threshold FLOAT DEFAULT 0.72,
  match_count INT DEFAULT 8
)
RETURNS TABLE (
  id UUID,
  standard_id UUID,
  clause_number TEXT,
  clause_title TEXT,
  content TEXT,
  page_number INTEGER,
  chunk_index INTEGER,
  similarity FLOAT
)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    sc.id,
    sc.standard_id,
    sc.clause_number,
    sc.clause_title,
    sc.content,
    sc.page_number,
    sc.chunk_index,
    (1 - (sc.embedding <=> match_chunks.query_embedding))::FLOAT AS similarity
  FROM public.standard_chunks sc
  WHERE (
      sc.user_id = match_chunks.match_user_id
      OR (sc.organization_id IS NOT NULL AND sc.organization_id IN (
        SELECT organization_id FROM public.organization_members
        WHERE user_id = match_chunks.match_user_id AND status = 'active'
      ))
    )
    AND sc.is_indexed = true
    AND (1 - (sc.embedding <=> match_chunks.query_embedding)) > match_chunks.match_threshold
  ORDER BY sc.embedding <=> match_chunks.query_embedding
  LIMIT match_chunks.match_count;
$$;

REVOKE ALL ON FUNCTION public.match_chunks(extensions.vector, UUID, FLOAT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_chunks(extensions.vector, UUID, FLOAT, INT) TO service_role;

CREATE OR REPLACE FUNCTION public.match_chunks_fts(
  match_user_id UUID,
  query_text TEXT,
  match_count INT DEFAULT 15
)
RETURNS TABLE (
  id UUID,
  standard_id UUID,
  clause_number TEXT,
  clause_title TEXT,
  content TEXT,
  page_number INT,
  chunk_index INT,
  rank REAL
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    sc.id,
    sc.standard_id,
    sc.clause_number,
    sc.clause_title,
    sc.content,
    sc.page_number,
    sc.chunk_index,
    ts_rank(sc.fts, websearch_to_tsquery('english', query_text)) AS rank
  FROM standard_chunks sc
  WHERE (
      sc.user_id = match_user_id
      OR (sc.organization_id IS NOT NULL AND sc.organization_id IN (
        SELECT organization_id FROM public.organization_members
        WHERE user_id = match_user_id AND status = 'active'
      ))
    )
    AND sc.is_indexed = true
    AND sc.fts @@ websearch_to_tsquery('english', query_text)
  ORDER BY rank DESC
  LIMIT LEAST(match_count, 50);
$$;

REVOKE ALL ON FUNCTION public.match_chunks_fts(UUID, TEXT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_chunks_fts(UUID, TEXT, INT) TO service_role;
