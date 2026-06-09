/**
 * StandAId QA Test Suite — /query endpoint
 *
 * Usage:
 *   SUPABASE_EMAIL=you@email.com SUPABASE_PASSWORD=yourpass node qa-test.mjs
 *
 * Outputs: qa-report.md
 */

const SUPABASE_URL = "https://wyxeqkgpwkcckyntqcns.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind5eGVxa2dwd2tjY2t5bnRxY25zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMzc4NzUsImV4cCI6MjA4OTgxMzg3NX0.vA_ZhRkgmrOgTIwT4_C-tEEQ81Mf4AvuyTD9Yety2Ao";

const QUERY_URL = `${SUPABASE_URL}/functions/v1/query`;

// ─── 50 Electrical Trade Test Queries ─────────────────────────────────────
const TEST_QUERIES = [
  // Voltage Drop
  { id: 1,  text: "What is the maximum allowable voltage drop for a final sub-circuit?", safety: false, trade: "electrical" },
  { id: 2,  text: "What is the maximum voltage drop from the point of supply to the point of use?", safety: false, trade: "electrical" },
  // Cable Sizing
  { id: 3,  text: "How do I size a cable for a 20A circuit with a 30 metre run?", safety: false, trade: "electrical" },
  { id: 4,  text: "What is the minimum cable size for a 10A general purpose outlet circuit?", safety: false, trade: "electrical" },
  { id: 5,  text: "How do I derate cables installed in conduit?", safety: false, trade: "electrical" },
  // RCDs / Safety Switches
  { id: 6,  text: "Which circuits in a house require an RCD?", safety: false, trade: "electrical" },
  { id: 7,  text: "What is the maximum tripping time for a 30mA RCD?", safety: true,  trade: "electrical" },
  { id: 8,  text: "Do I need an RCD on a hot water circuit?", safety: true,  trade: "electrical" },
  // Earthing & Bonding
  { id: 9,  text: "What is the minimum earth conductor size for a 20A circuit?", safety: true,  trade: "electrical" },
  { id: 10, text: "What does AS/NZS 3000 say about main earthing conductor sizing?", safety: true,  trade: "electrical" },
  { id: 11, text: "What is equipotential bonding and when is it required?", safety: true,  trade: "electrical" },
  // Isolation & Testing
  { id: 12, text: "What isolation requirements apply before working on a switchboard?", safety: true,  trade: "electrical" },
  { id: 13, text: "What test voltage is used for insulation resistance testing on a new installation?", safety: true,  trade: "electrical" },
  { id: 14, text: "What is the minimum insulation resistance value for a new installation?", safety: true,  trade: "electrical" },
  { id: 15, text: "How do I verify a new installation meets wiring rules requirements?", safety: true,  trade: "electrical" },
  // Switchboard Requirements
  { id: 16, text: "What are the clearance requirements inside a switchboard?", safety: false, trade: "electrical" },
  { id: 17, text: "What is the maximum height for a switchboard main switch?", safety: false, trade: "electrical" },
  { id: 18, text: "What label must be attached to a main switchboard?", safety: false, trade: "electrical" },
  // Consumer Mains & Sub-Mains
  { id: 19, text: "What protection is required for consumer mains?", safety: false, trade: "electrical" },
  { id: 20, text: "What is the maximum current rating for a sub-main without overcurrent protection at the source?", safety: false, trade: "electrical" },
  // Circuit Protection
  { id: 21, text: "What does AS/NZS 3000 say about overload protection for conductors?", safety: false, trade: "electrical" },
  { id: 22, text: "What is the discrimination requirement between protective devices?", safety: false, trade: "electrical" },
  { id: 23, text: "When can a circuit breaker be omitted at the origin of a sub-circuit?", safety: false, trade: "electrical" },
  // GPO & Outlet Requirements
  { id: 24, text: "What is the minimum number of power outlets required in a bedroom?", safety: false, trade: "electrical" },
  { id: 25, text: "How close can a GPO be installed to a kitchen sink?", safety: true,  trade: "electrical" },
  { id: 26, text: "What are the requirements for socket outlets in a bathroom?", safety: true,  trade: "electrical" },
  // Lighting
  { id: 27, text: "What is the maximum number of points on a lighting circuit?", safety: false, trade: "electrical" },
  { id: 28, text: "Do LED downlights need to be in a fire-rated ceiling?", safety: false, trade: "electrical" },
  // Wiring Methods
  { id: 29, text: "Can I run TPS cable in a roof space without conduit?", safety: false, trade: "electrical" },
  { id: 30, text: "What are the requirements for cables buried underground?", safety: false, trade: "electrical" },
  { id: 31, text: "What depth must cables be buried under a concrete slab?", safety: false, trade: "electrical" },
  // Air Conditioning / Motor Circuits
  { id: 32, text: "What protection is required for an air conditioning circuit?", safety: false, trade: "electrical" },
  { id: 33, text: "What is the demand factor for air conditioning loads?", safety: false, trade: "electrical" },
  // Switchboard Labelling
  { id: 34, text: "What information must be on circuit labels in a switchboard?", safety: false, trade: "electrical" },
  { id: 35, text: "Is a single-line diagram required for a domestic installation?", safety: false, trade: "electrical" },
  // AS/NZS 3017 Verification
  { id: 36, text: "What tests are required during a verification of a new electrical installation?", safety: true,  trade: "electrical" },
  { id: 37, text: "What is the continuity test requirement for protective conductors?", safety: true,  trade: "electrical" },
  { id: 38, text: "What is the polarity test and why is it done?", safety: true,  trade: "electrical" },
  // In-Service Testing AS/NZS 3760
  { id: 39, text: "How often must portable appliances be tested in a workshop?", safety: false, trade: "electrical" },
  { id: 40, text: "What are the pass/fail criteria for in-service insulation resistance testing of a power tool?", safety: true,  trade: "electrical" },
  // Specific Values & Limits
  { id: 41, text: "What is the maximum loop impedance for a 20A Type C circuit breaker?", safety: false, trade: "electrical" },
  { id: 42, text: "What is the prospective short circuit current requirement at the main switchboard?", safety: false, trade: "electrical" },
  { id: 43, text: "What is the maximum disconnection time for a 230V TN-S system fault?", safety: true,  trade: "electrical" },
  // Solar / Renewables
  { id: 44, text: "What are the AS/NZS 3000 requirements for isolating a solar inverter?", safety: true,  trade: "electrical" },
  { id: 45, text: "What labelling is required on a solar installation at the switchboard?", safety: false, trade: "electrical" },
  // Hazardous Areas
  { id: 46, text: "What classification system applies to hazardous areas for electrical equipment?", safety: true,  trade: "electrical" },
  // Water Heater / Special Loads
  { id: 47, text: "What circuit requirements apply to an electric hot water system?", safety: false, trade: "electrical" },
  { id: 48, text: "What is the minimum circuit size for an electric oven?", safety: false, trade: "electrical" },
  // Specific Safety Scenarios
  { id: 49, text: "What does the wiring rules say about working on live electrical equipment?", safety: true,  trade: "electrical" },
  { id: 50, text: "What are the requirements for a safety observer when working on high voltage equipment?", safety: true,  trade: "electrical" },
];

// ─── Validation ──────────────────────────────────────────────────────────────

const CLAUSE_REGEX = /(?:AS\/NZS|AS)\s+\d+(?:\.\d+)*(?:\s+(?:Clause|Table|Section|Figure)\s+\d+(?:\.\d+)*)?|(?:Clause|Table|Section|Figure)\s+\d+(?:\.\d+)+/gi;
const JARGON_DENSITY_THRESHOLD = 0.15; // flag if >15% of words are technical acronyms unexplained

// Known actual clause numbers from AS/NZS 3000:2018 — use to catch obvious hallucinations
// Only a sample; real validation relies on chunk grounding (needs_review flag from API)
const KNOWN_VALID_CLAUSES_SAMPLE = [
  "2.3.2", "2.5", "2.6", "3.1", "3.2", "4.3", "4.4", "5.1", "5.2", "5.3",
  "5.4", "6.1", "6.2", "7.1", "7.2", "7.3", "7.4", "7.5", "7.6", "8.1",
];

const KNOWN_HALLUCINATION_PATTERNS = [
  /clause\s+1[5-9]\.\d/i,      // AS/NZS 3000 has no clause 15+ at top level
  /clause\s+2[0-9]\.\d/i,      // same
  /AS\/NZS\s+3000\s+clause\s+9\.\d/i, // no clause 9 in 3000
];

function validateQueryResponse(query, apiResponse) {
  const issues = [];
  const result = {
    pass: true,
    verdict: "PASS",
    issues: [],
    citatonCount: 0,
    hasSafetyWarning: false,
    confidenceScore: apiResponse.confidence_score ?? 0,
  };

  const answer = apiResponse.answer || "";

  // ── Criterion 1: Clause citation present ─────────────────────────────────
  const citations = answer.match(CLAUSE_REGEX) ?? [];
  result.citationCount = citations.length;

  if (citations.length === 0 && !answer.toLowerCase().includes("not covered") && !answer.toLowerCase().includes("don't cover")) {
    issues.push("FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format)");
    result.pass = false;
  }

  // ── Criterion 2: Plain English (basic check) ──────────────────────────────
  const techAcronymsWithoutExplanation = (answer.match(/\b(TN-S|TN-C-S|TT|IT|SCPD|RCBO|ELCB)\b/g) ?? [])
    .filter(a => !answer.toLowerCase().includes(a.toLowerCase().replace(/-/g, "") + " ") &&
                 !answer.toLowerCase().includes("("));
  if (techAcronymsWithoutExplanation.length > 2) {
    issues.push(`NEEDS REVIEW: Unexplained technical acronyms: ${techAcronymsWithoutExplanation.join(", ")}`);
    if (result.pass) result.verdict = "NEEDS REVIEW";
  }

  // ── Criterion 3: Safety warning ───────────────────────────────────────────
  const hasSafetyWarning = answer.includes("⚠️") ||
    answer.toLowerCase().includes("warning") ||
    answer.toLowerCase().includes("safety") ||
    answer.toLowerCase().includes("verify on site");

  result.hasSafetyWarning = hasSafetyWarning;

  if (query.safety && !hasSafetyWarning) {
    issues.push("FAIL: Safety-critical query has no ⚠️ warning");
    result.pass = false;
  }

  // ── Criterion 4: No hallucinated clauses ──────────────────────────────────
  if (apiResponse.needs_review) {
    issues.push("FAIL: API flagged needs_review (possible hallucinated citation or low grounding)");
    result.pass = false;
  }

  // Check validation issues from API
  const validationIssues = apiResponse.validation_issues ?? [];
  const hallucinatedCitations = validationIssues.filter(i => i?.type === "hallucinated_citation");
  if (hallucinatedCitations.length > 0) {
    issues.push(`FAIL: ${hallucinatedCitations.length} hallucinated citation(s) detected by API validator`);
    result.pass = false;
  }

  // Local pattern check for obvious hallucinations
  for (const pattern of KNOWN_HALLUCINATION_PATTERNS) {
    if (pattern.test(answer)) {
      issues.push(`NEEDS REVIEW: Potential hallucinated clause pattern matched: ${pattern}`);
      if (result.pass) result.verdict = "NEEDS REVIEW";
    }
  }

  // ── Criterion 5: Confidence score > 0.70 ─────────────────────────────────
  if (result.confidenceScore < 0.70) {
    issues.push(`FAIL: Confidence score ${result.confidenceScore.toFixed(2)} is below 0.70 threshold`);
    result.pass = false;
  }

  // ── Final verdict ─────────────────────────────────────────────────────────
  result.issues = issues;
  if (!result.pass) {
    result.verdict = "FAIL";
  } else if (result.verdict !== "NEEDS REVIEW" && issues.length > 0) {
    result.verdict = "NEEDS REVIEW";
  }

  return result;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
async function signIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Auth failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  return data.access_token;
}

// ─── Query ────────────────────────────────────────────────────────────────────
async function runQuery(question, token) {
  const res = await fetch(QUERY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "apikey": SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ question }),
  });

  const data = await res.json();
  return { status: res.status, data };
}

// ─── Report Generation ────────────────────────────────────────────────────────
function generateReport(results) {
  const total = results.length;
  const passed = results.filter(r => r.verdict === "PASS").length;
  const failed = results.filter(r => r.verdict === "FAIL").length;
  const needsReview = results.filter(r => r.verdict === "NEEDS REVIEW").length;
  const passRate = ((passed / total) * 100).toFixed(1);

  const failurePatterns = {
    noCitation: results.filter(r => r.issues.some(i => i.includes("No clause citation"))).length,
    noSafetyWarning: results.filter(r => r.issues.some(i => i.includes("no ⚠️ warning"))).length,
    hallucination: results.filter(r => r.issues.some(i => i.includes("hallucinated"))).length,
    lowConfidence: results.filter(r => r.issues.some(i => i.includes("Confidence score"))).length,
    apiNeedsReview: results.filter(r => r.issues.some(i => i.includes("API flagged needs_review"))).length,
    httpError: results.filter(r => r.httpStatus !== 200).length,
  };

  let md = `# StandAId QA Test Report\n`;
  md += `**Date:** ${new Date().toISOString()}\n`;
  md += `**Endpoint:** \`${QUERY_URL}\`\n`;
  md += `**Total Queries:** ${total}\n\n`;

  md += `## Summary\n\n`;
  md += `| Metric | Value |\n|--------|-------|\n`;
  md += `| Total Queries | ${total} |\n`;
  md += `| PASS | ${passed} (${passRate}%) |\n`;
  md += `| FAIL | ${failed} |\n`;
  md += `| NEEDS REVIEW | ${needsReview} |\n`;
  md += `| **Pass Rate** | **${passRate}%** |\n\n`;

  md += `## Failure Patterns\n\n`;
  md += `| Issue | Count |\n|-------|-------|\n`;
  md += `| No clause citation | ${failurePatterns.noCitation} |\n`;
  md += `| Missing ⚠️ on safety-critical topic | ${failurePatterns.noSafetyWarning} |\n`;
  md += `| Hallucinated citations detected | ${failurePatterns.hallucination} |\n`;
  md += `| Confidence score < 0.70 | ${failurePatterns.lowConfidence} |\n`;
  md += `| API flagged needs_review | ${failurePatterns.apiNeedsReview} |\n`;
  md += `| HTTP error (non-200) | ${failurePatterns.httpError} |\n\n`;

  md += `## Detailed Results\n\n`;
  md += `| # | Query | Response (first 100 chars) | Verdict | Confidence | Issues |\n`;
  md += `|---|-------|---------------------------|---------|------------|--------|\n`;

  for (const r of results) {
    const queryShort = r.query.length > 60 ? r.query.slice(0, 57) + "..." : r.query;
    const responseShort = (r.response || "[no response]").slice(0, 100).replace(/\n/g, " ").replace(/\|/g, "\\|");
    const issuesSummary = r.issues.length > 0 ? r.issues.map(i => i.replace(/\|/g, "\\|")).join("; ") : "None";
    const verdict = r.verdict === "PASS" ? "✅ PASS" : r.verdict === "FAIL" ? "❌ FAIL" : "🔶 NEEDS REVIEW";
    const conf = typeof r.confidenceScore === "number" ? r.confidenceScore.toFixed(2) : "N/A";
    md += `| ${r.id} | ${queryShort} | ${responseShort} | ${verdict} | ${conf} | ${issuesSummary} |\n`;
  }

  // Low confidence queries list
  const lowConf = results.filter(r => typeof r.confidenceScore === "number" && r.confidenceScore < 0.70);
  if (lowConf.length > 0) {
    md += `\n## Low Confidence Queries (< 0.70)\n\n`;
    for (const r of lowConf) {
      md += `- **Q${r.id}:** "${r.query}" — score: ${r.confidenceScore.toFixed(2)}\n`;
    }
  }

  // Failed queries detail
  const failedResults = results.filter(r => r.verdict === "FAIL");
  if (failedResults.length > 0) {
    md += `\n## Failed Queries — Full Detail\n\n`;
    for (const r of failedResults) {
      md += `### Q${r.id}: ${r.query}\n`;
      md += `**HTTP Status:** ${r.httpStatus}\n`;
      md += `**Confidence:** ${typeof r.confidenceScore === "number" ? r.confidenceScore.toFixed(2) : "N/A"}\n`;
      md += `**Issues:**\n`;
      for (const issue of r.issues) {
        md += `- ${issue}\n`;
      }
      md += `**Response:**\n\`\`\`\n${r.response || "[no response]"}\n\`\`\`\n\n`;
    }
  }

  // Recommendations
  md += `## Recommendations Before Going Live\n\n`;

  if (failurePatterns.noCitation > 3) {
    md += `- 🔴 **Citation rate is low (${failurePatterns.noCitation} queries returned no clause).** Check that standards are uploaded and chunked correctly. The AI cannot cite what it hasn't retrieved.\n`;
  } else if (failurePatterns.noCitation > 0) {
    md += `- 🟡 **${failurePatterns.noCitation} query/queries returned no clause citation.** May indicate missing standard coverage for those topics.\n`;
  }

  if (failurePatterns.noSafetyWarning > 2) {
    md += `- 🔴 **Safety warning failures: ${failurePatterns.noSafetyWarning} safety-critical queries missing ⚠️.** Review SAFETY_CRITICAL_KEYWORDS list in validation.ts and add missing electrical keywords.\n`;
  } else if (failurePatterns.noSafetyWarning > 0) {
    md += `- 🟡 **${failurePatterns.noSafetyWarning} safety-critical query/queries missing ⚠️ warning.** Review safety keyword triggers.\n`;
  }

  if (failurePatterns.hallucination > 2) {
    md += `- 🔴 **Hallucination rate high (${failurePatterns.hallucination} queries).** Reduce model temperature (currently 0.1 — already low), increase match_threshold, or add stricter citation grounding.\n`;
  } else if (failurePatterns.hallucination > 0) {
    md += `- 🟡 **${failurePatterns.hallucination} hallucinated citation(s) detected.** Individual false positives possible — review manually.\n`;
  }

  if (failurePatterns.lowConfidence > 5) {
    md += `- 🔴 **High rate of low-confidence responses (${failurePatterns.lowConfidence}).** This suggests the vector search is not finding good matches. Check embeddings are generated for all chunks and similarity threshold (currently 0.30) is appropriate.\n`;
  } else if (failurePatterns.lowConfidence > 0) {
    md += `- 🟡 **${failurePatterns.lowConfidence} query/queries returned low confidence.** May indicate gaps in uploaded standard coverage.\n`;
  }

  if (failurePatterns.httpError > 0) {
    md += `- 🔴 **${failurePatterns.httpError} HTTP error(s).** Check rate limits, auth config, and edge function logs.\n`;
  }

  if (parseFloat(passRate) >= 90) {
    md += `- ✅ **Pass rate ${passRate}% — system is production-ready for launch.**\n`;
  } else if (parseFloat(passRate) >= 75) {
    md += `- 🟡 **Pass rate ${passRate}% — acceptable for soft launch but address failures above before full public release.**\n`;
  } else {
    md += `- 🔴 **Pass rate ${passRate}% — below acceptable threshold. Do not launch until failures are addressed.**\n`;
  }

  return md;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const email = process.env.SUPABASE_EMAIL;
  const password = process.env.SUPABASE_PASSWORD;

  if (!email || !password) {
    console.error("Usage: SUPABASE_EMAIL=you@email.com SUPABASE_PASSWORD=yourpass node qa-test.mjs");
    process.exit(1);
  }

  console.log("🔐 Signing in...");
  let token;
  try {
    token = await signIn(email, password);
    console.log("✅ Authenticated");
  } catch (e) {
    console.error("Auth failed:", e.message);
    process.exit(1);
  }

  const results = [];
  console.log(`\n🚀 Running ${TEST_QUERIES.length} test queries...\n`);

  for (const query of TEST_QUERIES) {
    process.stdout.write(`  Q${String(query.id).padStart(2, "0")}: ${query.text.slice(0, 55)}...`);

    let httpStatus = 0;
    let response = "";
    let apiData = {};
    let verdict = "FAIL";
    let issues = [];
    let confidenceScore = 0;

    try {
      const { status, data } = await runQuery(query.text, token);
      httpStatus = status;
      apiData = data;

      if (status !== 200) {
        issues.push(`HTTP ${status}: ${data.error || "unknown error"}`);
        verdict = "FAIL";
      } else {
        response = data.answer || "";
        const validation = validateQueryResponse(query, data);
        verdict = validation.verdict;
        issues = validation.issues;
        confidenceScore = validation.confidenceScore;
      }
    } catch (e) {
      issues.push(`Request failed: ${e.message}`);
      verdict = "FAIL";
    }

    const icon = verdict === "PASS" ? "✅" : verdict === "FAIL" ? "❌" : "🔶";
    console.log(` ${icon} ${verdict}`);
    if (issues.length > 0) {
      for (const issue of issues) {
        console.log(`       ↳ ${issue}`);
      }
    }

    results.push({
      id: query.id,
      query: query.text,
      safety: query.safety,
      trade: query.trade,
      verdict,
      issues,
      response,
      confidenceScore,
      httpStatus,
    });

    // Avoid hammering the API — 50ms pause between requests
    await new Promise(r => setTimeout(r, 50));
  }

  console.log("\n📊 Generating report...");
  const report = generateReport(results);

  const fs = await import("fs");
  fs.writeFileSync("qa-report.md", report);
  console.log("✅ Report written to qa-report.md\n");

  const passed = results.filter(r => r.verdict === "PASS").length;
  const failed = results.filter(r => r.verdict === "FAIL").length;
  const nr = results.filter(r => r.verdict === "NEEDS REVIEW").length;
  console.log(`Results: ${passed} PASS | ${failed} FAIL | ${nr} NEEDS REVIEW`);
  console.log(`Pass rate: ${((passed / results.length) * 100).toFixed(1)}%`);
}

main();
