// Standards Australia's GTC clause 3.3 bans uploading, ingesting, indexing,
// embedding, or otherwise using their Standards content ("AS", "AS/NZS",
// "NZS" documents) with any AI/ML/LLM system. SA formally declined a
// licence/pilot for this on 2026-08-20 — there is no path to compliant AI
// use of their content right now.
//
// Deny-by-default: a standard is only AI-eligible if its code/title clearly
// matches an allow-listed non-SA publisher. A false positive here just means
// a legitimate upload gets manually reviewed; a false negative is an actual
// licence breach — so anything ambiguous (including a blank standard_code)
// stays blocked. This is a text-pattern match on free-text fields, so it's
// not bulletproof; keep an eye on newly allowed/blocked uploads.
const ALLOWED_PUBLISHER_PATTERN =
  /\bNCC\b|national construction code|\bBCA\b|building code of australia/i;

export function isAiAllowed(standardCode: string | null | undefined, title: string | null | undefined): boolean {
  const text = `${standardCode ?? ""} ${title ?? ""}`;
  return ALLOWED_PUBLISHER_PATTERN.test(text);
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
