import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Cost logging for every AI call in the app, separate from ai_usage (which
// only counts calls for rate-limiting — see 20260704000003_atomic_ai_rate_limit.sql).
// Writes to token_usage (20260807010000_token_usage_tracking.sql) so
// "how much is this costing us, and who" is answerable without manual
// token-math against the Anthropic/OpenAI consoles.
//
// Prices are USD per 1M tokens, current as of 2026-08. They're baked in here
// rather than looked up per-call so historical rows stay accurate even if
// prices change later — update this table and only new rows use the new
// numbers.
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "text-embedding-3-small": { input: 0.02, output: 0 },
};

// Anthropic prompt-caching multipliers (5-minute TTL, the default used
// everywhere in this codebase — see ocr.ts's cache_control: ephemeral).
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;
// The Batch API (describe-figures) is a flat 50% off both directions.
const BATCH_MULTIPLIER = 0.5;

export interface NormalizedUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens?: number;
  cache_creation_tokens?: number;
}

export interface LogUsageParams {
  userId: string | null | undefined;
  kind: string;
  model: string;
  usage: NormalizedUsage;
  isBatch?: boolean;
  refId?: string;
}

function estimateCostUsd(model: string, usage: NormalizedUsage, isBatch: boolean): number {
  const price = PRICING[model];
  if (!price) {
    console.warn(`[log-usage] No pricing entry for model "${model}" — logging 0 cost`);
    return 0;
  }
  const batchDiscount = isBatch ? BATCH_MULTIPLIER : 1;
  const inputCost = (usage.input_tokens / 1_000_000) * price.input * batchDiscount;
  const outputCost = (usage.output_tokens / 1_000_000) * price.output * batchDiscount;
  const cacheWriteCost = ((usage.cache_creation_tokens ?? 0) / 1_000_000) * price.input * CACHE_WRITE_MULTIPLIER * batchDiscount;
  const cacheReadCost = ((usage.cache_read_tokens ?? 0) / 1_000_000) * price.input * CACHE_READ_MULTIPLIER * batchDiscount;
  return inputCost + outputCost + cacheWriteCost + cacheReadCost;
}

// Fire-and-forget by design — a logging failure must never break the AI
// feature that triggered it. Callers can `await` this (it resolves quickly,
// it's just one insert) but should never let a rejection propagate.
export async function logTokenUsage(supabaseAdmin: SupabaseClient, params: LogUsageParams): Promise<void> {
  try {
    const cost = estimateCostUsd(params.model, params.usage, params.isBatch ?? false);
    const { error } = await supabaseAdmin.from("token_usage").insert({
      user_id: params.userId ?? null,
      kind: params.kind,
      model: params.model,
      input_tokens: params.usage.input_tokens,
      output_tokens: params.usage.output_tokens,
      cache_read_tokens: params.usage.cache_read_tokens ?? 0,
      cache_creation_tokens: params.usage.cache_creation_tokens ?? 0,
      estimated_cost_usd: cost,
      ref_id: params.refId ?? null,
    });
    if (error) console.error("[log-usage] insert failed:", error);
  } catch (e) {
    console.error("[log-usage] unexpected error:", e);
  }
}
