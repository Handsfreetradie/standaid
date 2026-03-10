
-- Move vector extension to extensions schema (security best practice)
ALTER EXTENSION vector SET SCHEMA extensions;

-- Update the embedding column type reference
-- The column still works, but we need to update the match_chunks function
DROP FUNCTION IF EXISTS public.match_chunks;

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
  WHERE sc.user_id = match_chunks.match_user_id
    AND sc.is_indexed = true
    AND (1 - (sc.embedding <=> match_chunks.query_embedding)) > match_chunks.match_threshold
  ORDER BY sc.embedding <=> match_chunks.query_embedding
  LIMIT match_chunks.match_count;
$$;
