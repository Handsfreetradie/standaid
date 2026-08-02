-- Team/business invites gave the invited person shared standards-library
-- access (organization_members + organization_id on the standards tables)
-- but never touched profiles.subscription_tier — so a business-plan
-- teammate still landed on the Free plan (5 queries/day, no Site Audit,
-- now also the new 1-use/day tool cap) despite being on a paid seat.
-- Fixes both join paths: brand-new signup (handle_new_user) and an
-- existing account added to a team afterwards (link_pending_org_membership).

-- ── Helper: is this user an active member of ANY organization? ─────────────
-- SECURITY DEFINER so it can be called from the tier-lock trigger below
-- without re-entering organization_members' own RLS policy.
CREATE OR REPLACE FUNCTION public.is_any_active_org_member(check_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_members
    WHERE user_id = check_user_id AND status = 'active'
  );
$$;

-- ── Narrow, safe carve-out in the tier-lock trigger ─────────────────────────
-- A user may set their OWN row's tier to exactly 'business', and only when
-- they're verifiably an active org member — a fact only an org owner's
-- add_org_member RPC can create (organization_members has no client-writable
-- policy), so this can't be self-forged, and it can never be used to reach
-- 'pro' or to touch anyone else's row.
CREATE OR REPLACE FUNCTION public.prevent_tier_self_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.subscription_tier IS DISTINCT FROM OLD.subscription_tier
     AND auth.uid() IS NOT NULL
     AND NOT (
       auth.uid() = NEW.user_id
       AND NEW.subscription_tier = 'business'
       AND public.is_any_active_org_member(auth.uid())
     )
  THEN
    RAISE EXCEPTION 'subscription_tier can only be changed by the service role';
  END IF;
  RETURN NEW;
END;
$$;

-- ── Brand-new signup whose email was already invited to a team ─────────────
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

  RETURN NEW;
END;
$$;

-- ── Existing account added to a team afterwards ─────────────────────────────
-- Runs via RPC under the joining user's own session (auth.uid() is their id,
-- not NULL) — the profiles UPDATE below relies on the trigger carve-out
-- above, which is only satisfiable once the org_members UPDATE just above it
-- has made them an active member.
CREATE OR REPLACE FUNCTION public.link_pending_org_membership()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_email TEXT;
  v_linked INT;
BEGIN
  SELECT email INTO caller_email FROM auth.users WHERE id = auth.uid();
  IF caller_email IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.organization_members
  SET user_id = auth.uid(), status = 'active', joined_at = now()
  WHERE lower(invited_email) = lower(caller_email) AND status = 'pending';
  GET DIAGNOSTICS v_linked = ROW_COUNT;

  IF v_linked > 0 THEN
    -- Only lift a Free account — never touches someone who already has
    -- their own paid pro/business subscription.
    UPDATE public.profiles SET subscription_tier = 'business'
    WHERE user_id = auth.uid() AND subscription_tier = 'free';
  END IF;
END;
$$;

-- ── One-time backfill ────────────────────────────────────────────────────
-- Fixes active team members who joined before this migration existed and
-- are stuck on Free despite being on a paid business seat. Runs as the
-- migration role (no end-user JWT), so the tier-lock trigger allows it.
UPDATE public.profiles p
SET subscription_tier = 'business'
FROM public.organization_members om
WHERE om.user_id = p.user_id AND om.status = 'active' AND p.subscription_tier = 'free';
