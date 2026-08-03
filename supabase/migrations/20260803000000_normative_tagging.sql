-- Normative vs informative tagging for standard chunks. chunk_type classifies
-- what a chunk is (clause/table/figure/note/definition/appendix/map);
-- is_normative records whether its text is mandatory ("shall") or guidance
-- ("should", NOTEs, informative appendices). Both nullable — chunks written
-- before this migration stay NULL (untagged) until their standard is
-- re-processed, and the query function omits the annotation for NULL.

ALTER TABLE public.standard_chunks
  ADD COLUMN IF NOT EXISTS chunk_type TEXT,
  ADD COLUMN IF NOT EXISTS is_normative BOOLEAN;

-- ADD CONSTRAINT has no IF NOT EXISTS — guard via pg_constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'standard_chunks_chunk_type_check'
      AND conrelid = 'public.standard_chunks'::regclass
  ) THEN
    ALTER TABLE public.standard_chunks
      ADD CONSTRAINT standard_chunks_chunk_type_check
      CHECK (chunk_type IS NULL OR chunk_type IN ('clause', 'table', 'figure', 'note', 'definition', 'appendix', 'map'));
  END IF;
END $$;

-- Retrieval RPCs must surface the tags so the query function can annotate
-- each extract. Adding return columns changes the functions' return type,
-- which CREATE OR REPLACE cannot do — DROP first, then recreate with the
-- exact bodies from 20260721040000 (the latest, org-shared definitions)
-- plus the two new columns, then re-apply the same service_role-only grants.

DROP FUNCTION IF EXISTS public.match_chunks(extensions.vector, UUID, FLOAT, INT);

CREATE FUNCTION public.match_chunks(
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
  chunk_type TEXT,
  is_normative BOOLEAN,
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
    sc.chunk_type,
    sc.is_normative,
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

DROP FUNCTION IF EXISTS public.match_chunks_fts(UUID, TEXT, INT);

CREATE FUNCTION public.match_chunks_fts(
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
  chunk_type TEXT,
  is_normative BOOLEAN,
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
    sc.chunk_type,
    sc.is_normative,
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
