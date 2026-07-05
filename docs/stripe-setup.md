# Stripe billing — setup guide

This app has the full Stripe subscription framework built in. To switch it on
you need a Stripe account and a few config values. Nothing here is secret in
the repo — all keys live in Stripe and in Supabase function secrets.

## What's already built
- `subscriptions` table + `stripe_customer_id` on `profiles` (migration `20260705000000`)
- Edge functions:
  - `create-checkout` — starts a Stripe Checkout session for Pro/Business
  - `customer-portal` — opens Stripe's hosted manage/cancel portal
  - `stripe-webhook` — the ONLY thing that changes a user's tier, driven by verified Stripe events
- Profile screen: real Upgrade (Pro/Business) + Manage Subscription buttons, and success/cancel handling

## One-time Stripe setup
1. Create a **Stripe account** (start in **test mode** — toggle top-right).
2. **Products → Add product** twice:
   - "StandAId Pro" → recurring price **$19.99 AUD / month** → copy the **Price ID** (`price_...`)
   - "StandAId Business" → recurring price **$49.99 AUD / month** → copy its Price ID
3. **Developers → API keys** → copy the **Secret key** (`sk_test_...`).
4. **Developers → Webhooks → Add endpoint**:
   - URL: `https://wyxeqkgpwkcckyntqcns.supabase.co/functions/v1/stripe-webhook`
   - Events: `checkout.session.completed`, `customer.subscription.created`,
     `customer.subscription.updated`, `customer.subscription.deleted`
   - Copy the **Signing secret** (`whsec_...`)
5. (Recommended) **Settings → Tax** → enable **Stripe Tax** for Australian GST, and add your ABN under business settings so invoices are compliant.

## Set these Supabase function secrets
Dashboard → Edge Functions → Secrets (or `supabase secrets set`):

```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_PRO=price_...        # the Pro price id
STRIPE_PRICE_BUSINESS=price_...   # the Business price id
```

## Test it (test mode)
- Upgrade from the Profile screen → Stripe Checkout → pay with test card `4242 4242 4242 4242`, any future expiry/CVC.
- After paying you should return to `/profile?checkout=success`, and within a
  second the webhook flips your `subscription_tier` to `pro`/`business`.
- "Manage subscription" opens the portal; cancelling there flips you back to `free`.

## Going live (later — deliberate step)
- Repeat products/keys/webhook in **live mode** and swap the secrets to `sk_live_`/`whsec_` (live).
- **End the beta:** right now migration `20260519000001` defaults everyone to `pro` for free. To actually charge, set the default back to `free` for NEW users — but decide how to treat existing beta users first (grandfather them, or migrate). This is intentionally not automated because it downgrades people.
- Make sure the T&Cs cover subscriptions, billing, and refunds (lawyer's eye).

## Security notes (already handled)
- Tier is changed ONLY by `stripe-webhook`, after verifying the Stripe signature — never trusted from the browser.
- `subscriptions` has RLS: users read their own; writes are service-role only.
- Card details never touch our servers — Stripe hosts checkout and the portal.
