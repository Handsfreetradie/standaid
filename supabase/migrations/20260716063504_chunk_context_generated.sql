-- Contextual retrieval (Anthropic's technique): at embed time a one-line
-- situating context is generated per chunk and prepended to its content before
-- embedding, so a fragment like a bare table row still carries "which standard,
-- which section, what it covers". This flag records that the step has run for a
-- chunk so retriggers and re-runs never re-spend on it.
--
-- Existing chunks default FALSE but are never revisited: embed-chunks only
-- fetches rows WHERE embedding IS NULL, and existing chunks are already
-- embedded — so this adds zero cost to already-processed standards and only
-- applies to new uploads going forward.
ALTER TABLE standard_chunks
  ADD COLUMN IF NOT EXISTS context_generated BOOLEAN NOT NULL DEFAULT FALSE;
