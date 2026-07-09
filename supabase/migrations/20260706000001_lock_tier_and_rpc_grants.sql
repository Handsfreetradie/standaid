-- Security hardening: two access-control holes found in audit.
--
-- 1. PRIVILEGE ESCALATION — profiles.subscription_tier
--    The "Users can update own profile" RLS policy has no column restriction,
--    so any authenticated user could PATCH their own row and set
--    subscription_tier = 'pro'/'business', bypassing every tier gate and the
--    AI-spend limits. Tier changes must only come from the service role
--    (billing webhook / admin). A BEFORE UPDATE trigger enforces that.
--
-- 2. CROSS-TENANT READ — SECURITY DEFINER RPCs
--    match_chunks / match_feedback_corrections / check_and_record_ai_usage
--    take the target user_id as a PARAMETER and bypass RLS. They are only ever
--    called server-side with the service role, but PostgREST exposes every
--    public function to anon/authenticated by default. A logged-in user could
--    call match_chunks directly with another user's UUID and read that user's
--    uploaded standards. Revoke client execution; keep it for service_role.

-- ── 1. Block tier self-escalation ──────────────────────────────────────────
-- SECURITY INVOKER (default) so auth.uid() reflects the CALLER. Under a
-- service-role call there is no end-user JWT, so auth.uid() is NULL and the
-- change is allowed; under any authenticated user session it is blocked.
CREATE OR REPLACE FUNCTION public.prevent_tier_self_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.subscription_tier IS DISTINCT FROM OLD.subscription_tier
     AND auth.uid() IS NOT NULL
  THEN
    RAISE EXCEPTION 'subscription_tier can only be changed by the service role';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_tier_self_change ON public.profiles;
CREATE TRIGGER trg_prevent_tier_self_change
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_tier_self_change();

-- ── 2. Lock the SECURITY DEFINER RPCs to the service role ───────────────────
-- Signature-agnostic: revoke from client roles and (re)grant to service_role
-- for every overload of these functions in the public schema.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN (
        'match_chunks',
        'match_feedback_corrections',
        'check_and_record_ai_usage'
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;
