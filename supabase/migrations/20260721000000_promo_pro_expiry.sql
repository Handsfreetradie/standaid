-- Manual promo upgrades (e.g. "first 20 signups get a month of pro") need an
-- expiry so pro doesn't stick around forever after Kyle runs a one-off
-- UPDATE. This adds the expiry column plus a daily sweep that reverts
-- anyone past their expiry back to free — mirrors the existing
-- resume_stalled_indexing / sweep_stale_processing_jobs cron pattern.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pro_expires_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.expire_promo_pro()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- No end-user JWT in a cron context, so auth.uid() is NULL and
  -- trg_prevent_tier_self_change's service-role-only check passes.
  UPDATE public.profiles
  SET subscription_tier = 'free',
      pro_expires_at = NULL
  WHERE subscription_tier = 'pro'
    AND pro_expires_at IS NOT NULL
    AND pro_expires_at < now();
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[expire-promo-pro] failed: %', SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_promo_pro() FROM PUBLIC, anon, authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'expire-promo-pro',
  '0 * * * *',
  'SELECT public.expire_promo_pro()'
);
