-- Closes a real bypass: RLS on standards/standard_chunks only checked row
-- ownership, not which columns changed, so any authenticated user could
-- directly flip their own standards.extraction_status or
-- standard_chunks.is_indexed back on via a raw client update. Blocked
-- AS/NZS standards keep their embeddings (soft-disable, see
-- 20260820000001_disable_ai_on_existing_sa_standards.sql), so this let
-- anyone restore full AI search over genuine Standards Australia content
-- with a single browser-console call — no renaming or reprocessing needed.
--
-- The frontend never legitimately writes to standard_chunks (read-only from
-- the client) and never calls .update() on standards today (only
-- .delete()), so removing UPDATE entirely breaks nothing working. The new
-- rename-standard edge function is the only writer going forward, using the
-- service-role key, which bypasses RLS/grants as normal.

DROP POLICY IF EXISTS "Users can update own standards" ON public.standards;
REVOKE UPDATE ON public.standards FROM authenticated;

DROP POLICY IF EXISTS "Users can update own chunks" ON public.standard_chunks;
REVOKE UPDATE ON public.standard_chunks FROM authenticated;
