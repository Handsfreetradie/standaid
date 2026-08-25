#!/usr/bin/env node
/**
 * StandAId — List every standard still marked extraction_status =
 * 'ai_disabled' after 20260825010000_restore_ai_on_disabled_standards.sql
 * runs, and let Kyle reprocess the ones that need it.
 *
 * That migration already restores every standard that had chunks when it
 * was disabled (soft-disabled by 20260820000001_disable_ai_on_existing_sa_
 * standards.sql — nothing was ever deleted, just is_indexed = false, so the
 * migration flips it back for free). Anything still ai_disabled after that
 * migration has run has zero chunks — it was blocked by the old
 * isAiAllowed gate in upload-standard/index.ts (removed 2026-08-25) before
 * extraction ever ran, so there's nothing to flip. It needs a real
 * reprocess from the stored PDF via reprocess-standard, which costs real
 * OCR/vision spend for scanned documents.
 *
 * READ-ONLY by default. Only changes anything with --trigger <id>, one
 * standard at a time — same convention as list-stale-standards.mjs.
 *
 * ── Usage ────────────────────────────────────────────────────────────────
 *   node scripts/restore-ai-disabled-standards.mjs                  # list only
 *   node scripts/restore-ai-disabled-standards.mjs --trigger <id>   # reprocess ONE standard
 *
 * Env:
 *   SUPABASE_URL                (optional — defaults to the project URL)
 *   SUPABASE_SERVICE_ROLE_KEY   (required)
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://wyxeqkgpwkcckyntqcns.supabase.co";
const PAGE_SIZE = 500;

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
  console.log(`\nStandards still ai_disabled (zero chunks, need a reprocess): ${rows.length}\n`);
  if (rows.length === 0) {
    console.log("Nothing left to restore.\n");
    return;
  }
  console.log("id".padEnd(38), "code/title");
  console.log("-".repeat(38), "-".repeat(40));
  for (const r of rows) {
    console.log(r.id.padEnd(38), (r.standard_code || r.title || "").slice(0, 60));
  }
  console.log("");
}

async function triggerReprocess(standardId, serviceRoleKey) {
  const url = `${SUPABASE_URL}/functions/v1/reprocess-standard`;
  console.log(`\nCalling reprocess-standard for ${standardId} ...`);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
    body: JSON.stringify({ standard_id: standardId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`FAILED (${res.status}):`, body);
    process.exit(1);
  }
  console.log("OK:", body);
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
  if (rows.length === 0) return;

  const triggerIdx = process.argv.indexOf("--trigger");
  if (triggerIdx !== -1) {
    const id = process.argv[triggerIdx + 1];
    if (!id) {
      console.error("Usage: --trigger <standard_id>");
      process.exit(1);
    }
    if (!rows.some((r) => r.id === id)) {
      console.error(`${id} isn't in the ai_disabled list above.`);
      process.exit(1);
    }
    await triggerReprocess(id, serviceRoleKey);
    return;
  }

  console.log("Re-run with --trigger <id> to reprocess one standard (paid OCR/vision spend for scanned documents).\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
