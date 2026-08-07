-- Per-call AI token/cost logging, separate from ai_usage (which only counts
-- calls for rate-limiting and carries no token/cost data — see
-- 20260704000003_atomic_ai_rate_limit.sql). This table exists purely so
-- "how much is this user/feature costing us" is answerable without manual
-- token-math from the Anthropic/OpenAI consoles.
--
-- Written by a shared edge-function helper (_shared/log-usage.ts) right after
-- each AI response, using the `usage` field every response already includes.
-- Cost is computed and stored at write time using a hardcoded pricing table
-- in that helper, not recomputed later — so historical rows stay accurate
-- even if prices change.

CREATE TABLE public.token_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  cache_read_tokens INT NOT NULL DEFAULT 0,
  cache_creation_tokens INT NOT NULL DEFAULT 0,
  estimated_cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,
  ref_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_token_usage_user_time ON public.token_usage (user_id, created_at DESC);
CREATE INDEX idx_token_usage_kind_time ON public.token_usage (kind, created_at DESC);

ALTER TABLE public.token_usage ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.token_usage FROM PUBLIC, anon;

-- Users may see their own usage; everything else (including admin's
-- cross-user aggregation) goes through the service role in edge functions.
CREATE POLICY "Users can view own token usage"
  ON public.token_usage FOR SELECT USING (auth.uid() = user_id);

-- Per-user lifetime cost, mirroring the existing admin_query_counts_by_user
-- pattern (20260804120000_admin_users_query_counts_and_trial_reminder.sql)
-- so admin-users can join it the same way.
CREATE OR REPLACE FUNCTION public.admin_cost_by_user()
RETURNS TABLE(user_id UUID, total_cost_usd NUMERIC)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.user_id, SUM(t.estimated_cost_usd) AS total_cost_usd
  FROM public.token_usage t
  WHERE t.user_id IS NOT NULL
  GROUP BY t.user_id;
$$;

REVOKE ALL ON FUNCTION public.admin_cost_by_user() FROM PUBLIC, anon, authenticated;
