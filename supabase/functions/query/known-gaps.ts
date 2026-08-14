// Detects when a question is plausibly about a figure/table that permanently
// failed vision processing (exhausted its 3 retry attempts). Those chunks are
// correctly invisible to normal retrieval — embedding stays NULL, is_indexed
// stays false forever, no automatic path ever revisits them — so without
// this a question about exactly that content either gets a generic "couldn't
// find relevant content" refusal, or (if other evidence exists) an answer
// that simply never mentions the thing the user actually asked about.
//
// Deliberately strict: a false positive here means telling a user something
// failed when it didn't, which is worse than the current silence. Matching
// on an explicit "table 5.1"/"figure 3.2" reference is high-confidence.
// Matching on caption-word overlap requires most of the caption's distinctive
// words to actually appear in the question, not just one shared word.

export interface FailedItem {
  standard_id: string;
  clause_number: string | null;
  clause_title: string | null;
  page_number: number | null;
}

// Shared with the definitions-injection term extraction in index.ts (same
// stopword concept, same minimum word length) — kept here as the single
// source so the two don't drift into slightly different lists.
export const STOP_WORDS = new Set([
  "what", "which", "where", "does", "the", "and", "for", "are", "can", "how",
  "with", "from", "that", "this", "when", "must", "need", "should",
  "installation", "standard", "standards", "requirement", "requirements",
  "allowed", "required", "between", "there",
]);

export function extractSignificantTerms(text: string): Set<string> {
  const words = text.toLowerCase().match(/\b[a-z][a-z-]{3,}\b/g) || [];
  return new Set(words.filter((w) => !STOP_WORDS.has(w)));
}

// Extends the existing figure-only pattern (index.ts's preFigNums) to also
// catch "table" — letter prefix covers appendix items ("Table C1").
export function extractExplicitRefs(question: string): string[] {
  const matches = [...question.matchAll(/\b(?:fig(?:ure)?|table)s?\s+([A-Z]?\d+(?:\.\d+)*)\b/gi)];
  return matches.map((m) => m[1].toUpperCase());
}

// Confirmed live against Kyle's real AS/NZS 3000 data: several permanently-
// failed tables carry a clause_title that's an extraction artifact, not a
// real caption — ".", "]", "11S5 S3 S1", ">100>100>100>100>100" (numeric
// table headers mis-captured as the title during initial extraction).
// Requiring 3+ consecutive letters filters those out while still passing any
// real caption ("Minimum Size of Earthing Conductor"). Without this, the
// generated sentence read as visibly broken: "Table C1 — ] in AS/NZS 3000".
function hasRealCaption(title: string | null): title is string {
  return !!title && /[a-z]{3,}/i.test(title);
}

export function matchesFailedItem(
  item: FailedItem,
  questionTerms: Set<string>,
  explicitRefs: string[],
): boolean {
  const num = (item.clause_number || "").replace(/^(TABLE|FIGURE)\s+/i, "").toUpperCase();
  if (num && explicitRefs.includes(num)) return true;

  if (!hasRealCaption(item.clause_title)) return false;
  const titleTerms = extractSignificantTerms(item.clause_title);
  if (titleTerms.size === 0) return false;

  const shared = [...titleTerms].filter((t) => questionTerms.has(t));
  return shared.length >= Math.min(2, titleTerms.size) && shared.length / titleTerms.size >= 0.5;
}

export function describeFailedItem(
  item: FailedItem,
  standardLabel: string,
): { kind: "Table" | "Figure"; number: string; sentence: string } {
  const isTable = (item.clause_number || "").toUpperCase().startsWith("TABLE");
  const kind = isTable ? "Table" : "Figure";
  const number = (item.clause_number || "").replace(/^(TABLE|FIGURE)\s+/i, "");
  const caption = hasRealCaption(item.clause_title) ? ` — ${item.clause_title}` : "";
  const sentence =
    `This looks like it's about ${kind} ${number}${caption} in ${standardLabel}, but our system wasn't able ` +
    `to automatically read that ${isTable ? "table" : "diagram"} from your PDF. You can still view it directly below.`;
  return { kind, number, sentence };
}

// Mirrors the existing [FIGURE REFERENCE] context block shape (index.ts) —
// appended to the evidence bundle when other content also exists, so the
// model can mention the gap alongside whatever it does answer from.
export function buildKnownGapsContext(
  matches: FailedItem[],
  standardLabel: (standardId: string) => string,
): string {
  if (matches.length === 0) return "";
  const lines = matches.map((item) => {
    const isTable = (item.clause_number || "").toUpperCase().startsWith("TABLE");
    const kind = isTable ? "Table" : "Figure";
    const number = (item.clause_number || "").replace(/^(TABLE|FIGURE)\s+/i, "");
    const caption = hasRealCaption(item.clause_title) ? `: ${item.clause_title}` : "";
    return `${kind} ${number}${caption} (${standardLabel(item.standard_id)}) — could not be automatically extracted from the PDF.`;
  });
  return "\n\n[KNOWN GAPS — figures/tables that exist in the standard but permanently failed processing]\n" + lines.join("\n");
}
