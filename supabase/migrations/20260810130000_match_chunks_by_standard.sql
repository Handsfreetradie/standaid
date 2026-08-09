-- Semantic search scoped to one standard (rather than one user/org, like
-- match_chunks). Used by capstone's scenario_walkthrough action: the
-- apprentice picks a standard in the Learn UI, and the AI's own decision
-- points (which the apprentice's wording often doesn't name — e.g. "RCD")
-- need real semantic search across that whole standard, not a keyword
-- match against the apprentice's literal scenario text.
CREATE FUNCTION public.match_chunks_by_standard(
  query_embedding extensions.vector(1536),
  match_standard_id UUID,
  match_threshold FLOAT DEFAULT 0.30,
  match_count INT DEFAULT 40
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
    (1 - (sc.embedding <=> match_chunks_by_standard.query_embedding))::FLOAT AS similarity
  FROM public.standard_chunks sc
  WHERE sc.standard_id = match_chunks_by_standard.match_standard_id
    AND sc.is_indexed = true
    AND (1 - (sc.embedding <=> match_chunks_by_standard.query_embedding)) > match_chunks_by_standard.match_threshold
  ORDER BY sc.embedding <=> match_chunks_by_standard.query_embedding
  LIMIT match_chunks_by_standard.match_count;
$$;

REVOKE ALL ON FUNCTION public.match_chunks_by_standard(extensions.vector, UUID, FLOAT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_chunks_by_standard(extensions.vector, UUID, FLOAT, INT) TO service_role;
