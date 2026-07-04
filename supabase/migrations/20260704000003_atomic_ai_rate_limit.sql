-- Atomic AI rate limiting to close count-then-act TOCTOU races.
--
-- The query and capstone functions counted recent usage then proceeded, so a
-- burst of concurrent requests could all read "under limit" and all run
-- expensive AI work — bypassing the 5/day, 200/day and 20/hr caps.
--
-- This RPC serialises per (user, kind) with a transaction-scoped advisory lock,
-- counts usage in the window, and records the new usage row only if allowed —
-- all in one atomic call. Returns the usage count including this request, or
-- -1 if the request is over the limit and must be rejected.

CREATE TABLE IF NOT EXISTS public.ai_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_user_kind_time
  ON public.ai_usage (user_id, kind, created_at DESC);

ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;

-- Users may read their own usage; inserts happen only through the
-- SECURITY DEFINER RPC below (or the service role), never direct client writes.
DROP POLICY IF EXISTS "Users can view own ai usage" ON public.ai_usage;
CREATE POLICY "Users can view own ai usage"
  ON public.ai_usage FOR SELECT USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.check_and_record_ai_usage(
  p_user_id UUID,
  p_kind TEXT,
  p_max INT,
  p_window_seconds INT
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  used INT;
BEGIN
  -- Serialise concurrent requests for the same user+kind for this transaction.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_kind, 0));

  SELECT count(*) INTO used
  FROM public.ai_usage
  WHERE user_id = p_user_id
    AND kind = p_kind
    AND created_at > now() - make_interval(secs => p_window_seconds);

  IF used >= p_max THEN
    RETURN -1;
  END IF;

  INSERT INTO public.ai_usage (user_id, kind) VALUES (p_user_id, p_kind);
  RETURN used + 1;
END;
$$;
