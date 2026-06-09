/**
 * Validation v2 — Response Quality Gate
 *
 * Replaces the basic citation check at line 275 of query/index.ts.
 *
 * What it does:
 *   1. Semantic citation validation — ensures cited clauses actually
 *      appear in the retrieved chunks (not just that the format matches)
 *   2. Safety flagging — auto-adds ⚠️ if the response involves
 *      safety-critical content and is missing a warning
 *   3. Hallucination detection — flags responses that cite clauses
 *      not present in the source material
 *   4. Confidence scoring — returns a score 0–1 so the frontend can
 *      display a "verified" badge or "review recommended" flag
 *   5. Structured issues output — returns all problems found so they
 *      can be logged for later review
 *
 * Usage in query/index.ts:
 *
 *   const validationResult = validateResponse({
 *     response: streamedText,
 *     chunks: retrievedChunks,
 *     query: userQuery,
 *     trade: detectedTrade,
 *   });
 *
 *   if (validationResult.shouldBlock) {
 *     // Return a safe fallback message
 *   } else {
 *     // Return the response, optionally stripped of bad citations
 *     return validationResult.cleanedResponse;
 *   }
 */

import type { TradeType } from "./01-system-prompt.ts";

export interface ValidationInput {
  response: string;
  chunks: Array<{ content: string; metadata?: Record<string, unknown> }>;
  query: string;
  trade: TradeType;
}

export interface ValidationIssue {
  type:
    | "hallucinated_citation"
    | "missing_safety_warning"
    | "unverified_claim"
    | "empty_response"
    | "no_citation";
  severity: "info" | "warning" | "critical";
  detail: string;
}

export interface ValidationResult {
  cleanedResponse: string;
  issues: ValidationIssue[];
  confidenceScore: number; // 0.0 to 1.0
  shouldBlock: boolean;
  needsReview: boolean;
}

// ──────────────────────────────────────────────────────────────────────────
// Main Validation Entry Point
// ──────────────────────────────────────────────────────────────────────────

export function validateResponse(input: ValidationInput): ValidationResult {
  const issues: ValidationIssue[] = [];
  let cleanedResponse = input.response;

  // Check 1: Empty response
  if (!input.response || input.response.trim().length < 20) {
    issues.push({
      type: "empty_response",
      severity: "critical",
      detail: "Response is empty or too short to be useful",
    });
    return {
      cleanedResponse: input.response,
      issues,
      confidenceScore: 0,
      shouldBlock: true,
      needsReview: true,
    };
  }

  // Check 2: Citation validation (semantic)
  const citationResult = validateCitations(input.response, input.chunks);
  issues.push(...citationResult.issues);
  cleanedResponse = citationResult.cleaned;

  // Check 3: Safety warning check
  const safetyResult = checkSafetyWarnings(
    input.query,
    cleanedResponse,
    input.trade
  );
  issues.push(...safetyResult.issues);
  if (safetyResult.updatedResponse) {
    cleanedResponse = safetyResult.updatedResponse;
  }

  // Check 4: Did the model actually answer from the chunks?
  const groundingResult = checkGrounding(cleanedResponse, input.chunks);
  issues.push(...groundingResult.issues);

  // Compute confidence score
  const confidenceScore = computeConfidence(issues);

  // Decide whether to block or flag
  const criticalCount = issues.filter((i) => i.severity === "critical").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;

  return {
    cleanedResponse,
    issues,
    confidenceScore,
    shouldBlock: criticalCount > 0,
    needsReview: warningCount > 0 || confidenceScore < 0.7,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Citation Validation — Semantic, not just regex
// ──────────────────────────────────────────────────────────────────────────

/**
 * Extract clause references from text.
 * Matches patterns like:
 *   - "AS/NZS 3000 Clause 2.3.2"
 *   - "Clause 4.10.3.2"
 *   - "AS 3600 Table 4.10.3.2"
 */
const CLAUSE_REGEX =
  /(?:AS|AS\/NZS)\s+\d+(?:\.\d+)*(?:\s+(?:Clause|Table|Section|Figure)\s+\d+(?:\.\d+)*)?|(?:Clause|Table|Section|Figure)\s+\d+(?:\.\d+)+/gi;

function validateCitations(
  response: string,
  chunks: Array<{ content: string }>
): { cleaned: string; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const citations = response.match(CLAUSE_REGEX) ?? [];
  const chunkText = chunks.map((c) => c.content).join("\n").toLowerCase();

  if (citations.length === 0) {
    issues.push({
      type: "no_citation",
      severity: "warning",
      detail: "Response contains no clause citation",
    });
    return { cleaned: response, issues };
  }

  let cleaned = response;

  for (const citation of citations) {
    // Extract just the clause number portion (e.g. "2.3.2" from "Clause 2.3.2")
    const numberMatch = citation.match(/\d+(?:\.\d+)+/);
    if (!numberMatch) continue;

    const clauseNumber = numberMatch[0];

    // Check if this clause number appears anywhere in the retrieved chunks
    if (!chunkText.includes(clauseNumber.toLowerCase())) {
      issues.push({
        type: "hallucinated_citation",
        severity: "warning",
        detail: `Citation "${citation}" not found in retrieved chunks`,
      });

      // Strip the hallucinated citation, replace with a safer note
      cleaned = cleaned.replace(
        citation,
        "[citation unavailable — check the standard directly]"
      );
    }
  }

  return { cleaned, issues };
}

// ──────────────────────────────────────────────────────────────────────────
// Safety Warning Check
// ──────────────────────────────────────────────────────────────────────────

const SAFETY_CRITICAL_KEYWORDS = [
  // Electrical
  "isolation", "live", "test", "earthing", "rcd", "shock", "electrocution",

  // Plumbing / Gas
  "gas", "pressure test", "backflow", "scalding", "hot water temp",

  // Mechanical
  "refrigerant", "fire damper", "confined space",

  // Structural
  "load", "span", "bearing", "reinforcement", "structural",

  // Building
  "formwork strip", "curing", "pour",

  // General
  "height", "fall", "confined", "hazard",
];

function checkSafetyWarnings(
  query: string,
  response: string,
  trade: TradeType
): { issues: ValidationIssue[]; updatedResponse?: string } {
  const issues: ValidationIssue[] = [];
  const lowerQuery = query.toLowerCase();
  const lowerResponse = response.toLowerCase();

  // Is this query safety-critical?
  const isSafetyCritical =
    trade === "structural" || // All structural is safety-critical
    SAFETY_CRITICAL_KEYWORDS.some(
      (kw) => lowerQuery.includes(kw) || lowerResponse.includes(kw)
    );

  if (!isSafetyCritical) {
    return { issues };
  }

  // Check if response already has a warning
  const hasWarning =
    response.includes("⚠️") ||
    response.toLowerCase().includes("warning") ||
    response.toLowerCase().includes("safety") ||
    response.toLowerCase().includes("verify on site");

  if (!hasWarning) {
    issues.push({
      type: "missing_safety_warning",
      severity: "warning",
      detail: "Safety-critical response missing ⚠️ warning",
    });

    // Auto-inject a warning
    const updatedResponse =
      response +
      "\n\n⚠️ This topic is safety-critical. Always verify on site against your specific installation and consult a licensed tradesperson or engineer for final compliance.";

    return { issues, updatedResponse };
  }

  return { issues };
}

// ──────────────────────────────────────────────────────────────────────────
// Grounding Check — Did the model use the chunks?
// ──────────────────────────────────────────────────────────────────────────

function checkGrounding(
  response: string,
  chunks: Array<{ content: string }>
): { issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];

  // If no chunks were retrieved, the response can't be grounded
  if (chunks.length === 0) {
    issues.push({
      type: "unverified_claim",
      severity: "critical",
      detail: "No chunks retrieved — response cannot be grounded in source material",
    });
    return { issues };
  }

  // Extract meaningful words from chunks (filter out common words)
  const chunkWords = new Set(
    chunks
      .map((c) => c.content.toLowerCase())
      .join(" ")
      .split(/\W+/)
      .filter((w) => w.length > 4)
  );

  // Extract meaningful words from response
  const responseWords = response
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 4);

  // What % of significant response words appear in the chunks?
  const overlapCount = responseWords.filter((w) => chunkWords.has(w)).length;
  const overlapRatio = responseWords.length > 0
    ? overlapCount / responseWords.length
    : 0;

  // If less than 20% of significant words match, response is likely hallucinated
  if (overlapRatio < 0.2 && responseWords.length > 30) {
    issues.push({
      type: "unverified_claim",
      severity: "warning",
      detail: `Low source grounding: only ${Math.round(overlapRatio * 100)}% of response terms appear in chunks`,
    });
  }

  return { issues };
}

// ──────────────────────────────────────────────────────────────────────────
// Confidence Scoring
// ──────────────────────────────────────────────────────────────────────────

function computeConfidence(issues: ValidationIssue[]): number {
  let score = 1.0;

  for (const issue of issues) {
    switch (issue.severity) {
      case "critical":
        score -= 0.5;
        break;
      case "warning":
        score -= 0.2;
        break;
      case "info":
        score -= 0.05;
        break;
    }
  }

  return Math.max(0, Math.min(1, score));
}
