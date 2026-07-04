-- Close a cross-tenant AI-poisoning vector.
--
-- query_feedback / query_log had INSERT policies of WITH CHECK (true), so any
-- authenticated client (the anon key ships in the frontend) could insert rows
-- directly via PostgREST. On query_feedback that allowed setting
-- approved_for_training = true, and match_feedback_corrections surfaces
-- approved rows into EVERY user's AI prompt context — letting one user inject
-- crafted "corrections" into other users' answers.
--
-- The edge functions (query, feedback) write these tables with the service
-- role key, which bypasses RLS, so they are unaffected. Direct client inserts
-- are now constrained to the caller's own rows and can never self-approve.

-- ── query_feedback ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Service role can insert feedback" ON public.query_feedback;
DROP POLICY IF EXISTS "Users can insert own feedback" ON public.query_feedback;

CREATE POLICY "Users can insert own feedback"
  ON public.query_feedback
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND approved_for_training = false
  );

-- ── query_log ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Service role can insert query logs" ON public.query_log;
DROP POLICY IF EXISTS "Users can insert own query logs" ON public.query_log;

CREATE POLICY "Users can insert own query logs"
  ON public.query_log
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);
