#!/usr/bin/env node
/**
 * StandAId — One-off backfill for standard_chunks.chunk_type / is_normative
 *
 * Migration 20260803000000_normative_tagging.sql adds nullable chunk_type/
 * is_normative columns. From that point on, brand-new standards get them
 * tagged at chunk-creation time (supabase/functions/process-standard/
 * extraction.ts — see tagClauseNormativity() and chunkSections()). Rows
 * written BEFORE the migration stay NULL forever unless backfilled.
 *
 * This script re-derives the tags for existing rows using PURE REGEX over
 * the already-stored clause_number/clause_title/content columns — no AI
 * calls, no re-embedding. It intentionally does NOT try to perfectly
 * reproduce the live tagger: some of that logic depends on document
 * structure only available at parse time (walking the whole document
 * top-to-bottom tracking which section is inside an APPENDIX and whether
 * that appendix is "(Informative)" or "(Normative)" — see Section.inAppendix/
 * appendixNormative in extraction.ts). A single stored row has none of that
 * sibling context. Where the live logic cannot be reconstructed reliably
 * from a single row, this script leaves is_normative NULL rather than
 * guessing. See the RELIABILITY NOTES block below and the final report this
 * script prints.
 *
 * ── RELIABILITY NOTES (read before running --apply) ─────────────────────
 *
 * 100% reliable (same signal the live code uses, just replayed):
 *   - table    — clause_number always stored as "TABLE <num>" verbatim
 *                (see extractTableChunks in extraction.ts). is_normative
 *                is always null in the live code too ("a table's force
 *                comes from the clause invoking it").
 *   - figure   — clause_number always stored as "FIGURE <num>" verbatim.
 *                is_normative always null in the live code too.
 *   - map      — clause_title is the fixed constant "Document map —
 *                sections and contents" (buildDocumentMapChunk). is_normative
 *                always false in the live code too.
 *   - definition — same predicate as the live code: clause_title contains
 *                "definition" (case-insensitive) OR clause_number starts
 *                with "1.4". is_normative always false in the live code too.
 *   - note     — same predicate as the live code: the chunk's own text
 *                (breadcrumb stripped) starts with NOTE/NOTES. is_normative
 *                always false in the live code too.
 *   - clause (the default bucket) — tagClauseNormativity() copied verbatim
 *                (must stay in sync with extraction.ts — see the copy
 *                below), applied to each row's own content.
 *
 * NOT reliable — inherent ambiguity, documented rather than guessed:
 *   - appendix — the live code's chunk_type comes from Section.inAppendix,
 *                which this script cannot see directly. It approximates
 *                "inAppendix" by shape-matching clause_number against the
 *                letter-prefixed pattern appendix clauses use (e.g. "B1",
 *                "C2.1"). This is NOT airtight: NCC legacy clauses (e.g.
 *                "P2.3.1") have the exact same shape and are NOT appendix
 *                content in the live code — they're ordinary "clause" rows.
 *                A row like "P2.3.1" is genuinely ambiguous from the stored
 *                columns alone (could be a real NCC clause OR a real
 *                Appendix P sub-clause — AS/NZS 3000 has both). This script
 *                tags shape-matching rows as 'appendix' (matching the
 *                brief), but Kyle should spot-check P/O/V-prefixed rows
 *                after running against a document that mixes NCC and
 *                appendix content.
 *              - is_normative for appendix rows: the "(Informative)"/
 *                "(Normative)" marker lives on the APPENDIX HEADING chunk
 *                (a sibling row), not on every clause inside it — the live
 *                code resolves it once while walking the doc and carries it
 *                forward. A single clause row almost never repeats that
 *                marker in its own content. This script searches the row's
 *                own content for the marker and uses it if found, but in
 *                practice EXPECT MOST appendix rows to land on is_normative
 *                = NULL. That is the honest, undeterminable-from-this-row
 *                answer, not a bug.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────
 *   node scripts/backfill-chunk-tags.mjs               # dry run (default)
 *   node scripts/backfill-chunk-tags.mjs --apply        # actually writes
 *
 * Env (same convention as the Supabase edge functions — never hardcode a
 * service-role key):
 *   SUPABASE_URL                (optional — defaults to the project URL,
 *                                 not a secret)
 *   SUPABASE_SERVICE_ROLE_KEY   (required for --apply and for a dry run
 *                                 against the real DB; RLS would otherwise
 *                                 hide most rows from a plain anon client)
 */

import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";

// ── Copied verbatim from supabase/functions/process-standard/extraction.ts
// (tagClauseNormativity). MUST STAY IN SYNC — if that function changes,
// update this copy too. Not imported directly because extraction.ts is a
// TypeScript module meant for Deno/vitest, and this is a plain Node script
// run standalone by Kyle with no build step.
export function tagClauseNormativity(text) {
  if (/\bshall\b/i.test(text)) return true;
  if (/\bshould\b/i.test(text) || /\bNOTES?\b/.test(text)) return false;
  return null;
}

// Breadcrumb prepended by buildBreadcrumb() in extraction.ts:
//   `[${standardCode}${version ? " " + version : ""}]${clausePart ? " " + clausePart : ""}\n\n`
// Always "[...]" then optional " Clause X: Title" or a bare title, then a
// blank line before the real chunk text. Strip it so NOTE-prefix checks
// look at the actual content, same as the live code sees pre-breadcrumb.
const BREADCRUMB = /^\[[^\]]*\][^\n]*\n\n/;
export function stripBreadcrumb(content) {
  return (content || "").replace(BREADCRUMB, "");
}

// Shape used by APPENDIX_CLAUSE_PATTERN in extraction.ts for clause numbers
// inside an appendix ("B1", "C2.1"). Deliberately loose (matches the brief) —
// see the appendix reliability note above for why this can misfire on NCC
// legacy clause numbers ("P2.3.1") that share the same shape.
const APPENDIX_SHAPE = /^[A-Z]\d{1,2}(?:\.\d{1,2}){0,4}$/;

// Best-effort recovery of an appendix's own "(Informative)"/"(Normative)"
// marker from a single row's content — see reliability notes: this only
// ever fires for the rare row that still carries the marker text itself
// (typically the appendix's own heading chunk), not for ordinary clauses
// inside it.
function findAppendixMarker(strippedContent) {
  for (const rawLine of strippedContent.split("\n")) {
    const line = rawLine.trim();
    if (/^\(?\s*INFORMATIVE\s*\)?$/i.test(line)) return false;
    if (/^\(?\s*NORMATIVE\s*\)?$/i.test(line)) return true;
  }
  // Marker sometimes rides on the same line as other text (e.g. the heading
  // line itself) — informative checked first, mirroring extraction.ts.
  if (/\bINFORMATIVE\b/i.test(strippedContent)) return false;
  if (/\bNORMATIVE\b/i.test(strippedContent)) return true;
  return null;
}

// The exact clause_title buildDocumentMapChunk() writes — a fixed constant,
// not a pattern, so an exact match is 100% reliable.
const MAP_TITLE = "Document map — sections and contents";

/**
 * Classify one existing standard_chunks row using only its own stored
 * columns. Returns { chunk_type, is_normative, reason } — reason is a short
 * label used only for the dry-run/sample report, never written to the DB.
 */
export function classifyChunk(row) {
  const clauseNumber = (row.clause_number || "").trim();
  const clauseTitle = (row.clause_title || "").trim();
  const content = row.content || "";

  if (/^TABLE /.test(clauseNumber)) {
    return { chunk_type: "table", is_normative: null, reason: "clause_number starts with 'TABLE '" };
  }
  if (/^FIGURE /.test(clauseNumber)) {
    return { chunk_type: "figure", is_normative: null, reason: "clause_number starts with 'FIGURE '" };
  }
  if (!row.clause_number && clauseTitle === MAP_TITLE) {
    return { chunk_type: "map", is_normative: false, reason: "clause_title matches document-map constant" };
  }

  const isDefinition = /definition/i.test(clauseTitle) || clauseNumber.startsWith("1.4");
  if (isDefinition) {
    return { chunk_type: "definition", is_normative: false, reason: "title contains 'definition' or clause 1.4.x" };
  }

  if (APPENDIX_SHAPE.test(clauseNumber)) {
    const stripped = stripBreadcrumb(content);
    const marker = findAppendixMarker(stripped);
    return {
      chunk_type: "appendix",
      is_normative: marker,
      reason: marker === null
        ? "letter-prefixed clause number; no (Informative)/(Normative) marker in this row's own content — undeterminable"
        : "letter-prefixed clause number; marker found in this row's own content",
    };
  }

  const stripped = stripBreadcrumb(content);
  if (/^NOTES?\b/.test(stripped)) {
    return { chunk_type: "note", is_normative: false, reason: "content starts with NOTE/NOTES" };
  }

  return { chunk_type: "clause", is_normative: tagClauseNormativity(content), reason: "default clause bucket" };
}

// ── CLI runner (only executes when this file is run directly, not on import) ──

const SUPABASE_URL = process.env.SUPABASE_URL || "https://wyxeqkgpwkcckyntqcns.supabase.co";
const PAGE_SIZE = 500; // matches the batch caution already in this codebase
                         // (see 20260720020000_cap_chunk_retry_attempts.sql —
                         // this app never fires unbounded bulk operations at
                         // standard_chunks)
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

function emptySummary() {
  return {
    processed: 0,
    errored: 0,
    byType: {}, // chunk_type -> count (clause/appendix further split by is_normative below)
    byNormative: {}, // `${chunk_type}:${is_normative}` -> count
    samples: {}, // chunk_type -> [{id, clause_number, clause_title, is_normative, reason, snippet}]
  };
}

function recordSample(summary, chunkType, row, classification) {
  const list = summary.samples[chunkType] || (summary.samples[chunkType] = []);
  if (list.length < 3) {
    list.push({
      id: row.id,
      clause_number: row.clause_number,
      clause_title: row.clause_title,
      is_normative: classification.is_normative,
      reason: classification.reason,
      snippet: (row.content || "").slice(0, 120).replace(/\n/g, " "),
    });
  }
}

function tally(summary, row, classification) {
  summary.processed++;
  summary.byType[classification.chunk_type] = (summary.byType[classification.chunk_type] || 0) + 1;
  const key = `${classification.chunk_type}:${classification.is_normative}`;
  summary.byNormative[key] = (summary.byNormative[key] || 0) + 1;
  recordSample(summary, classification.chunk_type, row, classification);
}

async function withRetry(fn, label) {
  let lastErr;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      console.warn(`  ! ${label} failed (attempt ${attempt}/${RETRY_ATTEMPTS}): ${err.message}`);
      if (attempt < RETRY_ATTEMPTS) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }
  throw lastErr;
}

async function applyUpdates(supabase, rows, classifications, summary) {
  // Group by (chunk_type, is_normative) so each group is one UPDATE ... IN (...)
  // rather than one UPDATE per row.
  const groups = new Map(); // key -> { chunk_type, is_normative, ids: [] }
  rows.forEach((row, i) => {
    const c = classifications[i];
    const key = `${c.chunk_type}:${c.is_normative}`;
    if (!groups.has(key)) groups.set(key, { chunk_type: c.chunk_type, is_normative: c.is_normative, ids: [] });
    groups.get(key).ids.push(row.id);
  });

  for (const { chunk_type, is_normative, ids } of groups.values()) {
    try {
      await withRetry(
        () =>
          supabase
            .from("standard_chunks")
            .update({ chunk_type, is_normative })
            .in("id", ids)
            .is("chunk_type", null) // never re-tag an already-tagged row
            .then(({ error }) => {
              if (error) throw new Error(error.message);
            }),
        `update ${ids.length} row(s) -> ${chunk_type}/${is_normative}`
      );
    } catch (err) {
      console.error(`  ✗ giving up on ${ids.length} row(s) (${chunk_type}/${is_normative}): ${err.message}`);
      summary.errored += ids.length;
    }
  }
}

async function fetchPage(supabase, cursor) {
  let query = supabase
    .from("standard_chunks")
    .select("id, clause_number, clause_title, content")
    .is("chunk_type", null)
    .order("id", { ascending: true })
    .limit(PAGE_SIZE);
  if (cursor) query = query.gt("id", cursor);
  return withRetry(
    () => query.then(({ data, error }) => { if (error) throw new Error(error.message); return data; }),
    "fetch page"
  );
}

function printSummary(summary, apply) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(apply ? "APPLY RUN COMPLETE" : "DRY RUN COMPLETE (no rows written — pass --apply to write)");
  console.log("─".repeat(60));
  console.log(`Total rows processed: ${summary.processed}`);
  console.log(`Rows errored:         ${summary.errored}`);
  console.log(`\nCounts by chunk_type:`);
  for (const [type, count] of Object.entries(summary.byType).sort()) {
    console.log(`  ${type.padEnd(12)} ${count}`);
  }
  console.log(`\nCounts by chunk_type / is_normative:`);
  for (const [key, count] of Object.entries(summary.byNormative).sort()) {
    console.log(`  ${key.padEnd(22)} ${count}`);
  }
  for (const [type, samples] of Object.entries(summary.samples)) {
    console.log(`\nSample '${type}' rows:`);
    for (const s of samples) {
      console.log(`  id=${s.id} clause_number=${JSON.stringify(s.clause_number)} is_normative=${s.is_normative}`);
      console.log(`    reason: ${s.reason}`);
      console.log(`    text:   "${s.snippet}..."`);
    }
  }
  console.log("");
}

async function main() {
  const apply = process.argv.includes("--apply");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    console.error("Set SUPABASE_SERVICE_ROLE_KEY (service-role key, never the anon key — RLS would hide other users' rows).");
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, serviceRoleKey, { auth: { persistSession: false } });
  console.log(apply ? "Running in APPLY mode — this WILL write to standard_chunks.\n" : "Running in DRY RUN mode — no writes will be made.\n");

  const summary = emptySummary();
  let cursor = null;
  let page = 0;

  for (;;) {
    const rows = await fetchPage(supabase, cursor);
    if (!rows || rows.length === 0) break;
    page++;
    const classifications = rows.map(classifyChunk);
    rows.forEach((row, i) => tally(summary, row, classifications[i]));

    if (apply) {
      await applyUpdates(supabase, rows, classifications, summary);
    }

    console.log(`Page ${page}: ${rows.length} row(s) processed (running total ${summary.processed})`);
    cursor = rows[rows.length - 1].id;

    // In dry-run mode nothing is written, so chunk_type IS NULL never
    // shrinks — the cursor advance above is what moves us to the next page.
    // In apply mode rows just written also drop out of future WHERE
    // chunk_type IS NULL pages, but the cursor still advances correctly
    // either way.
    if (rows.length < PAGE_SIZE) break;
  }

  printSummary(summary, apply);
  process.exit(summary.errored > 0 ? 1 : 0);
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
