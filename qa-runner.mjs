/**
 * StandAId — Generic RAG Eval Runner
 *
 * Runs any eval file (a JSON array of questions with ground-truth answers)
 * against the live `query` edge function and scores the responses, catching
 * hallucinations precisely. Replaces the per-standard one-off scripts with a
 * single runner you point at a question set.
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=xxx node qa-runner.mjs evals/as3008.json
 *   SUPABASE_EMAIL=you@x.com SUPABASE_PASSWORD=pw node qa-runner.mjs evals/as3000.json
 *   node qa-runner.mjs evals/*.json          # run several sets in one go
 *
 * Eval file format — a JSON array of:
 *   {
 *     "id": 1,
 *     "text": "the tradie's question",
 *     "description": "short label for the console",
 *     "correct_values": ["strings, one of which MUST appear"],
 *     "wrong_values":   ["strings that indicate a hallucination"],
 *     "clause_hints":   ["clause numbers the AI should cite"],  // optional
 *     "safety": false                                            // optional
 *   }
 *
 * A question about a standard the user hasn't uploaded should make the AI
 * decline — that counts as a PASS (no hallucination), UNLESS the decline still
 * smuggles in a wrong value.
 */

import { readFileSync } from "node:fs";

const SUPABASE_URL = "https://wyxeqkgpwkcckyntqcns.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind5eGVxa2dwd2tjY2t5bnRxY25zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMzc4NzUsImV4cCI6MjA4OTgxMzg3NX0.vA_ZhRkgmrOgTIwT4_C-tEEQ81Mf4AvuyTD9Yety2Ao";
const QUERY_URL = `${SUPABASE_URL}/functions/v1/query`;

// ─── Auth ─────────────────────────────────────────────────────────────────────
async function signIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Auth failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  if (!data.access_token) throw new Error("No access token in auth response");
  return data.access_token;
}

// ─── Query ────────────────────────────────────────────────────────────────────
async function queryAI(question, token) {
  const res = await fetch(QUERY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
    body: JSON.stringify({ question, conversation_history: [] }),
  });
  if (!res.ok) throw new Error(`Query failed: ${res.status}`);
  const contentType = res.headers.get("content-type") || "";
  return contentType.includes("text/event-stream") ? await consumeSSE(res) : await res.json();
}

async function consumeSSE(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalData = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (raw === "[DONE]") continue;
      try {
        const parsed = JSON.parse(raw);
        if (parsed.done || parsed.answer) finalData = parsed;
      } catch {}
    }
  }
  return finalData || {};
}

// ─── Validate ─────────────────────────────────────────────────────────────────
function validateResponse(query, apiResponse) {
  const answer = (apiResponse.answer || apiResponse.text || "").toLowerCase();
  const issues = [];
  let pass = true;
  let verdict = "PASS";

  const noContent = answer.includes("couldn't find") ||
    answer.includes("not found") || answer.includes("not uploaded") ||
    answer.includes("not been uploaded") || answer.includes("isn't in your uploaded") ||
    answer.includes("general knowledge (not from your uploaded") ||
    apiResponse.answer_found === false;

  if (noContent) {
    for (const bad of query.wrong_values || []) {
      if (answer.includes(bad.toLowerCase())) {
        return { pass: false, verdict: "FAIL (declined but stated a wrong value)",
          issues: [`FAIL: Decline contains "${bad}"`], answer_snippet: answer.slice(0, 120) };
      }
    }
    return { pass: true, verdict: "PASS (correctly declined — standard not in context)",
      issues: [], answer_snippet: answer.slice(0, 120) };
  }

  const correct = query.correct_values || [];
  const hasCorrect = correct.length === 0 || correct.some((v) => answer.includes(v.toLowerCase()));
  if (!hasCorrect) {
    issues.push(`FAIL: Expected one of [${correct.join(", ")}] — not found`);
    pass = false;
  }
  for (const bad of query.wrong_values || []) {
    if (answer.includes(bad.toLowerCase())) {
      issues.push(`FAIL: Hallucination — answer contains "${bad}"`);
      pass = false;
    }
  }

  const clauseRegex = /(?:clause|section|figure|table)\s+\d+(?:\.\d+)*/gi;
  const inlineCitations = answer.match(clauseRegex) ?? [];
  const metaCitations = Array.isArray(apiResponse.citations)
    ? apiResponse.citations.filter((c) => c && (c.clause_number || c.standard_code)).length : 0;
  if (inlineCitations.length === 0 && metaCitations === 0) {
    issues.push("NEEDS REVIEW: No clause reference in answer or citations metadata");
    if (verdict === "PASS") verdict = "NEEDS REVIEW";
  }

  const hasSafetyWarning = answer.includes("⚠") || answer.includes("warning") ||
    answer.includes("safety") || answer.includes("danger") || answer.includes("risk");
  if (query.safety && !hasSafetyWarning) {
    issues.push("NEEDS REVIEW: Safety-critical question — no safety warning");
    if (verdict === "PASS") verdict = "NEEDS REVIEW";
  }
  if (apiResponse.needs_review) {
    issues.push("NEEDS REVIEW: API flagged needs_review — inspect citation grounding");
    if (verdict === "PASS") verdict = "NEEDS REVIEW";
  }

  if (!pass) verdict = "FAIL";
  else if (issues.length > 0 && verdict === "PASS") verdict = "NEEDS REVIEW";
  return { pass, verdict, issues, answer_snippet: answer.slice(0, 200) };
}

// ─── Run one eval file ─────────────────────────────────────────────────────────
async function runEval(path, token) {
  const queries = JSON.parse(readFileSync(path, "utf8"));
  console.log(`\n📄 ${path} — ${queries.length} questions`);
  console.log("──────────────────────────────────────────");
  let passed = 0, failed = 0, needsReview = 0;
  const failures = [];

  for (const query of queries) {
    process.stdout.write(`[${query.id}] ${query.description || query.text.slice(0, 50)}... `);
    try {
      const start = Date.now();
      const response = await queryAI(query.text, token);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      const v = validateResponse(query, response);
      const icon = v.verdict.startsWith("PASS") ? "✅" : v.verdict.startsWith("NEEDS") ? "⚠️ " : "❌";
      console.log(`${icon} ${v.verdict} (${elapsed}s)`);
      for (const issue of v.issues) console.log(`     → ${issue}`);
      if (!v.verdict.startsWith("PASS")) console.log(`     Answer: "${v.answer_snippet}..."`);
      if (v.verdict.startsWith("PASS")) passed++;
      else if (v.verdict.startsWith("FAIL")) { failed++; failures.push({ query, v }); }
      else needsReview++;
    } catch (err) {
      console.log(`❌ ERROR: ${err.message}`);
      failed++;
      failures.push({ query, v: { issues: [err.message] } });
    }
    await new Promise((r) => setTimeout(r, 1500)); // avoid rate limiting
  }

  const total = queries.length;
  console.log(`\n  ✅ ${passed}  ⚠️  ${needsReview}  ❌ ${failed}   Score: ${Math.round((passed / total) * 100)}%`);
  return { path, total, passed, failed, needsReview, failures };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("Usage: node qa-runner.mjs <eval.json> [more.json ...]");
    process.exit(1);
  }
  const presetToken = process.env.SUPABASE_ACCESS_TOKEN;
  const email = process.env.SUPABASE_EMAIL;
  const password = process.env.SUPABASE_PASSWORD;
  if (!presetToken && (!email || !password)) {
    console.error("Set SUPABASE_ACCESS_TOKEN, or SUPABASE_EMAIL + SUPABASE_PASSWORD");
    process.exit(1);
  }

  console.log("🔐 Signing in...");
  const token = presetToken || await signIn(email, password);
  console.log("✅ Authenticated");

  const summaries = [];
  for (const path of files) summaries.push(await runEval(path, token));

  console.log("\n══════════════════════════════════════════");
  console.log("  OVERALL");
  console.log("══════════════════════════════════════════");
  let tPass = 0, tTotal = 0, tFail = 0;
  for (const s of summaries) {
    tPass += s.passed; tTotal += s.total; tFail += s.failed;
    console.log(`  ${s.path}: ${Math.round((s.passed / s.total) * 100)}% (${s.passed}/${s.total})`);
  }
  console.log(`  ──────────────────────────────────────`);
  console.log(`  TOTAL: ${Math.round((tPass / tTotal) * 100)}% (${tPass}/${tTotal})`);
  console.log("══════════════════════════════════════════\n");
  process.exit(tFail === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
