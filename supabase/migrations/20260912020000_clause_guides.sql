-- Clause guides — Phase 2 of the NCC + Standards Content Plan.
--
-- Plain-English summaries of the AS/NZS clauses tradies look up most (RCDs,
-- wet-area zones, earthing, testing…). These are StandAId's OWN wording,
-- written from "what's the rule", never the standard's text or tables — the
-- standard is cited by clause number only. Shared across every account like
-- the NCC index, but shipped dark: is_live=false until the SME has reviewed
-- the draft AND legal (Murfett) has signed off on the approach. source_notes
-- keeps the source-clause → final-wording paper trail of independent
-- authorship per entry.
--
-- Each guide set gets an ownerless row in `standards` (source='guide') so the
-- query function's citation/trade plumbing works unchanged; standard_code
-- keeps the real standard's prefix so trade-detection.ts maps it correctly.

ALTER TABLE public.standards DROP CONSTRAINT IF EXISTS standards_source_check;
ALTER TABLE public.standards ADD CONSTRAINT standards_source_check CHECK (source IN ('upload', 'ncc', 'guide'));

INSERT INTO public.standards (id, user_id, title, standard_code, version, source, licence, attribution, extraction_status, trade_category)
VALUES
  ('a0000000-0000-4000-8000-00000000cc11'::uuid, NULL, 'StandAId Guide — AS/NZS 3000 Wiring Rules (simplified summaries)', 'AS/NZS 3000 Guide', '2018', 'guide', 'StandAId original content', 'Simplified summary written by StandAId — not the text of the standard. Always verify against the current AS/NZS 3000 clause.', 'complete', 'electrical'),
  ('a0000000-0000-4000-8000-00000000cc12'::uuid, NULL, 'StandAId Guide — AS/NZS 3500 Plumbing and drainage (simplified summaries)', 'AS/NZS 3500 Guide', '2021', 'guide', 'StandAId original content', 'Simplified summary written by StandAId — not the text of the standard. Always verify against the current AS/NZS 3500 clause.', 'complete', 'plumbing')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.clause_guides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  standard_id UUID NOT NULL REFERENCES public.standards(id) ON DELETE CASCADE,
  standard_code TEXT NOT NULL,                 -- 'AS/NZS 3000' — the standard being summarised (cited by number only)
  clause_ref TEXT NOT NULL,                    -- '2.6.3.2.2'
  title TEXT NOT NULL,                         -- 'RCD protection — homes'
  trade TEXT NOT NULL,                         -- electrical | plumbing | …
  topic TEXT NOT NULL,                         -- 'rcd-protection' (groups related clauses)
  summary TEXT NOT NULL,                       -- the plain-English rule, our own words
  key_values JSONB NOT NULL DEFAULT '[]',      -- [{label, value}] restated facts, never a table copy
  related_ncc TEXT[] NOT NULL DEFAULT '{}',    -- NCC clause numbers this rule connects to
  keywords TEXT[] NOT NULL DEFAULT '{}',       -- tradie words that should find this
  source_notes TEXT,                           -- paper trail: source clause → how the wording was derived, what to check
  search_text TEXT NOT NULL DEFAULT '',        -- maintained by trigger; what gets embedded/searched
  is_live BOOLEAN NOT NULL DEFAULT false,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  embedding extensions.vector(1536),
  fts tsvector GENERATED ALWAYS AS (to_tsvector('english', search_text)) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (standard_code, clause_ref)
);

CREATE INDEX IF NOT EXISTS idx_clause_guides_embedding ON public.clause_guides USING hnsw (embedding extensions.vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_clause_guides_fts ON public.clause_guides USING GIN (fts);
CREATE INDEX IF NOT EXISTS idx_clause_guides_clause ON public.clause_guides (standard_code, clause_ref);

-- search_text is derived from the editable fields; when it changes the old
-- vector is dropped so embed-ncc (table=clause_guides) re-embeds the row.
CREATE OR REPLACE FUNCTION public.clause_guides_before_write()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  kv TEXT;
BEGIN
  SELECT string_agg(coalesce(e->>'label', '') || ': ' || coalesce(e->>'value', ''), '; ')
    INTO kv FROM jsonb_array_elements(coalesce(NEW.key_values, '[]'::jsonb)) e;
  NEW.search_text := NEW.standard_code || ' clause ' || NEW.clause_ref || ' — ' || NEW.title
    || E'\n' || NEW.summary
    || CASE WHEN kv IS NOT NULL AND kv <> '' THEN E'\nKey values: ' || kv ELSE '' END
    || CASE WHEN array_length(NEW.keywords, 1) > 0 THEN E'\n' || array_to_string(NEW.keywords, ', ') ELSE '' END;
  IF TG_OP = 'UPDATE' AND NEW.search_text IS DISTINCT FROM OLD.search_text THEN
    NEW.embedding := NULL;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS clause_guides_before_write ON public.clause_guides;
CREATE TRIGGER clause_guides_before_write
  BEFORE INSERT OR UPDATE ON public.clause_guides
  FOR EACH ROW EXECUTE FUNCTION public.clause_guides_before_write();

ALTER TABLE public.clause_guides ENABLE ROW LEVEL SECURITY;

-- Signed-in users read live guides (Phase 3 "why this matters" reads this
-- directly). Drafts and all writes go through the admin-clause-guides
-- function with the service role.
CREATE POLICY "Authenticated users can read live clause guides"
  ON public.clause_guides FOR SELECT
  TO authenticated
  USING (is_live = true);

CREATE OR REPLACE FUNCTION public.match_clause_guides(
  query_embedding extensions.vector(1536),
  match_threshold FLOAT DEFAULT 0.30,
  match_count INT DEFAULT 6
)
RETURNS TABLE (
  id UUID, standard_id UUID, standard_code TEXT, clause_ref TEXT, title TEXT, trade TEXT, topic TEXT,
  summary TEXT, key_values JSONB, related_ncc TEXT[], search_text TEXT, similarity FLOAT
)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT g.id, g.standard_id, g.standard_code, g.clause_ref, g.title, g.trade, g.topic,
         g.summary, g.key_values, g.related_ncc, g.search_text,
         (1 - (g.embedding <=> match_clause_guides.query_embedding))::FLOAT AS similarity
  FROM public.clause_guides g
  WHERE g.is_live = true
    AND g.embedding IS NOT NULL
    AND (1 - (g.embedding <=> match_clause_guides.query_embedding)) > match_clause_guides.match_threshold
  ORDER BY g.embedding <=> match_clause_guides.query_embedding
  LIMIT LEAST(match_clause_guides.match_count, 20);
$$;
REVOKE ALL ON FUNCTION public.match_clause_guides(extensions.vector, FLOAT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_clause_guides(extensions.vector, FLOAT, INT) TO service_role;

CREATE OR REPLACE FUNCTION public.match_clause_guides_fts(
  query_text TEXT,
  match_count INT DEFAULT 6
)
RETURNS TABLE (
  id UUID, standard_id UUID, standard_code TEXT, clause_ref TEXT, title TEXT, trade TEXT, topic TEXT,
  summary TEXT, key_values JSONB, related_ncc TEXT[], search_text TEXT, rank REAL
)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT g.id, g.standard_id, g.standard_code, g.clause_ref, g.title, g.trade, g.topic,
         g.summary, g.key_values, g.related_ncc, g.search_text,
         ts_rank(g.fts, websearch_to_tsquery('english', query_text)) AS rank
  FROM public.clause_guides g
  WHERE g.is_live = true
    AND g.fts @@ websearch_to_tsquery('english', query_text)
  ORDER BY rank DESC
  LIMIT LEAST(match_clause_guides_fts.match_count, 20);
$$;
REVOKE ALL ON FUNCTION public.match_clause_guides_fts(TEXT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_clause_guides_fts(TEXT, INT) TO service_role;
