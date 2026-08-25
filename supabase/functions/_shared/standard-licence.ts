// Standards Australia's GTC clause 3.3 purports to ban uploading, ingesting,
// indexing, embedding, or otherwise using their Standards content ("AS",
// "AS/NZS", "NZS" documents) with any AI/ML/LLM system. SA formally declined
// a licence/pilot for this on 2026-08-20.
//
// As of 2026-08-25 StandAId no longer enforces that as an app-level block —
// Kyle's call, repositioning the app as a general document search tool for
// tradies. Responsibility for having the right to upload and use a given
// document with AI now sits with the user, via the upload-time consent
// checkbox and the Terms of Service (see StandardsUpload.tsx and
// Legal.tsx), not a deny-list. This file is kept only so every ingestion
// pipeline that calls it doesn't need to change; both functions are
// permanently no-ops now.
export function isAiAllowed(_standardCode?: string | null, _title?: string | null): boolean {
  return true;
}

// Kept for compatibility with every pipeline that calls this right after
// loading a standard row and before extraction/OCR/embedding. Always
// returns false ("don't block") now.
export async function blockIfNotAiAllowed(
  _supabaseAdmin: { from: (table: string) => any },
  _standard: { id: string; standard_code?: string | null; title?: string | null },
): Promise<boolean> {
  return false;
}
