-- Shared NCC index. The National Construction Code is published by the ABCB
-- under CC BY 4.0 (text only — images/photographs are excluded from the
-- licence), so unlike per-purchaser AS/NZS uploads it can be indexed once and
-- served to every account. Kept in its own table (different shape and
-- lifecycle: replaced wholesale per edition, carries state variations and
-- building-class facets, never has a PDF page) rather than mixed into the
-- per-user standard_chunks table.
--
-- NCC publications still get a row each in public.standards so the query
-- function's downstream plumbing (standardMap, trade detection, citation FK,
-- context labels, question cache) works unchanged. Those rows have no owner:
-- user_id becomes nullable and `source` tells the two kinds apart. Existing
-- RLS on standards is untouched — it only ever matches auth.uid() = user_id
-- or an org, so shared rows are invisible to the client (they don't show up in
-- the Library, can't be deleted or reprocessed) and only the service-role
-- query function reads them.

-- ── standards: allow ownerless shared rows ─────────────────────────────────

ALTER TABLE public.standards ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.standards
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'upload'
    CHECK (source IN ('upload', 'ncc')),
  ADD COLUMN IF NOT EXISTS licence TEXT,
  ADD COLUMN IF NOT EXISTS attribution TEXT;

-- An uploaded standard must always have an owner; only shared sources may not.
ALTER TABLE public.standards
  ADD CONSTRAINT standards_upload_requires_owner
  CHECK (source <> 'upload' OR user_id IS NOT NULL);

-- Fixed ids so the ingest script and the query function can name them
-- without a lookup. standard_code is what citations and the copyright line
-- display, and what trade-detection.ts keys on (Volume Three → plumbing).
INSERT INTO public.standards (id, user_id, title, standard_code, version, source, licence, attribution, extraction_status, trade_category)
VALUES
  ('a0000000-0000-4000-8000-00000000cc01'::uuid, NULL, 'NCC 2025 Volume One — Building Code of Australia, Class 2 to 9 buildings', 'NCC 2025 Volume One', '2025', 'ncc', 'CC BY 4.0', 'The National Construction Code 2025 was provided by the Australian Building Codes Board under the CC BY 4.0 licence.', 'complete', 'general'),
  ('a0000000-0000-4000-8000-00000000cc02'::uuid, NULL, 'NCC 2025 Volume Two — Building Code of Australia, Class 1 and 10 buildings', 'NCC 2025 Volume Two', '2025', 'ncc', 'CC BY 4.0', 'The National Construction Code 2025 was provided by the Australian Building Codes Board under the CC BY 4.0 licence.', 'complete', 'general'),
  ('a0000000-0000-4000-8000-00000000cc03'::uuid, NULL, 'NCC 2025 Volume Three — Plumbing Code of Australia', 'NCC 2025 Volume Three', '2025', 'ncc', 'CC BY 4.0', 'The National Construction Code 2025 was provided by the Australian Building Codes Board under the CC BY 4.0 licence.', 'complete', 'plumbing'),
  ('a0000000-0000-4000-8000-00000000cc04'::uuid, NULL, 'NCC 2025 ABCB Housing Provisions Standard', 'NCC 2025 Housing Provisions', '2025', 'ncc', 'CC BY 4.0', 'The National Construction Code 2025 was provided by the Australian Building Codes Board under the CC BY 4.0 licence.', 'complete', 'general'),
  ('a0000000-0000-4000-8000-00000000cc05'::uuid, NULL, 'NCC 2025 ABCB Livable Housing Design Standard', 'NCC 2025 Livable Housing', '2025', 'ncc', 'CC BY 4.0', 'The National Construction Code 2025 was provided by the Australian Building Codes Board under the CC BY 4.0 licence.', 'complete', 'general'),
  ('a0000000-0000-4000-8000-00000000cc06'::uuid, NULL, 'NCC 2025 Schedule 1 — Definitions', 'NCC 2025 Definitions', '2025', 'ncc', 'CC BY 4.0', 'The National Construction Code 2025 was provided by the Australian Building Codes Board under the CC BY 4.0 licence.', 'complete', 'general')
ON CONFLICT (id) DO NOTHING;

-- ── ncc_chunks ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ncc_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  standard_id UUID NOT NULL REFERENCES public.standards(id) ON DELETE CASCADE,
  edition TEXT NOT NULL,                       -- 'ncc_2025' (bump per amendment)
  publication TEXT NOT NULL,                   -- vol1 | vol2 | vol3 | housing | livable | glossary
  xml_id TEXT NOT NULL,                        -- clause root id from the ABCB XML; also the web anchor
  clause_number TEXT,                          -- 'E2D3', '10.2.9', 'S31C21'
  clause_title TEXT,
  part_number TEXT,                            -- 'E2', '10.2'
  part_title TEXT,
  content TEXT NOT NULL,
  chunk_index INTEGER NOT NULL DEFAULT 0,      -- 0 = whole clause or first split
  chunk_type TEXT NOT NULL DEFAULT 'text'
    CHECK (chunk_type IN ('text', 'table', 'glossary')),
  state TEXT,                                  -- NULL = national; 'WA', 'NSW', ... = that state's variation
  building_classes TEXT[] NOT NULL DEFAULT '{}',
  figure_refs JSONB NOT NULL DEFAULT '[]',     -- [{number, title, url}] — image itself is never stored
  source_url TEXT,                             -- clause page on ncc.abcb.gov.au
  content_hash TEXT NOT NULL,
  is_live BOOLEAN NOT NULL DEFAULT true,       -- false = held back (tables pending legal review)
  needs_legal_review BOOLEAN NOT NULL DEFAULT false,
  embedding extensions.vector(1536),
  fts tsvector GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(clause_number, '') || ' ' || coalesce(clause_title, '') || ' ' || coalesce(content, ''))
  ) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (edition, xml_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_ncc_chunks_embedding
  ON public.ncc_chunks USING hnsw (embedding extensions.vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_ncc_chunks_fts ON public.ncc_chunks USING GIN (fts);
CREATE INDEX IF NOT EXISTS idx_ncc_chunks_clause ON public.ncc_chunks (clause_number);
CREATE INDEX IF NOT EXISTS idx_ncc_chunks_standard ON public.ncc_chunks (standard_id);

-- Re-ingesting an amended clause upserts new text; drop the stale vector so
-- the embed-ncc function picks the row up again.
CREATE OR REPLACE FUNCTION public.ncc_chunks_invalidate_embedding()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.content_hash IS DISTINCT FROM OLD.content_hash THEN
    NEW.embedding := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS ncc_chunks_invalidate_embedding ON public.ncc_chunks;
CREATE TRIGGER ncc_chunks_invalidate_embedding
  BEFORE UPDATE OF content_hash ON public.ncc_chunks
  FOR EACH ROW EXECUTE FUNCTION public.ncc_chunks_invalidate_embedding();

ALTER TABLE public.ncc_chunks ENABLE ROW LEVEL SECURITY;

-- Any signed-in user may read live NCC content (Phase 3 clause browsing
-- reads this directly). No insert/update/delete policies: writes happen only
-- through the service role (ingest script), which bypasses RLS.
CREATE POLICY "Authenticated users can read live NCC chunks"
  ON public.ncc_chunks FOR SELECT
  TO authenticated
  USING (is_live = true);

-- ── search RPCs ────────────────────────────────────────────────────────────
-- Same column shape as match_chunks / match_chunks_fts (plus NCC extras) so
-- results can be fused into the same ranking pool in the query function.
-- p_states narrows state variations to the caller's state(s); national clauses
-- (state IS NULL) always match. Locked to service_role like the others.

CREATE OR REPLACE FUNCTION public.match_ncc_chunks(
  query_embedding extensions.vector(1536),
  match_threshold FLOAT DEFAULT 0.30,
  match_count INT DEFAULT 10,
  p_states TEXT[] DEFAULT '{}'
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
  similarity FLOAT,
  state TEXT,
  source_url TEXT,
  figure_refs JSONB
)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    nc.id,
    nc.standard_id,
    nc.clause_number,
    nc.clause_title,
    nc.content,
    NULL::INTEGER AS page_number,
    nc.chunk_index,
    nc.chunk_type,
    true AS is_normative,
    (1 - (nc.embedding <=> match_ncc_chunks.query_embedding))::FLOAT AS similarity,
    nc.state,
    nc.source_url,
    nc.figure_refs
  FROM public.ncc_chunks nc
  WHERE nc.is_live = true
    AND nc.embedding IS NOT NULL
    AND (nc.state IS NULL OR nc.state = ANY(match_ncc_chunks.p_states))
    AND (1 - (nc.embedding <=> match_ncc_chunks.query_embedding)) > match_ncc_chunks.match_threshold
  ORDER BY nc.embedding <=> match_ncc_chunks.query_embedding
  LIMIT LEAST(match_ncc_chunks.match_count, 50);
$$;

REVOKE ALL ON FUNCTION public.match_ncc_chunks(extensions.vector, FLOAT, INT, TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_ncc_chunks(extensions.vector, FLOAT, INT, TEXT[]) TO service_role;

CREATE OR REPLACE FUNCTION public.match_ncc_chunks_fts(
  query_text TEXT,
  match_count INT DEFAULT 10,
  p_states TEXT[] DEFAULT '{}'
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
  rank REAL,
  state TEXT,
  source_url TEXT,
  figure_refs JSONB
)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    nc.id,
    nc.standard_id,
    nc.clause_number,
    nc.clause_title,
    nc.content,
    NULL::INTEGER AS page_number,
    nc.chunk_index,
    nc.chunk_type,
    true AS is_normative,
    ts_rank(nc.fts, websearch_to_tsquery('english', query_text)) AS rank,
    nc.state,
    nc.source_url,
    nc.figure_refs
  FROM public.ncc_chunks nc
  WHERE nc.is_live = true
    AND (nc.state IS NULL OR nc.state = ANY(match_ncc_chunks_fts.p_states))
    AND nc.fts @@ websearch_to_tsquery('english', query_text)
  ORDER BY rank DESC
  LIMIT LEAST(match_ncc_chunks_fts.match_count, 50);
$$;

REVOKE ALL ON FUNCTION public.match_ncc_chunks_fts(TEXT, INT, TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_ncc_chunks_fts(TEXT, INT, TEXT[]) TO service_role;
