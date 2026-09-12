-- Business phone number, alongside the business_name/licence_number added in
-- 20260802000003 — needed on the Rough-In switchboard legend so the printed
-- sheet stuck inside the switchboard has a contact number on it.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS business_phone TEXT;
