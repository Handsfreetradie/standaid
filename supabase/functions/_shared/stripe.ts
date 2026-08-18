import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

// Shared Stripe client + tier mapping for the billing edge functions.
// All secrets come from the function environment — nothing is committed.

export function getStripe(): Stripe {
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
  return new Stripe(key, {
    apiVersion: "2024-06-20",
    httpClient: Stripe.createFetchHttpClient(),
  });
}

export type PaidTier = "pro" | "business";
export type BillingInterval = "monthly" | "annual";

// Map an app tier → the Stripe Price id configured in the environment.
// "business_team" is a distinct per-seat Price, not one of the two personal
// tiers — priceIdForTier only handles the two individual tiers; team
// checkout reads STRIPE_PRICE_TEAM_SEAT directly (see create-checkout).
//
// "pro" has two live prices (monthly/annual). STRIPE_PRICE_PRO is the
// legacy $19.99/mo price — kept only so existing subscribers on it keep
// working (see tierForPriceId below); new checkouts never use it.
export function priceIdForTier(tier: string, interval: BillingInterval = "monthly"): string {
  if (tier === "pro") {
    const price = interval === "annual"
      ? Deno.env.get("STRIPE_PRICE_PRO_ANNUAL")
      : Deno.env.get("STRIPE_PRICE_PRO_MONTHLY");
    if (!price) throw new Error(`No Stripe price configured for tier "pro" interval "${interval}"`);
    return price;
  }
  if (tier === "business") {
    const price = interval === "annual"
      ? Deno.env.get("STRIPE_PRICE_BUSINESS_ANNUAL")
      : Deno.env.get("STRIPE_PRICE_BUSINESS");
    if (!price) throw new Error(`No Stripe price configured for tier "business" interval "${interval}"`);
    return price;
  }
  throw new Error(`No Stripe price configured for tier "${tier}"`);
}

export function teamSeatPriceId(interval: BillingInterval = "monthly"): string {
  const price = interval === "annual"
    ? Deno.env.get("STRIPE_PRICE_TEAM_SEAT_ANNUAL")
    : Deno.env.get("STRIPE_PRICE_TEAM_SEAT");
  if (!price) throw new Error(`STRIPE_PRICE_TEAM_SEAT${interval === "annual" ? "_ANNUAL" : ""} not configured`);
  return price;
}

// Reverse map a Stripe Price id → app tier (used by the webhook).
export function tierForPriceId(priceId: string | undefined): PaidTier | null {
  if (!priceId) return null;
  if (priceId === Deno.env.get("STRIPE_PRICE_PRO")) return "pro"; // legacy $19.99/mo, existing subscribers only
  if (priceId === Deno.env.get("STRIPE_PRICE_PRO_MONTHLY")) return "pro";
  if (priceId === Deno.env.get("STRIPE_PRICE_PRO_ANNUAL")) return "pro";
  if (priceId === Deno.env.get("STRIPE_PRICE_BUSINESS")) return "business";
  if (priceId === Deno.env.get("STRIPE_PRICE_BUSINESS_ANNUAL")) return "business";
  if (priceId === Deno.env.get("STRIPE_PRICE_TEAM_SEAT")) return "business";
  if (priceId === Deno.env.get("STRIPE_PRICE_TEAM_SEAT_ANNUAL")) return "business";
  return null;
}

// Statuses that grant paid access. Anything else (canceled, unpaid, etc.)
// drops the user back to free.
export function isActiveStatus(status: string): boolean {
  return status === "active" || status === "trialing";
}
