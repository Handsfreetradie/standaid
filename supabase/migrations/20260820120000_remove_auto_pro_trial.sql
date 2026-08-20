-- Removes the automatic 7-day Pro trial for standard signups
-- (20260807000000_auto_pro_trial.sql). New users now just land on Free
-- (the profiles.subscription_tier column default) with no pro_expires_at,
-- same as before that migration existed.
--
-- Admin-granted trials (grant-trial edge function -> trial_grants table)
-- and business/team invite auto-upgrade are untouched — those are
-- deliberate, not the blanket "everyone gets 7 days free" default.
--
-- Does NOT touch existing profiles already mid-trial from the old
-- behaviour — this only changes what happens for signups from now on.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_grant RECORD;
  v_org_linked INT;
BEGIN
  INSERT INTO public.profiles (user_id, email) VALUES (NEW.id, NEW.email);

  UPDATE public.organization_members
  SET user_id = NEW.id, status = 'active', joined_at = now()
  WHERE lower(invited_email) = lower(NEW.email) AND status = 'pending';
  GET DIAGNOSTICS v_org_linked = ROW_COUNT;

  SELECT * INTO v_grant FROM public.trial_grants
  WHERE lower(email) = lower(NEW.email) AND redeemed_at IS NULL LIMIT 1;

  IF FOUND THEN
    UPDATE public.profiles
    SET subscription_tier = v_grant.tier, pro_expires_at = now() + (v_grant.days || ' days')::interval
    WHERE user_id = NEW.id;
    UPDATE public.trial_grants SET redeemed_at = now() WHERE id = v_grant.id;
  ELSIF v_org_linked > 0 THEN
    -- Team/business invite: give the new member business-tier access
    -- immediately, matching what the org owner is actually paying for.
    UPDATE public.profiles SET subscription_tier = 'business' WHERE user_id = NEW.id;
  END IF;
  -- Otherwise: standard signup, stays on the Free tier default. No more
  -- automatic 7-day Pro trial for everyone.

  RETURN NEW;
END;
$$;
