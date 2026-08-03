#!/usr/bin/env node
/**
 * StandAId — List standards processed by an older chunking/extraction/
 * tagging pipeline than the current one (standards.pipeline_version <
 * PIPELINE_VERSION), so Kyle can see the blast radius — count + which
 * standards, and whether any of them are scanned (re-extracting those
 * re-runs paid OCR/vision, same as the original upload) — BEFORE calling
 * reprocess-standard on any of them.
 *
 * This script is READ-ONLY by default. Reprocessing a standard costs real
 * API spend for scanned documents (unpdf-extracted digital PDFs are free —
 * see extraction_quality_score below as a rough signal, and any standard
 * that needed AI OCR on first upload will need it again since there is no
 * persisted extracted-text artifact to reuse — see reprocess-standard's
 * README comment for why). Never pass --trigger without having read the
 * listing and confirmed the cost with Kyle first.
 *
 * ── Usage ────────────────────────────────────────────────────────────────
 *   node scripts/list-stale-standards.mjs                    # list only
 *   node scripts/list-stale-standards.mjs --trigger <id>     # reprocess ONE
 *                                                             # standard by id
 *                                                             # (calls the
 *                                                             # deployed
 *                                                             # reprocess-standard
 *                                                             # function)
 *
 * Env (same convention as scripts/backfill-chunk-tags.mjs):
 *   SUPABASE_URL                (optional — defaults to the project URL)
 *   SUPABASE_SERVICE_ROLE_KEY   (required)
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://wyxeqkgpwkcckyntqcns.supabase.co";
const PAGE_SIZE = 500; // same batch caution as backfill-chunk-tags.mjs

// Read PIPELINE_VERSION straight out of extraction.ts rather than keeping a
// second hardcoded copy that can silently drift out of sync.
function readPipelineVersion() {
  const here = dirname(fileURLToPath(import.meta.url));
  const extractionPath = join(here, "..", "supabase", "functions", "process-standard", "extraction.ts");
  const source = readFileSync(extractionPath, "utf8");
  const m = source.match(/export const PIPELINE_VERSION = (\d+);/);
  if (!m) throw new Error(`Could not find "export const PIPELINE_VERSION = N;" in ${extractionPath}`);
  return parseInt(m[1], 10);
}

async function fetchStalePage(supabase, currentVersion, cursor) {
  let query = supabase
    .from("standards")
    .select("id, title, standard_code, version, user_id, pipeline_version, extraction_status, extraction_quality_score, total_chunks, created_at")
    .lt("pipeline_version", currentVersion)
    .order("id", { ascending: true })
    .limit(PAGE_SIZE);
  if (cursor) query = query.gt("id", cursor);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

async function listStale(supabase, currentVersion) {
  const rows = [];
  let cursor = null;
  for (;;) {
    const page = await fetchStalePage(supabase, currentVersion, cursor);
    if (!page || page.length === 0) break;
    rows.push(...page);
    cursor = page[page.length - 1].id;
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

function printListing(rows, currentVersion) {
  console.log(`\nPIPELINE_VERSION (current) = ${currentVersion}`);
  console.log(`Stale standards (pipeline_version < ${currentVersion}): ${rows.length}\n`);
  if (rows.length === 0) {
    console.log("Nothing to reprocess.\n");
    return;
  }

  // Quality score < 70 is the rough signal used elsewhere in this codebase
  // (process-standard/index.ts's own quality gate rejects below 35) for
  // "this document likely needed AI OCR rather than a clean digital
  // extraction" — surfaced here so Kyle can see which reprocess calls are
  // likely to spend AI OCR credit, not just cheap OpenAI embedding cost.
  const likelyScanned = rows.filter(r => (r.extraction_quality_score ?? 100) < 70);

  console.log(`  of which likely scanned (extraction_quality_score < 70, re-extraction probably re-runs OCR): ${likelyScanned.length}\n`);

  console.log("id".padEnd(38), "code/title".padEnd(40), "pv".padEnd(4), "status".padEnd(11), "quality".padEnd(8), "chunks");
  console.log("-".repeat(38), "-".repeat(40), "-".repeat(4), "-".repeat(11), "-".repeat(8), "------");
  for (const r of rows) {
    const label = (r.standard_code || r.title || "").slice(0, 40);
    console.log(
      r.id.padEnd(38),
      label.padEnd(40),
      String(r.pipeline_version).padEnd(4),
      (r.extraction_status || "").padEnd(11),
      String(r.extraction_quality_score ?? "?").padEnd(8),
      r.total_chunks ?? "?",
    );
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

  const currentVersion = readPipelineVersion();
  const supabase = createClient(SUPABASE_URL, serviceRoleKey, { auth: { persistSession: false } });

  const rows = await listStale(supabase, currentVersion);
  printListing(rows, currentVersion);

  const triggerIdx = process.argv.indexOf("--trigger");
  if (triggerIdx !== -1) {
    const standardId = process.argv[triggerIdx + 1];
    if (!standardId) {
      console.error("--trigger requires a standard_id argument");
      process.exit(1);
    }
    if (!rows.some(r => r.id === standardId)) {
      console.error(`${standardId} is not in the stale listing above (already current, or doesn't exist) — refusing to trigger.`);
      process.exit(1);
    }
    await triggerReprocess(standardId, serviceRoleKey);
  }
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
