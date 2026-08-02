-- Invalidate the shared team question cache when a standard's content changes.
--
-- question_cache rows only died via ON DELETE CASCADE when the standard row
-- was deleted. A standard corrected or reprocessed in place (chunks updated,
-- deleted, or re-inserted) kept serving the stale cached answer for up to 30
-- days — on safety-critical compliance content. Any chunk change now clears
-- that standard's cache entries.

CREATE INDEX idx_question_cache_standard ON public.question_cache (standard_id);

-- SECURITY DEFINER: question_cache has no client write policies (service-role
-- only), so the trigger must run with owner rights to delete rows when a
-- regular user's session touches standard_chunks.
CREATE OR REPLACE FUNCTION public.invalidate_question_cache()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.question_cache
  WHERE standard_id = COALESCE(NEW.standard_id, OLD.standard_id);
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_invalidate_question_cache
AFTER INSERT OR UPDATE OR DELETE ON public.standard_chunks
FOR EACH ROW EXECUTE FUNCTION public.invalidate_question_cache();
