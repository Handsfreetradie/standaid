/**
 * Trade Detection
 *
 * Analyses a user query and selected standard to determine which trade
 * context to use when building the system prompt.
 *
 * Detection order:
 *   1. Explicit standard ID (if user selected a specific standard)
 *   2. Keyword matching on the query text
 *   3. Fallback to 'general'
 *
 * Add this helper to supabase/functions/query/index.ts BEFORE the main
 * serve() handler, alongside other helpers.
 */

import type { TradeType } from "./01-system-prompt.ts";

/**
 * Maps known AS/NZS standard prefixes to their trade.
 * Extend this list as StandAid ingests more standards.
 */
const STANDARD_TO_TRADE: Record<string, TradeType> = {
  // Electrical
  "AS/NZS 3000": "electrical",
  "AS/NZS 3001": "electrical",
  "AS/NZS 3008": "electrical",
  "AS/NZS 3017": "electrical",
  "AS/NZS 3760": "electrical",
  "AS/NZS 3820": "electrical",
  "AS/NZS 4836": "electrical",
  "AS/NZS 61439": "electrical",

  // Plumbing
  "AS/NZS 3500": "plumbing",
  "AS/NZS 5601": "plumbing",
  "AS 3740": "plumbing",

  // Mechanical / HVAC
  "AS 1668": "mechanical",
  "AS/NZS 3666": "mechanical",
  "AS 5149": "mechanical",
  "AS 1100": "mechanical",
  "AS 4254": "mechanical",

  // Structural / Civil
  "AS 3600": "structural",
  "AS 4100": "structural",
  "AS 1684": "structural",
  "AS 1170": "structural",
  "AS 3700": "structural",
  "AS 4055": "structural",

  // Building / Concreting
  "AS 3610": "building",
  "AS 2870": "building",
  "AS 3798": "building",
};

/**
 * Keyword buckets for fallback detection when no standard is explicitly
 * provided. Ordered most-specific first.
 */
const TRADE_KEYWORDS: Record<TradeType, string[]> = {
  electrical: [
    "voltage", "amp", "rcd", "circuit breaker", "switchboard", "earthing",
    "bonding", "cable", "conduit", "gpo", "socket", "lighting circuit",
    "sub-main", "consumer mains", "isolation", "wiring", "mcb", "rcbo",
  ],
  plumbing: [
    "pipe", "drain", "sewer", "hot water", "cold water", "tempering",
    "backflow", "gas", "stopcock", "trap", "vent", "grease", "greywater",
    "stormwater", "potable", "rainwater", "pressure test",
  ],
  mechanical: [
    "hvac", "ventilation", "duct", "air handling", "cooling tower",
    "refrigerant", "fire damper", "airflow", "outdoor air", "chiller",
    "heat pump", "ahu", "fcu", "l/s", "outdoor rate",
  ],
  structural: [
    "load bearing", "beam", "column", "joist", "span", "steel section",
    "reinforcement", "rebar", "tie-down", "wind load", "dead load",
    "live load", "mgp", "lvl", "bracing", "shear", "moment",
  ],
  building: [
    "formwork", "slab", "footing", "concrete pour", "slump", "mpa",
    "curing", "cover", "soil class", "waffle pod", "raft slab",
    "strip footing", "bored pier", "reinforced slab",
  ],
  general: [],
};

/**
 * Detect which trade a query belongs to.
 *
 * @param query — The user's question text
 * @param standardId — Optional ID/name of the standard they're searching
 * @param standardName — Optional human-readable name like "AS/NZS 3000"
 * @returns A TradeType value — defaults to 'general' if nothing matches
 */
export function detectTrade(
  query: string,
  standardName?: string | null
): TradeType {
  // 1. If we have a standard name, use it directly
  if (standardName) {
    const normalized = standardName.trim().toUpperCase();
    for (const [prefix, trade] of Object.entries(STANDARD_TO_TRADE)) {
      if (normalized.startsWith(prefix.toUpperCase())) {
        return trade;
      }
    }
  }

  // 2. Keyword matching on the query
  const lowerQuery = query.toLowerCase();
  const tradeScores: Record<TradeType, number> = {
    electrical: 0,
    plumbing: 0,
    mechanical: 0,
    structural: 0,
    building: 0,
    general: 0,
  };

  for (const [trade, keywords] of Object.entries(TRADE_KEYWORDS)) {
    for (const keyword of keywords) {
      if (lowerQuery.includes(keyword)) {
        tradeScores[trade as TradeType] += 1;
      }
    }
  }

  // Find the highest scoring trade
  let bestTrade: TradeType = "general";
  let bestScore = 0;
  for (const [trade, score] of Object.entries(tradeScores)) {
    if (score > bestScore) {
      bestScore = score;
      bestTrade = trade as TradeType;
    }
  }

  // 3. Fallback to general if no keywords matched
  return bestScore > 0 ? bestTrade : "general";
}
