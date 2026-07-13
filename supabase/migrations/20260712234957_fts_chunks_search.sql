-- Full-text search for standard_chunks. The query function's keyword channel
-- was `ilike '%<word>%'` over the first five words of the question (including
-- stopwords like "what"), returning 15 arbitrary rows with no ranking. This
-- adds a proper tsvector + GIN index and a ranked search RPC.

ALTER TABLE public.standard_chunks
  ADD COLUMN IF NOT EXISTS fts tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(clause_title, '') || ' ' || coalesce(content, ''))
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_standard_chunks_fts
  ON public.standard_chunks USING GIN (fts);

-- Ranked full-text search, locked to service_role like match_chunks
-- (migration 20260706000001): edge functions call it with the service client
-- after verifying the user's JWT; clients cannot call it directly.
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
  WHERE sc.user_id = match_user_id
    AND sc.is_indexed = true
    AND sc.fts @@ websearch_to_tsquery('english', query_text)
  ORDER BY rank DESC
  LIMIT LEAST(match_count, 50);
$$;

REVOKE ALL ON FUNCTION public.match_chunks_fts(UUID, TEXT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_chunks_fts(UUID, TEXT, INT) TO service_role;
