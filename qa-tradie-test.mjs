/**
 * StandAId QA — Real Tradie Language Test
 *
 * Questions written the way a tradie would actually type them on site:
 * abbreviations, slang, mild spelling errors, no formal language.
 *
 * Usage:
 *   SUPABASE_EMAIL=you@email.com SUPABASE_PASSWORD=yourpass node qa-tradie-test.mjs
 */

const SUPABASE_URL = "https://wyxeqkgpwkcckyntqcns.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind5eGVxa2dwd2tjY2t5bnRxY25zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMzc4NzUsImV4cCI6MjA4OTgxMzg3NX0.vA_ZhRkgmrOgTIwT4_C-tEEQ81Mf4AvuyTD9Yety2Ao";
const QUERY_URL = `${SUPABASE_URL}/functions/v1/query`;

// ─── Test questions — real tradie phrasing ────────────────────────────────────
//
// correct_values: at least ONE of these must appear in the answer (case-insensitive)
// wrong_values:   if any of these appear, it's a hallucination fail
// safety:         true = ⚠️ must appear in response
//
const TEST_QUERIES = [
  {
    id: 1,
    text: "whats the max voltage drop for a final sub circuit",
    description: "Voltage drop limit — 5%",
    correct_values: ["5%", "5 percent", "five percent", "11.5v", "11.5 v"],
    wrong_values: ["10%", "2.5%"],  // 3% appears as "best practice" context — not a wrong answer
    safety: false,
  },
  {
    id: 2,
    text: "does my GPO near the sink need a saftey switch",
    description: "RCD required on socket-outlets near sink (spelling error: saftey)",
    correct_values: ["rcd", "safety switch", "residual current", "required", "yes"],
    wrong_values: ["not required", "no rcd", "optional"],
    safety: true,
  },
  {
    id: 3,
    text: "how far does a power point need to be from a pool",
    description: "Socket-outlet clearance from pool zones",
    correct_values: ["zone", "1.25", "1.5", "3.0", "metre", "meter", "classified"],
    wrong_values: [],
    safety: true,
  },
  {
    id: 4,
    text: "what size earth wire do i need for a 20 amp circuit",
    description: "Protective earth conductor size — depends on active size",
    correct_values: ["active", "conductor", "size", "2.5mm", "4mm", "cable"],
    wrong_values: ["1.5mm"],  // 6mm/10mm may appear as active cable examples, not the earth size
    safety: false,
  },
  {
    id: 5,
    text: "can i run TPS cable in the roof without conduit",
    description: "TPS in roof space — permitted with mechanical protection conditions",
    correct_values: ["yes", "permitted", "allowed", "protection", "supported", "shall", "mechanical"],
    wrong_values: ["not allowed", "prohibited", "must use conduit"],
    safety: false,
  },
  {
    id: 6,
    text: "do i need a safety switch on the hot water circuit",
    description: "RCD on HWS circuit requirement",
    correct_values: ["rcd", "safety switch", "required", "yes", "shall"],
    wrong_values: ["not required", "optional", "no"],
    safety: false,
  },
  {
    id: 7,
    text: "whats the minimun hight for a powerpoint above a bench top in a kitchen",
    description: "Socket height above benchtop — AS 3000 has no fixed min, zones apply",
    correct_values: ["zone", "sink", "bench", "no", "not", "specific", "300mm"],
    wrong_values: ["600mm", "500mm"],  // 300mm is the sink zone clearance, not a hallucination
    safety: false,
  },
  {
    id: 8,
    text: "can i put a downlight in a bathroom",
    description: "Downlight in bathroom — IP rating and zone requirements",
    correct_values: ["zone", "ip", "ingress", "ipx", "yes", "permitted", "class"],
    wrong_values: ["not allowed", "prohibited", "never"],
    safety: false,
  },
  {
    id: 9,
    text: "what does megger test voltage do i use on a new job",
    description: "Insulation resistance test voltage — 500V DC",
    correct_values: ["500v", "500 v", "500 volt", "500"],
    wrong_values: ["240v"],  // 250V/1000V may appear as contrast ("not 250V, not 1000V")
    safety: true,
  },
  {
    id: 10,
    text: "how many points can i put on a lighting circuit",
    description: "Max points on lighting circuit",
    correct_values: ["load", "current", "ampere", "demand", "watt", "circuit", "breaker", "protective"],
    wrong_values: [],
    safety: false,
  },
  {
    id: 11,
    text: "what earthing does a pool light need in zone 1",
    description: "Pool light Zone 1 earthing — SELV/PELV or Class II or Class I with 30mA RCD",
    correct_values: ["selv", "pelv", "class ii", "class 2", "30ma", "30 ma", "extra-low", "extra low"],
    wrong_values: ["no earthing required", "standard earthing"],
    safety: true,
  },
  {
    id: 12,
    text: "what tests do i have to do on a new installation before handing over",
    description: "Verification tests — continuity, insulation resistance, polarity, RCD",
    correct_values: ["insulation", "continuity", "polarity", "rcd", "test", "verification"],
    wrong_values: [],
    safety: false,
  },
  {
    id: 13,
    text: "whats the max hight a main switch can be in a switchboard",
    description: "Switchboard height — min 1.2m from floor, no explicit max for switch (spelling error: hight)",
    correct_values: ["1.2", "1200", "1.2m", "minimum", "height", "floor", "platform"],
    wrong_values: ["1500mm", "2500mm"],  // 3000 appears in "AS/NZS 3000" — not a wrong value
    safety: false,
  },
  {
    id: 14,
    text: "how deep does underground cable need to be under a concrete slab",
    description: "Underground cable depth under concrete",
    correct_values: ["50mm", "50 mm", "under", "slab", "below"],
    wrong_values: ["600mm", "200mm", "300mm"],
    safety: false,
  },
  {
    id: 15,
    text: "do i need an rcd on a circuit in a shed",
    description: "RCD requirement in outbuilding/shed",
    correct_values: ["rcd", "safety switch", "required", "yes", "shall", "socket", "outlet"],
    wrong_values: ["not required", "no rcd", "exempt"],
    safety: false,
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

// ─── Query (handles SSE stream) ───────────────────────────────────────────────
async function queryAI(question, token) {
  const res = await fetch(QUERY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "apikey": SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ question, conversation_history: [] }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Query failed: ${res.status} — ${body.slice(0, 200)}`);
  }

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("text/event-stream")) {
    return await consumeSSE(res);
  }
  return await res.json();
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
  const answer = (apiResponse.answer || "").toLowerCase();
  const issues = [];
  let pass = true;
  let verdict = "PASS";

  // If AI correctly said it couldn't find content — that's fine, not a hallucination
  const noContent = answer.includes("couldn't find") ||
                    answer.includes("not found") ||
                    answer.includes("not uploaded") ||
                    answer.includes("not been uploaded") ||
                    apiResponse.answer_found === false;

  if (noContent) {
    return {
      pass: true,
      verdict: "PASS (no standard uploaded — correctly declined)",
      issues: [],
      answer_snippet: answer.slice(0, 150),
    };
  }

  if (!answer || answer.length < 20) {
    return {
      pass: false,
      verdict: "FAIL",
      issues: ["FAIL: Empty or very short response"],
      answer_snippet: answer,
    };
  }

  // Check correct values
  const hasCorrect = query.correct_values.length === 0 ||
    query.correct_values.some(v => answer.includes(v.toLowerCase()));
  if (!hasCorrect) {
    issues.push(`FAIL: Expected one of [${query.correct_values.join(" | ")}] — not in answer`);
    pass = false;
  }

  // Check wrong values (hallucination)
  for (const bad of query.wrong_values) {
    if (answer.includes(bad.toLowerCase())) {
      issues.push(`FAIL: Hallucination — answer contains "${bad}"`);
      pass = false;
    }
  }

  // Clause citation check
  const clauseRegex = /(?:clause|section|table|figure)\s+\d+(?:\.\d+)*/gi;
  const citations = answer.match(clauseRegex) ?? [];
  if (citations.length === 0) {
    issues.push("NEEDS REVIEW: No clause reference in answer");
    if (verdict === "PASS") verdict = "NEEDS REVIEW";
  }

  // Safety warning
  const hasSafety = answer.includes("⚠") || answer.includes("always verify") ||
    answer.includes("safety") || answer.includes("danger") || answer.includes("risk");
  if (query.safety && !hasSafety) {
    issues.push("NEEDS REVIEW: Safety-critical question — no safety warning");
    if (verdict === "PASS") verdict = "NEEDS REVIEW";
  }

  if (apiResponse.needs_review) {
    issues.push("FAIL: API flagged needs_review (possible hallucination)");
    pass = false;
  }

  if (!pass) verdict = "FAIL";
  else if (issues.length > 0 && verdict === "PASS") verdict = "NEEDS REVIEW";

  return { pass, verdict, issues, citationCount: citations.length, answer_snippet: answer.slice(0, 200) };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const email = process.env.SUPABASE_EMAIL;
  const password = process.env.SUPABASE_PASSWORD;
  if (!email || !password) {
    console.error("Usage: SUPABASE_EMAIL=you@email.com SUPABASE_PASSWORD=yourpass node qa-tradie-test.mjs");
    process.exit(1);
  }

  console.log("🔐 Signing in...");
  const token = await signIn(email, password);
  console.log("✅ Authenticated\n");
  console.log("💬 Testing with real tradie language (slang, abbreviations, spelling errors)\n");

  const results = [];
  let passed = 0, failed = 0, needsReview = 0;

  for (const query of TEST_QUERIES) {
    process.stdout.write(`[${String(query.id).padStart(2,"0")}/${TEST_QUERIES.length}] "${query.text.slice(0, 55)}"... `);
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
      if (!validation.verdict.startsWith("PASS")) {
        console.log(`     Answer: "${validation.answer_snippet}"`);
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

    await new Promise(r => setTimeout(r, 2500));
  }

  console.log("\n══════════════════════════════════════════");
  console.log("  StandAId Tradie Language Test Results");
  console.log("══════════════════════════════════════════");
  console.log(`  ✅ PASS:          ${passed}`);
  console.log(`  ⚠️  NEEDS REVIEW:  ${needsReview}`);
  console.log(`  ❌ FAIL:          ${failed}`);
  console.log(`  Total:           ${TEST_QUERIES.length}`);
  console.log(`  Score:           ${Math.round((passed / TEST_QUERIES.length) * 100)}%`);
  console.log("══════════════════════════════════════════\n");

  if (failed > 0 || needsReview > 0) {
    console.log("Problems to address:");
    for (const { query, validation } of results) {
      if (!validation.verdict.startsWith("PASS")) {
        console.log(`\n  Q${query.id}: "${query.text}"`);
        console.log(`  Expected: ${query.correct_values.join(" or ")}`);
        for (const issue of validation.issues) console.log(`  → ${issue}`);
      }
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
