-- Stripe billing schema.
--
-- profiles.subscription_tier remains the single source of truth for access
-- level across the app; it is written ONLY by the stripe-webhook function
-- (service role) in response to verified Stripe events — never by the client.
--
-- NOTE: the beta migration (20260519000001) currently defaults new profiles to
-- 'pro' so every beta user has full access for free. This migration does NOT
-- change that — flipping the default back to 'free' would downgrade existing
-- beta users, so that's a deliberate go-live step for later.

-- Stripe customer id lives on the profile (one customer per user)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT UNIQUE;

-- Full subscription state mirrored from Stripe for display + reconciliation
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id TEXT NOT NULL,
  stripe_subscription_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,                    -- active, trialing, past_due, canceled, unpaid, ...
  tier public.subscription_tier NOT NULL,  -- pro | business (derived from the price)
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON public.subscriptions (user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_customer ON public.subscriptions (stripe_customer_id);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Users may read their own subscription; all writes go through the webhook
-- (service role, which bypasses RLS). No client INSERT/UPDATE policy exists.
DROP POLICY IF EXISTS "Users can view own subscription" ON public.subscriptions;
CREATE POLICY "Users can view own subscription"
  ON public.subscriptions FOR SELECT USING (auth.uid() = user_id);
