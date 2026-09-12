-- User's state(s)/territory(ies). Drives which NCC state variations the query
-- function includes (national clauses always apply). Tradies often work across
-- a border, so this is a list. Empty means national only unless the question
-- itself names a state.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS states TEXT[] NOT NULL DEFAULT '{}'
    CHECK (states <@ ARRAY['WA', 'NSW', 'VIC', 'QLD', 'SA', 'TAS', 'NT', 'ACT']::TEXT[]);
