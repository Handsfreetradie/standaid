-- End of beta: new signups start on the free tier.
-- Existing users keep whatever tier they already have (beta users stay pro).
ALTER TABLE public.profiles ALTER COLUMN subscription_tier SET DEFAULT 'free';
