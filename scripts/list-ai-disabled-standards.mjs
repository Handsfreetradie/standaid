#!/usr/bin/env node
/**
 * StandAId — List every standard currently marked extraction_status =
 * 'ai_disabled', and flag which ones would now pass the AI-eligibility
 * check under today's deny-list rule (supabase/functions/_shared/
 * standard-licence.ts) using their EXISTING title/standard_code — i.e.
 * standards that got blocked under the old NCC/BCA-only allow-list but
 * aren't actually AS/AS-NZS/NZS content, so the new rule would now let
 * them through.
 *
 * READ-ONLY. Does not change anything or call any AI/reprocess endpoint.
 * This is step 1 (see the list) before deciding what to unblock — see
 * scripts/list-stale-standards.mjs for the --trigger pattern this will
 * follow once Kyle has reviewed the list and confirmed the cost.
 *
 * The pattern below is copied from SA_STANDARD_PATTERN in
 * supabase/functions/_shared/standard-licence.ts — keep the two in sync if
 * that file changes.
 *
 * ── Usage ────────────────────────────────────────────────────────────────
 *   node scripts/list-ai-disabled-standards.mjs
 *
 * Env:
 *   SUPABASE_URL                (optional — defaults to the project URL)
 *   SUPABASE_SERVICE_ROLE_KEY   (required)
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://wyxeqkgpwkcckyntqcns.supabase.co";
const PAGE_SIZE = 500;

const SA_STANDARD_PATTERN = new RegExp(
  [
    String.raw`\bAS\s*[\/\-]?\s*NZS?\b`,
    String.raw`\bNZS?\s*\d{2,10}(?:\.\d+)?\b`,
    String.raw`\bAS\s*\d{2,10}(?:\.\d+)?\b`,
    String.raw`australian\s*\/\s*new\s*zealand\s+standard`,
    String.raw`\baustralian\s+standard\b`,
    String.raw`\bnew\s+zealand\s+standard\b`,
    String.raw`standards\s+australia`,
    String.raw`standards\s+new\s+zealand`,
  ].join("|"),
  "i",
);

function isAiAllowed(standardCode, title) {
  const text = `${standardCode ?? ""} ${title ?? ""}`;
  return !SA_STANDARD_PATTERN.test(text);
}

async function fetchDisabledPage(supabase, cursor) {
  let query = supabase
    .from("standards")
    .select("id, title, standard_code, version, user_id, extraction_status, extraction_quality_score, total_chunks, created_at")
    .eq("extraction_status", "ai_disabled")
    .order("id", { ascending: true })
    .limit(PAGE_SIZE);
  if (cursor) query = query.gt("id", cursor);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

async function listDisabled(supabase) {
  const rows = [];
  let cursor = null;
  for (;;) {
    const page = await fetchDisabledPage(supabase, cursor);
    if (!page || page.length === 0) break;
    rows.push(...page);
    cursor = page[page.length - 1].id;
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

function printListing(rows) {
  console.log(`\nStandards marked ai_disabled: ${rows.length}\n`);
  if (rows.length === 0) {
    console.log("Nothing blocked right now.\n");
    return;
  }

  const newlyEligible = rows.filter((r) => isAiAllowed(r.standard_code, r.title));
  const stillBlocked = rows.filter((r) => !isAiAllowed(r.standard_code, r.title));

  console.log(`  now eligible under today's deny-list rule (likely mislabelled under the old rule): ${newlyEligible.length}`);
  console.log(`  still correctly blocked (looks like real AS/AS-NZS/NZS content): ${stillBlocked.length}\n`);

  const likelyScanned = newlyEligible.filter((r) => (r.extraction_quality_score ?? 100) < 70);
  console.log(`  of the newly-eligible ones, likely scanned (extraction_quality_score < 70 — reprocessing would re-run paid OCR): ${likelyScanned.length}\n`);

  console.log("NOW ELIGIBLE — review these before unblocking anything:");
  console.log("id".padEnd(38), "code/title".padEnd(40), "quality".padEnd(8), "chunks");
  console.log("-".repeat(38), "-".repeat(40), "-".repeat(8), "------");
  for (const r of newlyEligible) {
    const label = (r.standard_code || r.title || "").slice(0, 40);
    console.log(r.id.padEnd(38), label.padEnd(40), String(r.extraction_quality_score ?? "?").padEnd(8), r.total_chunks ?? "?");
  }

  console.log("\nSTILL BLOCKED (genuine AS/AS-NZS/NZS, correctly locked):");
  for (const r of stillBlocked) {
    console.log(" -", (r.standard_code || r.title || "").slice(0, 60));
  }
  console.log("");
}

async function main() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    console.error("Set SUPABASE_SERVICE_ROLE_KEY (service-role key, never the anon key — RLS would hide other users' rows).");
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, serviceRoleKey, { auth: { persistSession: false } });
  const rows = await listDisabled(supabase);
  printListing(rows);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
