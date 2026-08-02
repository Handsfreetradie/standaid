-- Grants a fixed-length free trial (default 14 days) to someone by email,
-- reusing the same pro_expires_at + expire_promo_pro() cron mechanism
-- already used for promo signups (20260721000000_promo_pro_expiry.sql).
-- If the email has no account yet, the grant is parked here and applied by
-- handle_new_user() the moment they sign up — mirrors how pending team
-- invites are auto-linked (20260721030000_team_organizations.sql).

CREATE TABLE public.trial_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  tier public.subscription_tier NOT NULL DEFAULT 'pro',
  days INT NOT NULL,
  granted_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  redeemed_at TIMESTAMPTZ
);

ALTER TABLE public.trial_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trial_grants FROM PUBLIC, anon, authenticated;

-- Extends the current handle_new_user() (profiles insert + pending team
-- invite auto-link, from 20260721030000_team_organizations.sql) with a third
-- step: apply any unredeemed trial grant for this email.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_grant RECORD;
BEGIN
  INSERT INTO public.profiles (user_id, email)
  VALUES (NEW.id, NEW.email);

  UPDATE public.organization_members
  SET user_id = NEW.id, status = 'active', joined_at = now()
  WHERE lower(invited_email) = lower(NEW.email) AND status = 'pending';

  SELECT * INTO v_grant FROM public.trial_grants
  WHERE lower(email) = lower(NEW.email) AND redeemed_at IS NULL
  LIMIT 1;

  IF FOUND THEN
    -- No end-user JWT during signup (GoTrue performs this insert directly),
    -- so auth.uid() is NULL and trg_prevent_tier_self_change's
    -- service-role-only check passes, same as expire_promo_pro().
    UPDATE public.profiles
    SET subscription_tier = v_grant.tier,
        pro_expires_at = now() + (v_grant.days || ' days')::interval
    WHERE user_id = NEW.id;

    UPDATE public.trial_grants SET redeemed_at = now() WHERE id = v_grant.id;
  END IF;

  RETURN NEW;
END;
$$;
