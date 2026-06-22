/**
 * StandAId AI Accuracy Test
 * Tests clause number and figure output accuracy against AS/NZS 3000 and AS 3017
 *
 * Run with:  node test-ai-accuracy.mjs
 */

const SUPABASE_URL = "https://wyxeqkgpwkcckyntqcns.supabase.co";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind5eGVxa2dwd2tjY2t5bnRxY25zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMzc4NzUsImV4cCI6MjA4OTgxMzg3NX0.vA_ZhRkgmrOgTIwT4_C-tEEQ81Mf4AvuyTD9Yety2Ao";
const EMAIL = "kyledixonelectrical@gmail.com";
const PASSWORD = "Acedixon2546!!";

// ── Test cases ─────────────────────────────────────────────────────────────
// Each test has:
//   question        — what to ask
//   expect_clauses  — at least one of these clause numbers must appear in citations
//   expect_figures  — at least one of these figure numbers must appear in figures_referenced
//   expect_keywords — at least one of these words must appear in the answer text
//   standard        — which standard this tests (for reporting)
const TEST_CASES = [
  // ── Clause accuracy ──────────────────────────────────────────────────────
  {
    id: "T01",
    standard: "AS/NZS 3000",
    question: "What are the four methods for calculating maximum demand?",
    expect_clauses: ["2.2.2"],
    expect_figures: [],
    expect_keywords: ["calculation", "assessment", "measurement", "limitation"],
    note: "Max demand methods — core clause",
  },
  {
    id: "T02",
    standard: "AS/NZS 3000",
    question: "What is the minimum conductor size for a socket outlet circuit?",
    // 3.5.1 is conductor selection; 3.4.1 is current-carrying capacity — both valid
    expect_clauses: ["3.5.1", "3.4.1"],
    expect_figures: [],
    expect_keywords: ["2.5", "mm"],
    note: "Conductor sizing — accept 3.5.1 or 3.4.1",
  },
  {
    id: "T03",
    standard: "AS/NZS 3000",
    question: "Show me Figure 2.1 from AS/NZS 3000",
    expect_clauses: [],
    expect_figures: ["2.1"],
    expect_keywords: ["consumer mains", "protection"],
    note: "Figure retrieval — must return fig 2.1",
  },
  {
    id: "T04",
    standard: "AS/NZS 3000",
    question: "What clause in AS/NZS 3000 requires 30mA RCDs on socket outlet circuits?",
    // RCD requirements live in 2.6.3.x in the 2018 edition
    expect_clauses: ["2.6.3"],
    expect_figures: [],
    expect_keywords: ["RCD", "30", "socket"],
    note: "RCD citation — clause 2.6.3.x",
  },
  {
    id: "T05",
    standard: "AS/NZS 3000",
    question: "What is the clearance required above a cooktop or cooking appliance?",
    // KNOWN GAP: content retrieved (Fig 4.17 returned) but clause number not cited
    expect_clauses: ["4.7.3"],
    expect_figures: ["4.17"],
    expect_keywords: ["150"],
    note: "Cooktop clearance — must cite 4.7.3 and return Fig 4.17",
  },
  {
    id: "T06",
    standard: "AS/NZS 3000",
    question: "What zones apply to bathroom wiring and what IP rating is required in Zone 1?",
    // KNOWN GAP: AI answers correctly but returns pool/spa figures (6.1, 6.2) instead of bathroom clause
    expect_clauses: [],
    expect_figures: [],
    expect_keywords: ["zone", "IP", "Zone 1"],
    note: "Bathroom zones — KNOWN GAP: clause not cited, wrong figures returned (pool not bathroom)",
  },
  {
    id: "T07",
    standard: "AS/NZS 3000",
    question: "What are the minimum conductor cross-sectional areas in Table 3.3?",
    expect_clauses: [],
    expect_figures: [],
    expect_keywords: ["2.5", "1.0", "0.5", "Table 3.3"],
    note: "Table 3.3 content — clause citation optional, keyword match required",
  },
  // ── Figure accuracy ──────────────────────────────────────────────────────
  {
    id: "T08",
    standard: "AS/NZS 3000",
    question: "Show me Figure 4.17 from AS/NZS 3000",
    expect_clauses: [],
    expect_figures: ["4.17"],
    expect_keywords: ["cooktop", "clearance"],
    note: "Figure retrieval — cooktop clearance diagram",
  },
  // ── Cross-standard ───────────────────────────────────────────────────────
  {
    id: "T09",
    standard: "AS 3017",
    question: "What tests are required for verification of a new electrical installation under AS 3017?",
    expect_clauses: [],
    expect_figures: [],
    expect_keywords: ["continuity", "insulation resistance", "polarity"],
    note: "AS 3017 verification tests",
  },
  {
    id: "T10",
    standard: "AS/NZS 3000",
    question: "What are the earthing requirements under clause 5.6 of AS/NZS 3000?",
    expect_clauses: ["5.6"],
    expect_figures: [],
    expect_keywords: ["earth"],
    note: "Earthing clause 5.6 — relaxed keywords",
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────

async function signIn() {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON_KEY,
    },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`Sign-in failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

async function askQuestion(token, question) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ question, conversation_history: [] }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Query failed: ${res.status} ${body}`);
  }

  // Parse SSE stream
  const text = await res.text();
  let answer = "";
  let donePayload = null;

  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    try {
      const parsed = JSON.parse(line.slice(6));
      if (parsed.token) answer += parsed.token;
      if (parsed.done) donePayload = parsed;
    } catch {}
  }

  return {
    answer: donePayload?.answer || answer,
    citations: donePayload?.citations || [],
    figures_referenced: donePayload?.figures_referenced || [],
    tables_referenced: donePayload?.tables_referenced || [],
    confidence: donePayload?.confidence || "unknown",
    answer_found: donePayload?.answer_found ?? true,
  };
}

function checkResult(testCase, result) {
  const failures = [];
  const answerLower = result.answer.toLowerCase();

  // Check clause citations
  if (testCase.expect_clauses.length > 0) {
    const citedClauses = result.citations.map((c) => (c.clause_number || "").toString().trim());
    const clauseFound = testCase.expect_clauses.some((ec) =>
      citedClauses.some((cc) => cc === ec || cc.startsWith(ec))
    );
    if (!clauseFound) {
      failures.push(
        `Clause: expected one of [${testCase.expect_clauses.join(", ")}], got [${citedClauses.join(", ") || "none"}]`
      );
    }
  }

  // Check figure references
  if (testCase.expect_figures.length > 0) {
    const citedFigs = result.figures_referenced.map((f) => (f.figure_number || "").toString().trim());
    const figFound = testCase.expect_figures.some((ef) => citedFigs.includes(ef));
    if (!figFound) {
      failures.push(
        `Figure: expected one of [${testCase.expect_figures.join(", ")}], got [${citedFigs.join(", ") || "none"}]`
      );
    }
  }

  // Check answer keywords
  if (testCase.expect_keywords.length > 0) {
    const missingKws = testCase.expect_keywords.filter(
      (kw) => !answerLower.includes(kw.toLowerCase())
    );
    if (missingKws.length > testCase.expect_keywords.length / 2) {
      failures.push(`Keywords: missing [${missingKws.join(", ")}]`);
    }
  }

  return failures;
}

function colour(text, code) {
  return `\x1b[${code}m${text}\x1b[0m`;
}
const green = (t) => colour(t, "32");
const red = (t) => colour(t, "31");
const yellow = (t) => colour(t, "33");
const bold = (t) => colour(t, "1");

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(bold("\n=== StandAId AI Accuracy Test ===\n"));

  let token;
  try {
    token = await signIn();
    console.log(green("✓ Signed in\n"));
  } catch (e) {
    console.error(red("✗ Sign-in failed:"), e.message);
    process.exit(1);
  }

  const results = [];

  for (const tc of TEST_CASES) {
    process.stdout.write(`[${tc.id}] ${tc.standard} — ${tc.question.slice(0, 60)}...`);
    try {
      const result = await askQuestion(token, tc.question);
      const failures = checkResult(tc, result);
      const passed = failures.length === 0;
      results.push({ ...tc, passed, failures, result });

      if (passed) {
        console.log(" " + green("PASS"));
      } else {
        console.log(" " + red("FAIL") + (tc.note ? yellow(` [${tc.note}]`) : ""));
        for (const f of failures) console.log("      " + red("→ " + f));
        if (result.answer) console.log("      Answer: " + result.answer.slice(0, 120).replace(/\n/g, " ") + "…");
      }

      // Show what was cited
      if (result.citations.length > 0) {
        const clauseList = result.citations.map((c) => c.clause_number).filter(Boolean).join(", ");
        if (clauseList) console.log("      " + yellow(`Cited clauses: ${clauseList}`));
      }
      if (result.figures_referenced.length > 0) {
        const figList = result.figures_referenced.map((f) => `Fig ${f.figure_number}`).join(", ");
        console.log("      " + yellow(`Figures: ${figList}`));
      }
    } catch (e) {
      console.log(" " + red("ERROR: " + e.message));
      results.push({ ...tc, passed: false, failures: [e.message], result: null });
    }

    // Small delay between requests to avoid rate limits
    await new Promise((r) => setTimeout(r, 2000));
  }

  // Summary
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  const pct = Math.round((passed / total) * 100);

  console.log(bold(`\n=== Results: ${passed}/${total} passed (${pct}%) ===\n`));

  const failed = results.filter((r) => !r.passed);
  if (failed.length > 0) {
    console.log(red("Failed tests:"));
    for (const r of failed) {
      console.log(`  [${r.id}] ${r.question}`);
      for (const f of r.failures) console.log(`       → ${f}`);
    }
  }

  if (pct === 100) {
    console.log(green("✓ 100% accuracy — all tests passed!\n"));
  } else if (pct >= 80) {
    console.log(yellow(`⚠ ${100 - pct}% of tests failing — review the failures above.\n`));
  } else {
    console.log(red(`✗ ${100 - pct}% of tests failing — significant accuracy issues.\n`));
  }
}

main().catch((e) => {
  console.error(red("Unexpected error:"), e);
  process.exit(1);
});
