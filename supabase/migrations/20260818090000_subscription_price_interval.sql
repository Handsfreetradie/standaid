-- Track which Stripe price and billing interval a subscription is on.
-- Previously only the resolved tier ("pro"/"business") was stored, so the
-- app had no way to tell a monthly subscriber from an annual one.
alter table public.subscriptions
  add column if not exists price_id text,
  add column if not exists interval text;
