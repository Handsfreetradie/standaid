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

// Map an app tier → the Stripe Price id configured in the environment.
// "business_team" is a distinct per-seat Price, not one of the two personal
// tiers — priceIdForTier only handles the two individual tiers; team
// checkout reads STRIPE_PRICE_TEAM_SEAT directly (see create-checkout).
export function priceIdForTier(tier: string): string {
  const map: Record<string, string | undefined> = {
    pro: Deno.env.get("STRIPE_PRICE_PRO"),
    business: Deno.env.get("STRIPE_PRICE_BUSINESS"),
  };
  const price = map[tier];
  if (!price) throw new Error(`No Stripe price configured for tier "${tier}"`);
  return price;
}

export function teamSeatPriceId(): string {
  const price = Deno.env.get("STRIPE_PRICE_TEAM_SEAT");
  if (!price) throw new Error("STRIPE_PRICE_TEAM_SEAT not configured");
  return price;
}

// Reverse map a Stripe Price id → app tier (used by the webhook).
export function tierForPriceId(priceId: string | undefined): PaidTier | null {
  if (!priceId) return null;
  if (priceId === Deno.env.get("STRIPE_PRICE_PRO")) return "pro";
  if (priceId === Deno.env.get("STRIPE_PRICE_BUSINESS")) return "business";
  if (priceId === Deno.env.get("STRIPE_PRICE_TEAM_SEAT")) return "business";
  return null;
}

// Statuses that grant paid access. Anything else (canceled, unpaid, etc.)
// drops the user back to free.
export function isActiveStatus(status: string): boolean {
  return status === "active" || status === "trialing";
}
