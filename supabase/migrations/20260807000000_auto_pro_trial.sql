-- Every new signup now gets a 7-day Pro trial automatically, not just
-- people an admin manually granted a trial to. Reuses the existing
-- pro_expires_at + expire_promo_pro() hourly cron (reverts to free once it
-- passes, 20260721000000_promo_pro_expiry.sql) and the existing
-- send_trial_ending_reminders() daily cron (3-day warning email,
-- 20260804130000_trial_reminder_cron.sql) — both are tier-agnostic already,
-- so no new cron/edge function is needed.
--
-- Precedence is unchanged from before, just with a new default at the end:
--   1. Admin-granted trial_grants row for this email (takes priority)
--   2. Pending org/team invite for this email -> business tier
--   3. NEW: otherwise, default 7-day pro trial

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
  ELSE
    -- Standard signup: 7-day Pro trial for everyone, no card required.
    UPDATE public.profiles
    SET subscription_tier = 'pro', pro_expires_at = now() + interval '7 days'
    WHERE user_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;
