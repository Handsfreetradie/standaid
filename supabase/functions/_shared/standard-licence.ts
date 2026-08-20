// Standards Australia's GTC clause 3.3 bans uploading, ingesting, indexing,
// embedding, or otherwise using their Standards content ("AS", "AS/NZS",
// "NZS" documents) with any AI/ML/LLM system. SA formally declined a
// licence/pilot for this on 2026-08-20 — there is no path to compliant AI
// use of their content right now.
//
// Deny-list: only AS / AS-NZS / NZS content is blocked from AI features —
// everything else (NCC, other trade docs, other standards bodies) is
// AI-eligible by default. This means anything ambiguous or blank now
// defaults to ALLOWED, not blocked — a deliberate call, since the upload
// disclaimer + licence-confirmation checkbox are the accepted safeguard for
// a user who mislabels an AS/NZS document. Case-insensitive, text-pattern
// match on free-text fields, so it's not bulletproof; keep an eye on newly
// allowed/blocked uploads.
const SA_STANDARD_PATTERN = new RegExp(
  [
    String.raw`\bAS\s*[\/\-]?\s*NZS\b`, // AS/NZS, AS-NZS, ASNZS, AS NZS
    String.raw`\bNZS\s*\d{2,6}(?:\.\d+)?\b`, // NZS 3604
    String.raw`\bAS\s*\d{2,6}(?:\.\d+)?\b`, // AS 3000, AS3000, AS 1170.1
    String.raw`australian\s*\/\s*new\s*zealand\s+standard`,
    String.raw`\baustralian\s+standard\b`,
    String.raw`\bnew\s+zealand\s+standard\b`,
    String.raw`standards\s+australia`,
    String.raw`standards\s+new\s+zealand`,
  ].join("|"),
  "i",
);

export function isAiAllowed(standardCode: string | null | undefined, title: string | null | undefined): boolean {
  const text = `${standardCode ?? ""} ${title ?? ""}`;
  return !SA_STANDARD_PATTERN.test(text);
}

// Call right after loading a standard row (needs standard_code + title) and
// before any extraction/OCR/embedding step. Returns true if the caller
// should stop — the standard has been marked ai_disabled and nothing should
// be sent to an AI/embedding API for it.
export async function blockIfNotAiAllowed(
  supabaseAdmin: { from: (table: string) => any },
  standard: { id: string; standard_code?: string | null; title?: string | null },
): Promise<boolean> {
  if (isAiAllowed(standard.standard_code, standard.title)) return false;

  await supabaseAdmin
    .from("standards")
    .update({ extraction_status: "ai_disabled" })
    .eq("id", standard.id);

  return true;
}
