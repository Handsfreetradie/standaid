# Stripe billing — setup guide

This app has the full Stripe subscription framework built in. To switch it on
you need a Stripe account and a few config values. Nothing here is secret in
the repo — all keys live in Stripe and in Supabase function secrets.

## What's already built
- `subscriptions` table + `stripe_customer_id` on `profiles` (migration `20260705000000`), extended with a `quantity` column and team/org tables (migration `20260721030000`)
- Edge functions:
  - `create-checkout` — starts a Stripe Checkout session for Pro, Business, or a per-seat Team plan
  - `customer-portal` — opens Stripe's hosted manage/cancel portal
  - `stripe-webhook` — the ONLY thing that changes a user's tier or a team's seat count, driven by verified Stripe events
  - `add-team-seat` — buys one more seat on an existing team subscription (prorated), owner-only
- Profile screen: real Upgrade (Pro/Business) + Manage Subscription buttons, success/cancel handling, and a "Set up a team" entry point
- `/team` page: create a team (name + seat count → Checkout), add/remove members by email, seat usage

## One-time Stripe setup
1. Create a **Stripe account** (start in **test mode** — toggle top-right).
2. **Products → Add product** three times:
   - "StandAId Pro" → recurring price **$19.99 AUD / month** → copy the **Price ID** (`price_...`)
   - "StandAId Business" → recurring price **$49.99 AUD / month** → copy its Price ID
   - "StandAId Team Seat" → recurring price **per seat / month** (pick your own per-seat rate) → copy its Price ID.
     This one gets bought with `quantity = number of seats`, so **do not** check "per unit" pricing tiers —
     a plain recurring price works fine, Stripe multiplies it by quantity automatically.
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
STRIPE_PRICE_TEAM_SEAT=price_...  # the per-seat Team price id
```

## Test it (test mode)
- Upgrade from the Profile screen → Stripe Checkout → pay with test card `4242 4242 4242 4242`, any future expiry/CVC.
- After paying you should return to `/profile?checkout=success`, and within a
  second the webhook flips your `subscription_tier` to `pro`/`business`.
- "Manage subscription" opens the portal; cancelling there flips you back to `free`.
- **Team flow**: go to `/team` → "Set up a team" → enter a name and seat count → Checkout with the test card.
  You should land back on `/team` as the org owner. Add a teammate's email while under capacity (no charge);
  add one more past capacity and confirm a prorated test charge appears in Stripe → Payments, and `seat_limit`
  goes up. Try inserting an extra `organization_members` row directly via SQL past the seat limit — it should
  be rejected by the database trigger regardless of what the app does.

## Going live (later — deliberate step)
- Repeat products/keys/webhook in **live mode** and swap the secrets to `sk_live_`/`whsec_` (live).
- The beta free-default has already been ended (migration `20260720000000` reverted new signups to `free`;
  existing beta users kept whatever tier they had) — nothing left to do here before charging real customers.
- Make sure the T&Cs cover subscriptions, billing, refunds, and the team/seat model (lawyer's eye).

## Security notes (already handled)
- Tier is changed ONLY by `stripe-webhook`, after verifying the Stripe signature — never trusted from the browser.
- `subscriptions` has RLS: users read their own; writes are service-role only.
- Card details never touch our servers — Stripe hosts checkout and the portal.
