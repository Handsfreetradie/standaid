import type { TradeType } from "./system-prompt.ts";

export interface ValidationInput {
  response: string;
  chunks: Array<{ content: string; clause_number?: string | null; metadata?: Record<string, unknown> }>;
  query: string;
  trade: TradeType;
  // Clause numbers confirmed to exist in the user's uploaded standards (DB
  // lookup) — citations of these are never treated as hallucinated, even if
  // the retrieved chunks happen not to contain the number.
  knownClauseNumbers?: Set<string>;
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
  confidenceScore: number;
  shouldBlock: boolean;
  needsReview: boolean;
}

export function validateResponse(input: ValidationInput): ValidationResult {
  const issues: ValidationIssue[] = [];
  let cleanedResponse = input.response;

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

  // Derive shared chunk data once — passed to both citation and grounding checks
  const chunkClauseNumbers = buildChunkClauseSet(input.chunks);
  if (input.knownClauseNumbers) {
    for (const n of input.knownClauseNumbers) chunkClauseNumbers.add(n);
  }
  const chunkWords = buildChunkWordSet(input.chunks);

  const citationResult = validateCitations(input.response, input.chunks, chunkClauseNumbers);
  issues.push(...citationResult.issues);
  cleanedResponse = citationResult.cleaned;

  const safetyResult = checkSafetyWarnings(input.query, cleanedResponse, input.trade);
  issues.push(...safetyResult.issues);
  if (safetyResult.updatedResponse) {
    cleanedResponse = safetyResult.updatedResponse;
  }

  const groundingResult = checkGrounding(cleanedResponse, input.chunks, chunkWords);
  issues.push(...groundingResult.issues);

  const confidenceScore = computeConfidence(issues);
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

// Matches "AS/NZS 3000 Clause 2.3.2" or "AS 3000 Clause 2.3.2"
const STANDARD_CLAUSE_REGEX =
  /(?:AS|AS\/NZS)\s+\d+(?:\.\d+)*(?:\s+(?:Clause|Table|Section|Figure)\s+\d+(?:\.\d+)*)?/gi;

// Matches standalone "Clause 2.3.2" (must have at least one dot to avoid "Clause 2")
const STANDALONE_CLAUSE_REGEX =
  /(?:Clause|Table|Section|Figure)\s+\d+(?:\.\d+)+/gi;

const CLAUSE_NUMBER_REGEX = /\d+(?:\.\d+)+/;

function buildChunkClauseSet(
  chunks: Array<{ content: string; clause_number?: string | null }>,
): Set<string> {
  // Only genuine clause identifiers count: the chunk's own clause_number
  // metadata, and explicit "Clause/Table/Section/Figure X.X" mentions in the
  // text. Matching every bare dotted number let measurements whitelist
  // citations — "2.5 mm²" in any chunk legitimised a fabricated "Clause 2.5".
  const numbers = new Set<string>();
  for (const chunk of chunks) {
    const own = (chunk.clause_number || "").match(CLAUSE_NUMBER_REGEX);
    if (own) numbers.add(own[0]);
    for (const match of chunk.content.matchAll(
      /(?:Clause|Table|Section|Figure|Appendix)\s+([A-Z]?\d+(?:\.\d+)*)/gi,
    )) {
      numbers.add(match[1]);
    }
  }
  return numbers;
}

function buildChunkWordSet(chunks: Array<{ content: string }>): Set<string> {
  const words = new Set<string>();
  for (const chunk of chunks) {
    for (const word of chunk.content.toLowerCase().split(/\W+/)) {
      if (word.length > 4) words.add(word);
    }
  }
  return words;
}

function validateCitations(
  response: string,
  chunks: Array<{ content: string }>,
  chunkClauseNumbers: Set<string>,
): { cleaned: string; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  // Dedupe, then process longest matches first: "AS/NZS 3000 Table 8.1" must
  // be handled before its substring "Table 8.1" — replacing the short form
  // first sliced into the longer text and produced mangled output like
  // "AS/NZS 3ence." in answers.
  const citations = [...new Set([
    ...(response.match(STANDARD_CLAUSE_REGEX) ?? []),
    ...(response.match(STANDALONE_CLAUSE_REGEX) ?? []),
  ])].sort((a, b) => b.length - a.length);

  if (citations.length === 0) {
    // Info only — by design, clause numbers go in the citations metadata array,
    // not in the answer text. This is not a real problem.
    issues.push({
      type: "no_citation",
      severity: "info",
      detail: "Response contains no inline clause citation (expected — clauses go in metadata)",
    });
    return { cleaned: response, issues };
  }

  // No chunks means we can't verify citations — skip stripping to avoid false positives
  if (chunks.length === 0) {
    return { cleaned: response, issues };
  }

  let cleaned = response;

  for (const citation of citations) {
    const numberMatch = citation.match(CLAUSE_NUMBER_REGEX);
    if (!numberMatch) continue;

    if (!chunkClauseNumbers.has(numberMatch[0])) {
      issues.push({
        type: "hallucinated_citation",
        severity: "warning",
        detail: `Citation "${citation}" not found in retrieved chunks`,
      });
      // Replace with neutral wording — never the bracketed placeholder the
      // system prompt itself forbids ("AS/NZS 3000 Clause 2.5.1 requires…"
      // becomes "the standard requires…"). split/join replaces every
      // occurrence; single .replace() left later duplicates for shorter
      // patterns to slice into.
      cleaned = cleaned.split(citation).join("the standard");
    }
  }

  return { cleaned, issues };
}

const SAFETY_CRITICAL_KEYWORDS = [
  "isolation", "isolate", "live", "live work", "energised", "energized",
  "arc flash", "tag out", "tagout", "lock out", "lockout", "loto",
  "high voltage", " hv ", "switchgear", "substation",
  "test", "earthing", "rcd", "shock", "electrocution",
  "gas", "pressure test", "backflow", "scalding", "hot water temp",
  "refrigerant", "fire damper", "confined space",
  "load", "span", "bearing", "reinforcement", "structural",
  "formwork strip", "curing", "pour",
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

  const isSafetyCritical =
    trade === "structural" ||
    SAFETY_CRITICAL_KEYWORDS.some(
      (kw) => lowerQuery.includes(kw) || lowerResponse.includes(kw)
    );

  if (!isSafetyCritical) return { issues };

  const hasWarning =
    response.includes("⚠️") ||
    lowerResponse.includes("warning") ||
    lowerResponse.includes("safety") ||
    lowerResponse.includes("verify on site");

  if (!hasWarning) {
    // We APPEND the warning ourselves right here — the issue is corrected,
    // so it's informational. Counting it as a warning pushed needs_review on
    // half of all safety-topic answers whose content was fully correct.
    issues.push({
      type: "missing_safety_warning",
      severity: "info",
      detail: "Safety-critical response missing ⚠️ warning — warning appended automatically",
    });
    const updatedResponse =
      response +
      "\n\n⚠️ This topic is safety-critical. Always verify on site against your specific installation and consult a licensed tradesperson or engineer for final compliance.";
    return { issues, updatedResponse };
  }

  return { issues };
}

function checkGrounding(
  response: string,
  chunks: Array<{ content: string }>,
  chunkWords: Set<string>,
): { issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];

  if (chunks.length === 0) {
    // Downgrade to warning: casual questions legitimately have no chunks
    issues.push({
      type: "unverified_claim",
      severity: "warning",
      detail: "No chunks retrieved — response based on general knowledge only",
    });
    return { issues };
  }

  const responseWords = response
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 4);

  const overlapCount = responseWords.filter((w) => chunkWords.has(w)).length;
  const overlapRatio = responseWords.length > 0 ? overlapCount / responseWords.length : 0;

  // Plain-English answers naturally use different vocabulary to formal standards text,
  // so the overlap threshold is intentionally low. Only flag if truly negligible.
  if (overlapRatio < 0.08 && responseWords.length > 30) {
    issues.push({
      type: "unverified_claim",
      severity: "warning",
      detail: `Very low source grounding: only ${Math.round(overlapRatio * 100)}% of response terms appear in chunks`,
    });
  }

  return { issues };
}

function computeConfidence(issues: ValidationIssue[]): number {
  let score = 1.0;
  for (const issue of issues) {
    switch (issue.severity) {
      case "critical": score -= 0.5; break;
      case "warning":  score -= 0.2; break;
      case "info":     score -= 0.05; break;
    }
  }
  return Math.max(0, Math.min(1, score));
}
