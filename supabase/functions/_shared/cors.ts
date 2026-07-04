const PRODUCTION_ORIGINS = [
  "https://standaid.vercel.app",
  "https://standaid-9mas.vercel.app",
  "https://standaid.com.au",
  "https://standaid.ai",
  "https://www.standaid.ai",
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
