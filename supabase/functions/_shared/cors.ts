// The canonical live app URL. Used both as the CORS fallback (element 0
// below) and directly by any function that needs to build a real redirect
// URL (Stripe success/cancel/return_url) rather than just validate a
// request's Origin header — those two uses must never drift apart, since a
// mismatch here once sent paying customers back to a dead domain post-checkout.
export const APP_URL = "https://app.standaid.ai";

const PRODUCTION_ORIGINS = [
  APP_URL,
  "https://standaid.com.au",
  "https://standaid.ai",
  "https://www.standaid.ai",
  "https://standaid.vercel.app",
  "https://standaid-9mas.vercel.app",
];

const ENV_ORIGINS = (Deno.env.get("ALLOWED_ORIGIN") || "")
  .split(",").map((o: string) => o.trim()).filter(Boolean);

const ALLOWED_ORIGINS = [...new Set([...PRODUCTION_ORIGINS, ...ENV_ORIGINS])];

export function getAllowedOrigin(origin: string): string {
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  // Allow any localhost port for local development
  if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return origin;
  return ALLOWED_ORIGINS[0];
}
