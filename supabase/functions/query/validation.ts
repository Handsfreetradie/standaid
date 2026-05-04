import type { TradeType } from "./system-prompt.ts";

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

function buildChunkClauseSet(chunks: Array<{ content: string }>): Set<string> {
  const numbers = new Set<string>();
  for (const chunk of chunks) {
    for (const match of chunk.content.matchAll(/\d+(?:\.\d+)+/g)) {
      numbers.add(match[0]);
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
  const citations = [
    ...(response.match(STANDARD_CLAUSE_REGEX) ?? []),
    ...(response.match(STANDALONE_CLAUSE_REGEX) ?? []),
  ];

  if (citations.length === 0) {
    issues.push({
      type: "no_citation",
      severity: "warning",
      detail: "Response contains no clause citation",
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
      cleaned = cleaned.replace(
        citation,
        "[citation unavailable — check the standard directly]",
      );
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
    issues.push({
      type: "missing_safety_warning",
      severity: "warning",
      detail: "Safety-critical response missing ⚠️ warning",
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

  if (overlapRatio < 0.2 && responseWords.length > 30) {
    issues.push({
      type: "unverified_claim",
      severity: "warning",
      detail: `Low source grounding: only ${Math.round(overlapRatio * 100)}% of response terms appear in chunks`,
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
