-- Optional business email, alongside business_phone (20260909010000) — for
-- the switchboard legend header. Falls back to the account's login email in
-- the UI/report if left blank, same as business_name falls back to display_name.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS business_email TEXT;
