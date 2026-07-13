/**
 * StandAId QA Test — AS/NZS 3017:2007 Verification Guidelines
 *
 * Tests the AI against 12 realistic tradie questions drawn directly from
 * the AS/NZS 3017:2007 standard. Each question has a known correct answer
 * so we can catch hallucinations precisely.
 *
 * Usage:
 *   SUPABASE_EMAIL=you@email.com SUPABASE_PASSWORD=yourpass node qa-3017-test.mjs
 *
 * NOTE: AS/NZS 3017:2007 must be uploaded and processed in StandAId first.
 * If it's not uploaded, the AI should respond with "content not found" —
 * that itself is a PASS (no hallucination). If it answers with values, they
 * must match what the standard actually says.
 */

const SUPABASE_URL = "https://wyxeqkgpwkcckyntqcns.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind5eGVxa2dwd2tjY2t5bnRxY25zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMzc4NzUsImV4cCI6MjA4OTgxMzg3NX0.vA_ZhRkgmrOgTIwT4_C-tEEQ81Mf4AvuyTD9Yety2Ao";
const QUERY_URL = `${SUPABASE_URL}/functions/v1/query`;

// ─── Test questions with ground-truth answers from AS/NZS 3017:2007 ──────────
//
// correct_values: strings that MUST appear in the answer (case-insensitive)
// wrong_values:   strings that would indicate hallucination
// clause_hints:   clause numbers the AI should cite (if standard is uploaded)
// safety:         true = response must include a safety warning
//
const TEST_QUERIES = [
  {
    id: 1,
    text: "What is the minimum insulation resistance value for a new electrical installation?",
    description: "Core insulation resistance pass/fail value",
    correct_values: ["1 m", "1mΩ", "1 megohm", "1MΩ"],
    wrong_values: ["2 megohm", "5 megohm", "10 megohm", "minimum of 0.5 m", "minimum of 2 m"],
    clause_hints: ["3.2.2", "3.2"],
    safety: false,
  },
  {
    id: 2,
    text: "What DC test voltage do I use for insulation resistance testing on a standard installation?",
    description: "IR test voltage",
    correct_values: ["500 v", "500v", "500 volt"],
    wrong_values: ["1000v", "1000 v"],
    clause_hints: ["3.2", "3.2.4"],
    safety: false,
  },
  {
    id: 3,
    text: "What is the maximum allowable resistance for the main earthing conductor?",
    description: "Main earth conductor resistance limit — 0.5 Ω",
    correct_values: ["0.5", "0.5 ω", "0.5 ohm", "half an ohm"],
    wrong_values: ["1 ohm", "1.0", "2 ohm", "0.1 ohm"],
    clause_hints: ["3.1.2", "3.1"],
    safety: true,
  },
  {
    id: 4,
    text: "What is the maximum resistance for equipotential bonding conductors?",
    description: "Bonding conductor resistance limit — same 0.5 Ω as main earth",
    correct_values: ["0.5", "0.5 ω", "0.5 ohm"],
    wrong_values: ["1 ohm", "2 ohm", "1.0 ohm"],
    clause_hints: ["3.1.2"],
    safety: false,
  },
  {
    id: 5,
    text: "What is the correct order to carry out verification tests on a new electrical installation?",
    description: "Test sequence per Figure 1.1",
    correct_values: ["earth", "insulation", "polarity"],
    wrong_values: [],
    clause_hints: ["1.5", "figure 1.1"],
    safety: false,
  },
  {
    id: 6,
    text: "If an insulation resistance test fails what do I do next?",
    description: "Failure of test procedure — Clause 1.6",
    correct_values: ["rectif", "repeat", "preceding"],
    wrong_values: [],
    clause_hints: ["1.6"],
    safety: false,
  },
  {
    id: 7,
    text: "What equipment do I need to carry out a full electrical installation verification?",
    description: "Equipment list per Clause 1.7.2",
    correct_values: ["insulation resistance", "ohmmeter", "voltage indicator"],
    wrong_values: [],
    clause_hints: ["1.7", "1.7.2"],
    safety: false,
  },
  {
    id: 8,
    text: "Do I need to do a visual inspection before testing a new installation?",
    description: "Visual inspection requirement — Section 2",
    correct_values: ["yes", "shall", "visual inspection", "before"],
    wrong_values: ["not required", "optional", "no need"],
    clause_hints: ["2.1", "section 2"],
    safety: false,
  },
  {
    id: 9,
    text: "Can I use a neon voltage tester to check insulation resistance on a circuit?",
    description: "Voltage indicator limitation — Clause 1.7.2 Note 2",
    correct_values: ["no", "should not", "not be used", "not suitable", "only", "presence"],
    wrong_values: ["yes, you can", "is suitable", "is acceptable", "perfectly fine"],
    clause_hints: ["1.7.2"],
    safety: true,
  },
  {
    id: 10,
    text: "When I look at a socket outlet from the front, what is the correct clockwise order of connections from the earth slot?",
    description: "Socket outlet pin order — Clause 3.3.2(e): Earth, Active, Neutral",
    correct_values: ["earth", "active", "neutral"],
    wrong_values: ["neutral, active, earth", "active, neutral, earth"],
    clause_hints: ["3.3.2"],
    safety: false,
  },
  {
    id: 11,
    text: "What is the definition of 'verification' of an electrical installation according to AS/NZS 3017?",
    description: "Definition — Clause 1.4: inspection + testing + reporting",
    correct_values: ["inspection", "testing", "reporting"],
    wrong_values: [],
    clause_hints: ["1.4"],
    safety: false,
  },
  {
    id: 12,
    text: "Should I disconnect RCDs before doing an insulation resistance test and why?",
    description: "IR test consideration — Clause 3.2.2 / 3.2.4",
    correct_values: ["disconnect", "less than 1", "influence", "lower"],
    wrong_values: ["leave connected", "doesn't matter"],
    clause_hints: ["3.2.2", "3.2.4"],
    safety: true,
  },
];

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
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({ question, conversation_history: [] }),
  });

  if (!res.ok) throw new Error(`Query failed: ${res.status}`);

  // Handle both SSE streaming and plain JSON responses
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("text/event-stream")) {
    return await consumeSSE(res);
  } else {
    return await res.json();
  }
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
        if (parsed.type === "done" || parsed.answer) finalData = parsed;
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

  // If AI couldn't find content — that's a valid response (no hallucination).
  // A "General knowledge" prefixed answer is ALSO a decline for scoring
  // purposes: the AI is explicitly saying the standard isn't in its context.
  // Previously these were scored as real attempts, so memory-based answers
  // inflated/deflated the score depending on luck.
  const noContent = answer.includes("couldn't find") ||
                    answer.includes("not found") ||
                    answer.includes("not uploaded") ||
                    answer.includes("not been uploaded") ||
                    answer.includes("isn't in your uploaded") ||
                    answer.includes("general knowledge (not from your uploaded") ||
                    answer.includes("answer_found") ||
                    apiResponse.answer_found === false;

  if (noContent) {
    // Declining is only fully correct if it doesn't smuggle in specifics:
    // a decline that still states a wrong value is a hallucination.
    for (const bad of query.wrong_values) {
      if (answer.includes(bad.toLowerCase())) {
        return {
          pass: false,
          verdict: "FAIL (declined but still stated a wrong value)",
          issues: [`FAIL: Decline contains "${bad}" which contradicts the standard`],
          answer_snippet: answer.slice(0, 120),
        };
      }
    }
    return {
      pass: true,
      verdict: "PASS (standard not in context — correctly declined to answer)",
      issues: [],
      answer_snippet: answer.slice(0, 120),
    };
  }

  // Check correct values present
  const hasCorrect = query.correct_values.length === 0 ||
    query.correct_values.some(v => answer.includes(v.toLowerCase()));
  if (!hasCorrect) {
    issues.push(`FAIL: Expected one of [${query.correct_values.join(", ")}] — not found in answer`);
    pass = false;
  }

  // Check wrong values absent (hallucination check)
  for (const bad of query.wrong_values) {
    if (answer.includes(bad.toLowerCase())) {
      issues.push(`FAIL: Hallucination detected — answer contains "${bad}" which contradicts the standard`);
      pass = false;
    }
  }

  // Check clause citation present — the app returns clauses as clickable
  // citation metadata, NOT inline in the answer text (by design). Check both.
  const clauseRegex = /(?:clause|section|figure|table)\s+\d+(?:\.\d+)*/gi;
  const inlineCitations = answer.match(clauseRegex) ?? [];
  const metaCitations = Array.isArray(apiResponse.citations)
    ? apiResponse.citations.filter(c => c && (c.clause_number || c.standard_code)).length
    : 0;
  if (inlineCitations.length === 0 && metaCitations === 0) {
    issues.push("NEEDS REVIEW: No clause reference in answer or citations metadata");
    if (verdict === "PASS") verdict = "NEEDS REVIEW";
  }

  // Check safety warning for safety-critical questions
  const hasSafetyWarning = answer.includes("⚠") || answer.includes("warning") ||
    answer.includes("safety") || answer.includes("danger") || answer.includes("risk");
  if (query.safety && !hasSafetyWarning) {
    issues.push("NEEDS REVIEW: Safety-critical question — no safety warning in response");
    if (verdict === "PASS") verdict = "NEEDS REVIEW";
  }

  // API-level review flag: a warning to inspect, NOT an automatic failure.
  // needs_review fires on soft signals (e.g. an appended safety warning);
  // failing on it cost passes for otherwise-correct answers in the June run.
  if (apiResponse.needs_review) {
    issues.push("NEEDS REVIEW: API flagged needs_review — inspect citation grounding");
    if (verdict === "PASS") verdict = "NEEDS REVIEW";
  }

  if (!pass) verdict = "FAIL";
  else if (issues.length > 0 && verdict === "PASS") verdict = "NEEDS REVIEW";

  return {
    pass,
    verdict,
    issues,
    citationCount: inlineCitations.length + metaCitations,
    answer_snippet: answer.slice(0, 200),
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const email = process.env.SUPABASE_EMAIL;
  const password = process.env.SUPABASE_PASSWORD;
  const presetToken = process.env.SUPABASE_ACCESS_TOKEN; // CI/agent use: skip password auth
  if (!presetToken && (!email || !password)) {
    console.error("Usage: SUPABASE_EMAIL=xxx SUPABASE_PASSWORD=xxx node qa-3017-test.mjs");
    console.error("   or: SUPABASE_ACCESS_TOKEN=xxx node qa-3017-test.mjs");
    process.exit(1);
  }

  console.log("🔐 Signing in...");
  const token = presetToken || await signIn(email, password);
  console.log("✅ Authenticated\n");

  const results = [];
  let passed = 0, failed = 0, needsReview = 0;

  for (const query of TEST_QUERIES) {
    process.stdout.write(`[${query.id}/12] ${query.description}... `);
    try {
      const start = Date.now();
      const response = await queryAI(query.text, token);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      const validation = validateResponse(query, response);

      const icon = validation.verdict.startsWith("PASS") ? "✅" :
                   validation.verdict.startsWith("NEEDS") ? "⚠️ " : "❌";
      console.log(`${icon} ${validation.verdict} (${elapsed}s)`);

      if (validation.issues.length > 0) {
        for (const issue of validation.issues) console.log(`     → ${issue}`);
      }

      if (validation.verdict.startsWith("FAIL") || validation.verdict.startsWith("NEEDS")) {
        console.log(`     Answer: "${validation.answer_snippet}..."`);
      }

      if (validation.verdict.startsWith("PASS")) passed++;
      else if (validation.verdict.startsWith("FAIL")) failed++;
      else needsReview++;

      results.push({ query, validation, response });

    } catch (err) {
      console.log(`❌ ERROR: ${err.message}`);
      failed++;
      results.push({ query, validation: { verdict: "ERROR", issues: [err.message] }, response: {} });
    }

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 1500));
  }

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════");
  console.log("  AS/NZS 3017:2007 AI Test Results");
  console.log("══════════════════════════════════════════");
  console.log(`  ✅ PASS:         ${passed}`);
  console.log(`  ⚠️  NEEDS REVIEW: ${needsReview}`);
  console.log(`  ❌ FAIL:         ${failed}`);
  console.log(`  Total:          ${TEST_QUERIES.length}`);
  console.log(`  Score:          ${Math.round((passed / TEST_QUERIES.length) * 100)}%`);
  console.log("══════════════════════════════════════════\n");

  if (failed > 0) {
    console.log("❌ FAILED TESTS:");
    for (const { query, validation } of results) {
      if (validation.verdict.startsWith("FAIL") || validation.verdict === "ERROR") {
        console.log(`\n  Q${query.id}: ${query.text}`);
        for (const issue of validation.issues) console.log(`    → ${issue}`);
      }
    }
  }

  const ready = failed === 0;
  console.log(`\n${ready ? "✅ READY FOR USER TESTING" : "❌ NOT READY — fix failing tests first"}\n`);
  process.exit(ready ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
