-- Add email_promotions_unsubscribed flag to profiles for promo email opt-out
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS email_promotions_unsubscribed boolean DEFAULT false;

COMMENT ON COLUMN profiles.email_promotions_unsubscribed IS 'User has opted out of promotional emails (e.g., social share incentive campaigns)';
