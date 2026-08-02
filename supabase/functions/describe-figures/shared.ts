import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";

// Shared by describe-figures (submits the primary-page batch) and
// poll-vision-batches (applies results + runs the retry/continuation tail).
// Kept byte-for-byte identical to the pre-batch synchronous implementation —
// this is the accuracy-critical path (table transcription), so nothing here
// should change behaviour, only how the request reaches Claude.

export interface WorkChunk {
  id: string;
  clause_number: string;
  clause_title: string | null;
  page_number: number | null;
  content: string;
  index_attempts: number | null;
}

export interface ItemInfo {
  isTable: boolean;
  kind: "Table" | "Figure";
  refNumber: string;
  caption: string;
  page: number;
}

export function deriveItemInfo(chunk: WorkChunk): ItemInfo {
  const isTable = chunk.clause_number.toUpperCase().startsWith("TABLE");
  return {
    isTable,
    kind: isTable ? "Table" : "Figure",
    refNumber: chunk.clause_number.replace(/^(FIGURE|TABLE)\s+/i, "").trim(),
    caption: chunk.clause_title || "",
    page: chunk.page_number || 1,
  };
}

// Postgres text columns reject the null byte outright (and other control
// characters can trip up storage/display), so a vision transcription that
// happens to include one fails the DB write with no visible symptom besides
// a logged error — which, combined with symbol-heavy engineering tables
// (degree signs, superscripts, OCR artifacts), is what silently broke a
// batch of table descriptions in production. Strip anything Postgres text
// can't hold before it's ever written.
export function sanitizeForPostgres(text: string): string {
  // Null byte (rejected outright by Postgres text columns) plus other C0
  // control characters, excluding tab/newline/carriage-return which are
  // legitimate in transcribed table text.
  // deno-lint-ignore no-control-regex
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

// Convert bytes to base64 in fixed slices. Spreading a whole file into
// String.fromCharCode(...bytes) overflows the call stack above ~125KB, which
// crashed this function on every real (multi-MB) standard.
export function toBase64(bytes: Uint8Array): string {
  const SLICE = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += SLICE) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + SLICE) as unknown as number[]);
  }
  return btoa(binary);
}

// Extract a single page as its own small PDF so each vision call carries one
// page (~tens of KB) instead of re-uploading the entire multi-MB document per
// figure — fixes both the crash and the per-figure cost blowout.
export async function extractPageBase64(srcDoc: PDFDocument, pageNumber: number): Promise<string | null> {
  try {
    const total = srcDoc.getPageCount();
    const idx = Math.min(Math.max(pageNumber - 1, 0), total - 1);
    const out = await PDFDocument.create();
    const [pg] = await out.copyPages(srcDoc, [idx]);
    out.addPage(pg);
    return toBase64(await out.save());
  } catch (e) {
    console.warn(`Could not extract page ${pageNumber}:`, e);
    return null;
  }
}

export function buildPrompt(
  isTable: boolean,
  standardLabel: string,
  refNumber: string,
  caption: string,
  page: number,
): string {
  const std = standardLabel !== "Unknown" ? standardLabel : "an Australian Standard";
  return isTable
    ? `This page is from ${std}. ` +
        `TABLE ${refNumber}${caption ? ` — ${caption}` : ""} appears on this page.\n\n` +
        `Transcribe that table COMPLETELY as a GitHub-flavoured markdown table:\n` +
        `- Keep the header rows exactly as printed, including units (mm², A, V, °C, m).\n` +
        `- Transcribe EVERY visible row and column — never summarise, skip rows, or round values.\n` +
        `- Copy every number exactly as printed, including decimal points.\n` +
        `- Include any notes printed below the table, after the table.\n` +
        `- If the table clearly continues on another page, transcribe what is visible and end with: (table continues on next page)\n` +
        `- If the table is not actually on this page, reply with exactly: TABLE NOT ON PAGE\n\n` +
        `Output ONLY the markdown table and its notes — no commentary.`
    : `You are helping Australian tradies understand diagrams from ${std}.\n\n` +
        `Figure ${refNumber}${caption ? ` — ${caption}` : ""} is on page ${page} of this document.\n\n` +
        `Describe this diagram for a tradie on the job:\n` +
        `1. What does this diagram show? (2-3 sentences, plain English)\n` +
        `2. What should a tradie look for when checking their installation against this diagram? (3-4 dot points)\n` +
        `3. Common mistakes or inspection points? (2-3 dot points)\n\n` +
        `Be practical. No jargon.`;
}

export function buildContinuationPrompt(standardLabel: string, refNumber: string): string {
  const std = standardLabel !== "Unknown" ? standardLabel : "an Australian Standard";
  return `This page continues TABLE ${refNumber} from the previous page of ${std}.\n\n` +
    `Transcribe ONLY the continuation of that table visible on this page as a GitHub-flavoured markdown table:\n` +
    `- Repeat the column header row so the columns are unambiguous.\n` +
    `- Copy every number exactly as printed, including decimal points.\n` +
    `- Include any notes printed below the table.\n` +
    `- If the table continues onto yet another page, end with: (table continues on next page)\n` +
    `- If this page does NOT continue the table, reply with exactly: TABLE NOT ON PAGE\n\n` +
    `Output ONLY the markdown table and its notes — no commentary.`;
}

// Same request shape used both for the direct /v1/messages fallback calls
// (retry/continuation tail) and as the `params` of a batch request.
export function buildVisionParams(pageBase64: string, prompt: string, isTable: boolean) {
  return {
    // Sonnet transcribes documents as accurately as Opus at ~1/5 the price —
    // the Opus vision run across two standards (~300 calls) drained the API
    // credit balance in one day.
    model: "claude-sonnet-4-6",
    // Big AS/NZS tables run to thousands of tokens; figures don't.
    max_tokens: isTable ? 4000 : 1000,
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: pageBase64 } },
          { type: "text", text: prompt },
        ],
      },
    ],
  };
}

// deno-lint-ignore no-explicit-any
export async function applyDescription(
  supabaseAdmin: any,
  args: {
    chunk: WorkChunk;
    description: string;
    isTable: boolean;
    refNumber: string;
    caption: string;
    label: string;
    usedPage: number;
    standard_id: string;
    user_id: string;
    organization_id: string | null;
  },
): Promise<void> {
  const { chunk, description, isTable, refNumber, caption, label, usedPage, standard_id, user_id, organization_id } = args;

  const newContent = sanitizeForPostgres(
    isTable
      ? `${label} Table ${refNumber}${caption ? `: ${caption}` : ""}\n\n${description}`
      : `${label} Figure ${refNumber}${caption ? ` — ${caption}` : ""}\n\n${description}`,
  );

  // Set is_indexed: true so re-triggered runs skip this item; correct the
  // page anchor if the table was found on the retry page.
  const { error: updateError } = await supabaseAdmin
    .from("standard_chunks")
    .update({ content: newContent, is_indexed: true, page_number: usedPage })
    .eq("id", chunk.id);

  if (updateError) {
    console.error(`Failed to update chunk for ${isTable ? "Table" : "Figure"} ${refNumber}:`, updateError);
    // Cap retries here too — Claude was already paid for this description;
    // without this, a chunk whose DB write keeps failing gets re-described
    // (re-billed) every retrigger forever.
    await supabaseAdmin
      .from("standard_chunks")
      .update({ index_attempts: (chunk.index_attempts || 0) + 1 })
      .eq("id", chunk.id);
    return;
  }

  // Register transcribed tables in standard_tables so query-time
  // "Table X" lookups resolve to a page. image_url is intentionally empty —
  // the chat falls back to the "Open Table X" PDF page link.
  if (isTable) {
    await supabaseAdmin.from("standard_tables")
      .delete()
      .eq("standard_id", standard_id)
      .eq("table_number", refNumber);
    const { error: tblInsertError } = await supabaseAdmin.from("standard_tables").insert({
      standard_id,
      user_id,
      organization_id: organization_id ?? null,
      table_number: refNumber,
      caption: caption || null,
      page_number: usedPage,
      image_url: "",
    });
    if (tblInsertError) console.error(`standard_tables insert failed for Table ${refNumber}:`, tblInsertError);
  }
}

export async function bumpAttempts(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
  chunkId: string,
  currentAttempts: number | null,
): Promise<void> {
  await supabaseAdmin
    .from("standard_chunks")
    .update({ index_attempts: (currentAttempts || 0) + 1 })
    .eq("id", chunkId);
}
