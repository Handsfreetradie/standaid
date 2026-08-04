-- Two additions for the admin panel (Profile.tsx, Kyle-only):
--
-- 1. admin_query_counts_by_user() — lifetime query count per user, read by
--    the admin-users edge function. profiles.daily_query_count resets every
--    day (see query/index.ts), so it can't answer "how many queries has
--    this person ever run" — the queries table (one row per question) can.
--    SECURITY DEFINER + revoked from anon/authenticated so it's only usable
--    via the service-role client in admin-users, same defense-in-depth
--    pattern as expire_promo_pro().
--
-- 2. profiles.pro_trial_reminder_sent_at — dedupe column for the new
--    trial-reminder-email cron, so someone whose trial is 3 days from
--    expiring only gets the reminder once.

CREATE OR REPLACE FUNCTION public.admin_query_counts_by_user()
RETURNS TABLE(user_id uuid, total bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT q.user_id, count(*) AS total
  FROM public.queries q
  GROUP BY q.user_id;
$$;

REVOKE ALL ON FUNCTION public.admin_query_counts_by_user() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pro_trial_reminder_sent_at TIMESTAMPTZ;
