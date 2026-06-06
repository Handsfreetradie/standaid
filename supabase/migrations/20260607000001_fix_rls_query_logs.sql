-- Re-enable RLS on query_log and query_feedback and add user-scoped policies.
-- These tables were deliberately left open (service-role access only) in the
-- original schema. We now lock them down so users can only read their own rows.
-- Edge functions use the service role key which bypasses RLS entirely, so the
-- INSERT policies below are belt-and-suspenders only.

ALTER TABLE public.query_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.query_feedback ENABLE ROW LEVEL SECURITY;

-- ── query_log ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can view own query logs" ON public.query_log;
CREATE POLICY "Users can view own query logs"
  ON public.query_log
  FOR SELECT
  USING (auth.uid() = user_id);

-- Service role bypasses RLS; this policy covers any direct-client inserts
DROP POLICY IF EXISTS "Service role can insert query logs" ON public.query_log;
CREATE POLICY "Service role can insert query logs"
  ON public.query_log
  FOR INSERT
  WITH CHECK (true);

-- ── query_feedback ─────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can view own feedback" ON public.query_feedback;
CREATE POLICY "Users can view own feedback"
  ON public.query_feedback
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can insert feedback" ON public.query_feedback;
CREATE POLICY "Service role can insert feedback"
  ON public.query_feedback
  FOR INSERT
  WITH CHECK (true);
