-- Beta: new signups get pro tier automatically
ALTER TABLE public.profiles ALTER COLUMN subscription_tier SET DEFAULT 'pro';

-- Upgrade all existing free users
UPDATE public.profiles SET subscription_tier = 'pro' WHERE subscription_tier = 'free';
