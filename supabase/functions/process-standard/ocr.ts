// PDF text extraction (unpdf + AI OCR fallback). Split out of index.ts so
// reprocess-standard can re-extract text from a stored PDF without importing
// index.ts itself (which calls serve() at module load and would start a
// second HTTP listener).
import { extractText } from "https://esm.sh/unpdf@0.12.0";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";
import {
  SCANNED_PAGE_THRESHOLD,
  hasGoodTextQuality,
  convertPdfToBase64,
} from "./extraction.ts";
import { logTokenUsage } from "../_shared/log-usage.ts";

// Exported so recover-page-gap can reuse this verbatim when re-transcribing
// a single recovered page — it must format identically to normal OCR output
// (e.g. a real "TABLE X.X" caption line) or extractTableChunks/etc. won't
// classify it correctly.
export const transcriptionRules =
  `Include every clause number, heading, value, table, note, and figure caption exactly as written. ` +
  `Format: clause headings as "X.X HEADING TITLE" on their own line. ` +
  `Figure captions as "Figure X.X — Caption text" on their own line. ` +
  `Do NOT summarise, paraphrase, or skip any content. ` +
  `Pay special attention to numerical values and units (e.g. 0.5 Ω, 1 MΩ, 500 V).`;

const SCANNED_DOC_RATIO = 0.85;
// Memory guard for the pdf-lib slicing path only (whole-doc mode below is
// unaffected by byte size — it goes through the Files API). 25MB matches the
// whole-doc base64 fallback's already-proven-safe threshold a few lines below,
// which holds a larger in-memory footprint per byte (base64 is ~33% bigger
// than raw) than this raw-byte pdf-lib load — raising to match it isn't a new
// risk. The old 10MB value was an arbitrary conservative pick that rejected
// real standards (AS 3008 Parts 1/2 at 10.2MB) a hair over it.
const AI_EXTRACTION_SIZE_LIMIT = 25 * 1024 * 1024;

// This is Claude's actual page limit for a single PDF document block on a
// 1M-token-context model (docs.claude.com/en/docs/build-with-claude/pdf-support)
// — not a tunable knob. A document over this (e.g. the 611-page Wiring Rules)
// can't be sent as one PDF at all; it's split into consecutive ≤600-page
// PARTS instead (see extractTextWithAI below), each uploaded and OCR'd as its
// own self-contained whole document, then joined with page numbers corrected
// back to the real document afterwards.
const WHOLE_DOC_MAX_PAGES = 600;

// Anthropic Files API: upload the PDF once per OCR window and reference it by
// ID in every batch call instead of re-sending megabytes of base64 each time.
// This lifts the old 25MB whole-document cap — byte size stops mattering, only
// page count does — which is the practical unlock for high-resolution scans
// (they blow the byte caps long before the page caps). Every failure path
// falls back to the base64 flow, so this can only widen what's processable.
const FILES_API_BETA = "files-api-2025-04-14";

// A hung fetch() blocks the whole function indefinitely — JS is single-
// threaded, so our own `Date.now() > deadline` checks elsewhere in this file
// only run BETWEEN awaits, never during one. Without this, a slow upload or
// completion call runs past our soft deadline with zero chance to react, and
// eventually gets killed by the platform's own hard limit instead — losing
// the checkpoint-and-retrigger step entirely and leaving the job stuck at
// "processing" with a frozen heartbeat (confirmed live on AS 3008 Part 2's
// 10.2MB/148-page upload). Every deadline-aware fetch in this file goes
// through this so a slow call always returns control to us in time to
// checkpoint, rather than possibly never returning at all.
async function fetchWithDeadline(url: string, options: RequestInit, deadline: number): Promise<Response> {
  const budgetMs = Math.max(3000, deadline - Date.now() - 5000); // 5s margin to still checkpoint after abort
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budgetMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function uploadPdfToFilesApi(fileBytes: Uint8Array, apiKey: string, deadline: number): Promise<string | null> {
  try {
    const form = new FormData();
    form.append("file", new Blob([fileBytes], { type: "application/pdf" }), "document.pdf");
    const res = await fetchWithDeadline("https://api.anthropic.com/v1/files", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-beta": FILES_API_BETA },
      body: form,
    }, deadline);
    if (!res.ok) {
      console.warn(`Files API upload failed (${res.status}): ${await res.text()} — falling back to base64`);
      return null;
    }
    const data = await res.json();
    return (data?.id as string) || null;
  } catch (e) {
    console.warn("Files API upload error or timeout — falling back to base64:", e);
    return null;
  }
}

async function deleteFilesApiFile(fileId: string, apiKey: string): Promise<void> {
  try {
    await fetch(`https://api.anthropic.com/v1/files/${fileId}`, {
      method: "DELETE",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-beta": FILES_API_BETA },
    });
  } catch (e) {
    console.warn(`Failed to delete Files API file ${fileId}:`, e);
  }
}

// Copy a page range into a fresh PDF. Used once per PART (≤600 pages) when a
// document exceeds WHOLE_DOC_MAX_PAGES — not per OCR batch — since a document
// within the limit is sent completely untouched (see extractTextWithAI).
async function slicePdfPages(srcDoc: PDFDocument, startPage: number, endPage: number): Promise<Uint8Array | null> {
  try {
    const out = await PDFDocument.create();
    const lastPage = Math.min(endPage, srcDoc.getPageCount());
    const indices: number[] = [];
    for (let p = startPage - 1; p < lastPage; p++) indices.push(p);
    if (indices.length === 0) return null;
    const pages = await out.copyPages(srcDoc, indices);
    for (const pg of pages) out.addPage(pg);
    return await out.save();
  } catch (e) {
    console.warn(`PDF slice ${startPage}–${endPage} failed, falling back to whole document:`, e);
    return null;
  }
}

type PartOcrResult = {
  text: string;
  // "complete": every batch in this part finished — caller moves to the next
  // part. "paused": the deadline was hit — caller stops entirely and resumes
  // here next invocation. "stopped": the model returned near-nothing for a
  // batch (blank/failed pages) — caller gives up on this part but still
  // tries any remaining parts, since they're independent files.
  status: "complete" | "paused" | "stopped";
  nextPage: number | null; // LOCAL page number (1-based within this call's byte range); only set when status === "paused"
  fileId: string | null;
};

// Runs the whole-document OCR loop against a byte range that is a complete,
// self-contained document as far as the model and Files API are concerned —
// every page number here is LOCAL (1..localTotalPages), never the real
// document's page number. The caller (extractTextWithAI) offsets these back
// when this byte range is a slice of a larger document.
//
// `hasAnyTextYet` tells this call whether an EARLIER part in the same
// invocation already produced real text — if so, a failure on this part's
// very first batch is treated as a pause (so already-gathered text isn't
// thrown away), not a hard failure.
async function runWholeDocBatchOcr(
  docBytes: Uint8Array,
  localTotalPages: number,
  anthropicApiKey: string,
  deadline: number,
  localStartPage: number,
  hasAnyTextYet: boolean,
  usageLogger?: { supabaseAdmin: any; userId: string; standardId: string },
  logLabel?: string,
): Promise<PartOcrResult> {
  // Files API first (any byte size, and this is always page-limit-eligible
  // by construction — every part is ≤ WHOLE_DOC_MAX_PAGES); base64 fallback
  // keeps the old 25MB cap.
  const wholeDocEligible = localTotalPages > 0 && localTotalPages <= WHOLE_DOC_MAX_PAGES;
  const fileId = wholeDocEligible ? await uploadPdfToFilesApi(docBytes, anthropicApiKey, deadline) : null;
  if (!fileId && docBytes.length > 25 * 1024 * 1024) {
    throw new Error("This PDF is too big to OCR without the Files API — try again shortly.");
  }
  const docBase64 = !fileId ? convertPdfToBase64(docBytes) : null;

  const pagesPerBatch = 12;
  const maxTokensPerBatch = 16000;

  const firstBatch = Math.floor((localStartPage - 1) / pagesPerBatch);
  const batchCount = localTotalPages > 0
    ? Math.ceil(localTotalPages / pagesPerBatch)
    : firstBatch + 1; // unknown page count — try single call

  const label = logLabel ? ` ${logLabel}` : "";
  let fullText = "";

  for (let batch = firstBatch; batch < batchCount; batch++) {
    if (Date.now() > deadline) {
      console.warn(`AI OCR${label} pausing at batch ${batch}/${batchCount} — time budget reached, will resume`);
      return { text: fullText, status: "paused", nextPage: batch * pagesPerBatch + 1, fileId };
    }

    const startPage = batch * pagesPerBatch + 1;
    const endPage = localTotalPages > 0 ? Math.min((batch + 1) * pagesPerBatch, localTotalPages) : 9999;

    const docSource = fileId
      ? { type: "file", file_id: fileId }
      : { type: "base64", media_type: "application/pdf", data: docBase64 ?? convertPdfToBase64(docBytes) };
    const prompt = localTotalPages > 0
      ? `This is an Australian/New Zealand technical Standards document. ` +
        `Transcribe ONLY pages ${startPage} to ${endPage} of the document (counting from the first page of the file as page 1) completely and accurately. ` +
        `Insert [PAGE N] at the start of each transcribed page, numbering from ${startPage}. ` + transcriptionRules
      : `This is an Australian/New Zealand technical Standards document. Transcribe ALL content completely and accurately. ` +
        `Insert [PAGE N] markers between pages. ` + transcriptionRules;

    console.log(`AI OCR${label} batch ${batch + 1}/${batchCount}: pages ${startPage}–${endPage}${fileId ? " (whole doc via file)" : " (whole doc)"}`);

    let completionResponse: Response;
    try {
      completionResponse = await fetchWithDeadline("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": anthropicApiKey,
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
          ...(fileId ? { "anthropic-beta": FILES_API_BETA } : {}),
        },
        body: JSON.stringify({
          // Sonnet matches Opus on straight page transcription at ~1/5 the cost
          model: "claude-sonnet-4-6",
          max_tokens: maxTokensPerBatch,
          messages: [{
            role: "user",
            content: [
              // cache_control: batches 2..N send the IDENTICAL document —
              // caching it cuts input cost ~90% for every batch after the first.
              { type: "document", source: docSource, cache_control: { type: "ephemeral" } },
              { type: "text", text: prompt },
            ],
          }],
        }),
      }, deadline);
    } catch (e) {
      // Timed out (or genuinely errored) before Anthropic responded at all —
      // same recovery as an HTTP-level failure: pause and let resume retry
      // this exact batch, rather than let the whole function hang until the
      // platform kills it with no checkpoint written.
      console.warn(`AI OCR${label} batch ${batch + 1} fetch failed/timed out:`, e);
      if (batch === firstBatch && fullText.length === 0 && !hasAnyTextYet) {
        if (fileId) await deleteFilesApiFile(fileId, anthropicApiKey);
        throw new Error("AI extraction failed: request timed out before a response was received.");
      }
      return { text: fullText, status: "paused", nextPage: batch * pagesPerBatch + 1, fileId };
    }

    if (!completionResponse.ok) {
      const errText = await completionResponse.text();
      console.error(`AI OCR${label} batch ${batch + 1} failed:`, completionResponse.status, errText);
      if (batch === firstBatch && fullText.length === 0 && !hasAnyTextYet) {
        if (fileId) await deleteFilesApiFile(fileId, anthropicApiKey);
        throw new Error(`AI extraction failed: ${completionResponse.status}`);
      }
      // Transient failure mid-document — pause here and let the resume
      // retry this batch, instead of shipping a silently truncated document.
      return { text: fullText, status: "paused", nextPage: batch * pagesPerBatch + 1, fileId };
    }

    const data = await completionResponse.json();
    if (data.usage && usageLogger) {
      logTokenUsage(usageLogger.supabaseAdmin, {
        userId: usageLogger.userId, kind: "ocr", model: "claude-sonnet-4-6", refId: usageLogger.standardId,
        usage: {
          input_tokens: data.usage.input_tokens ?? 0,
          output_tokens: data.usage.output_tokens ?? 0,
          cache_read_tokens: data.usage.cache_read_input_tokens ?? 0,
          cache_creation_tokens: data.usage.cache_creation_input_tokens ?? 0,
        },
      });
    }
    const batchText: string = data.content?.[0]?.text || "";
    if (data.stop_reason === "max_tokens") {
      console.warn(`AI OCR${label} batch ${batch + 1} hit max_tokens — output may have lost the tail of page ${endPage}`);
    }
    if (batchText.length < 50) {
      console.warn(`AI OCR${label} batch ${batch + 1} returned very little text — stopping`);
      return { text: fullText, status: "stopped", nextPage: null, fileId };
    }

    fullText += (fullText ? "\n\n" : "") + batchText;
    console.log(`${logLabel ? `${logLabel} ` : ""}Batch ${batch + 1} extracted: ${batchText.length} chars`);
  }

  return { text: fullText, status: "complete", nextPage: null, fileId };
}

// Reads the PDF visually so special characters like Ω are transcribed
// correctly rather than corrupted by font encoding. Stops at `deadline` and
// returns what it has — partial text either passes the quality gate or gets
// rejected there with a clear message.
// Returns the transcribed text plus resume state: `nextPage` is the first
// page NOT yet transcribed, in the FULL document's page numbering (null when
// the whole document is done). The caller persists partial text + nextPage
// and retriggers itself — a scanned 60-page standard takes ~10 batches, far
// more than one function window.
//
// Documents within WHOLE_DOC_MAX_PAGES are sent completely untouched, in one
// piece, exactly as before. A document over that limit is split into
// consecutive ≤WHOLE_DOC_MAX_PAGES-page PARTS — each pdf-lib-sliced out ONCE
// and OCR'd as its own self-contained document (its own pages numbered
// 1..N — no special "what's the real page number" prompting). The [PAGE N]
// markers in every part after the first are then shifted up by that part's
// offset in plain code before the parts are joined. This replaces slicing
// every individual 6-page batch (~100 pdf-lib rebuilds for a 611-page
// document): pdf-lib's page copy can drop embedded page images on scanned
// documents, so cutting the rebuild count from ~100 down to 2 for a document
// this size meaningfully lowers (without eliminating) the odds of hitting
// that on any given page.
async function extractTextWithAI(
  fileBytes: Uint8Array,
  anthropicApiKey: string,
  totalPages = 0,
  deadline = Number.POSITIVE_INFINITY,
  startPage = 1,
  usageLogger?: { supabaseAdmin: any; userId: string; standardId: string },
): Promise<{ text: string; nextPage: number | null; totalPages: number }> {
  let srcDoc: PDFDocument | null = null;
  try {
    srcDoc = await PDFDocument.load(fileBytes, { ignoreEncryption: true });
    if (totalPages === 0) totalPages = srcDoc.getPageCount();
  } catch (e) {
    console.warn("pdf-lib could not load document — OCR will send the whole file as a single part:", e);
  }

  const canSplitIntoParts = !!srcDoc && totalPages > 0;
  const numParts = canSplitIntoParts ? Math.ceil(totalPages / WHOLE_DOC_MAX_PAGES) : 1;
  const startPart = canSplitIntoParts ? Math.floor((startPage - 1) / WHOLE_DOC_MAX_PAGES) : 0;

  let fullText = "";
  let nextPage: number | null = null;
  const uploadedFileIds: string[] = [];

  for (let part = startPart; part < numParts; part++) {
    const partStart = canSplitIntoParts ? part * WHOLE_DOC_MAX_PAGES + 1 : 1;
    const partEnd = canSplitIntoParts ? Math.min((part + 1) * WHOLE_DOC_MAX_PAGES, totalPages) : 0;
    const partTotalPages = canSplitIntoParts ? (partEnd - partStart + 1) : 0;
    const offset = partStart - 1; // added to every LOCAL page number this part reports

    // Only rebuild via pdf-lib when the document needs more than one part —
    // the common case (≤ WHOLE_DOC_MAX_PAGES pages) sends the real,
    // untouched file, exactly as before.
    let partBytes = fileBytes;
    if (numParts > 1 && srcDoc) {
      const slicedPart = await slicePdfPages(srcDoc, partStart, partEnd);
      if (!slicedPart) break; // slicing failed — stop with whatever we have; the outer failure gate catches a too-short result
      partBytes = slicedPart;
    }

    const localStartPage = part === startPart ? Math.max(1, startPage - offset) : 1;

    const result = await runWholeDocBatchOcr(
      partBytes,
      partTotalPages,
      anthropicApiKey,
      deadline,
      localStartPage,
      fullText.length > 0,
      usageLogger,
      numParts > 1 ? `part ${part + 1}/${numParts}` : undefined,
    );

    if (result.fileId) uploadedFileIds.push(result.fileId);

    const shiftedText = offset > 0
      ? result.text.replace(/\[PAGE\s+(\d+)\]/gi, (_m, n) => `[PAGE ${parseInt(n, 10) + offset}]`)
      : result.text;
    fullText += (fullText ? "\n\n" : "") + shiftedText;

    if (result.status === "paused") {
      nextPage = (result.nextPage as number) + offset;
      break;
    }
    // "stopped": give up on this part but still try any remaining parts —
    // they're independent files, so one part's blank pages don't imply the
    // next part has the same problem. "complete": just move on.
  }

  // Each part uploads its own copy, so delete them all on the way out. A
  // crashed window can orphan a file at Anthropic — harmless, storage is
  // free — but the normal path stays tidy.
  for (const id of uploadedFileIds) await deleteFilesApiFile(id, anthropicApiKey);

  console.log(`AI OCR run: ${fullText.length} chars, nextPage=${nextPage ?? "done"}`);
  return { text: fullText, nextPage, totalPages };
}

export type ExtractionOutcome =
  | { done: true; text: string; rawText: string; pages: string[]; totalPages: number; pagesWithContent: number }
  | { done: false; ocrText: string; nextPage: number };

export async function extractTextFromPdf(
  fileBytes: Uint8Array,
  anthropicApiKey: string,
  deadline: number,
  resume?: { priorText: string; startPage: number },
  usageLogger?: { supabaseAdmin: any; userId: string; standardId: string },
): Promise<ExtractionOutcome> {
  // Use unpdf to extract text page-by-page
  let pageTexts: string[] = [];
  let unpdfFailed = false;

  try {
    const result = await extractText(fileBytes, { mergePages: false });
    // unpdf returns { text: string[] } when mergePages is false
    pageTexts = Array.isArray(result.text) ? result.text : [result.text as unknown as string];
    console.log(`unpdf extracted ${pageTexts.length} pages`);
  } catch (e) {
    console.error("unpdf extraction failed:", e);
    unpdfFailed = true;
  }

  const totalPages = pageTexts.length || 1;

  // A resume run is by definition mid-OCR — don't re-evaluate the unpdf path
  if (!resume && !unpdfFailed && pageTexts.length > 0) {
    // Assess how many pages have real content
    const scannedPages: number[] = [];
    const contentPages: number[] = [];

    pageTexts.forEach((pageText, idx) => {
      if (pageText.trim().length < SCANNED_PAGE_THRESHOLD) {
        scannedPages.push(idx);
      } else {
        contentPages.push(idx);
      }
    });

    const scannedRatio = scannedPages.length / totalPages;
    console.log(`Pages: ${totalPages} total, ${contentPages.length} with content, ${scannedPages.length} scanned (ratio: ${scannedRatio.toFixed(2)})`);

    if (scannedRatio <= SCANNED_DOC_RATIO) {
      // Mostly digital PDF — check text quality before accepting unpdf output
      const pages = pageTexts.map((t) => (t.trim().length > 0 ? t : ""));
      const fullText = pages
        .map((t, i) => (t.trim().length > 0 ? `\n[PAGE ${i + 1}]\n${t}` : ""))
        .join("")
        .trim();

      if (hasGoodTextQuality(fullText)) {
        console.log(`unpdf result accepted: ${fullText.length} chars, ${contentPages.length}/${totalPages} pages with content`);
        return {
          done: true,
          text: fullText,
          rawText: fullText,
          pages,
          totalPages,
          pagesWithContent: contentPages.length,
        };
      }

      console.log(`unpdf text quality check failed (likely SAI Global font encoding issue) — falling back to AI OCR`);
    } else {
      console.log(`Scanned document (${Math.round(scannedRatio * 100)}% pages below threshold), falling back to AI OCR`);
    }
  }

  // Only try AI OCR if unpdf failed or produced corrupted text.
  // Byte size only matters for documents that need pdf-lib page slicing
  // (>100 pages) — the cap protects that path's memory. Documents within the
  // whole-document window go through the Files API regardless of size.
  const ocrWholeDocEligible = pageTexts.length > 0 && pageTexts.length <= WHOLE_DOC_MAX_PAGES;
  if (fileBytes.length > AI_EXTRACTION_SIZE_LIMIT && !ocrWholeDocEligible) {
    throw new Error("This PDF is too big to OCR — scans over 25MB are only supported up to 100 pages. Try a digital copy of the standard.");
  }

  // Use batched page-by-page AI OCR so long documents aren't truncated.
  // Pass the known page count from unpdf so we can batch correctly.
  const knownPageCount = pageTexts.length > 0 ? pageTexts.length : 0;
  console.log(`Attempting batched AI OCR (${knownPageCount > 0 ? knownPageCount + " pages" : "unknown length"})${resume ? `, resuming at page ${resume.startPage}` : ""}...`);
  try {
    const { text: newText, nextPage, totalPages: realPages } = await extractTextWithAI(
      fileBytes, anthropicApiKey, knownPageCount, deadline, resume?.startPage ?? 1, usageLogger,
    );
    const aiText = resume?.priorText ? `${resume.priorText}\n\n${newText}` : newText;

    // More pages to go — hand resume state back so the caller persists it
    // and retriggers. Never report a partial document as complete.
    if (nextPage !== null) {
      return { done: false, ocrText: aiText, nextPage };
    }

    if (aiText.length < 50) throw new Error("AI extraction returned insufficient text");
    console.log(`Batched AI OCR complete: ${aiText.length} chars`);

    // Rebuild pages by their ORIGINAL numbers from the [PAGE N] markers.
    // Index-based splitting renumbered everything when front pages were
    // blank, and reported only the transcribed count as totalPages — a
    // deadline-cut extraction of 8/57 pages scored 97% coverage.
    const parts = aiText.split(/\[PAGE\s+(\d+)\]/i);
    const pageMap = new Map<number, string>();
    for (let i = 1; i < parts.length; i += 2) {
      const n = parseInt(parts[i], 10);
      const txt = (parts[i + 1] || "").trim();
      if (n > 0 && txt) pageMap.set(n, pageMap.has(n) ? `${pageMap.get(n)}\n${txt}` : txt);
    }
    const maxPage = Math.max(realPages || 0, knownPageCount, ...(pageMap.size > 0 ? [...pageMap.keys()] : [1]));
    const pages = Array.from({ length: maxPage }, (_, i) => pageMap.get(i + 1) || "");
    return {
      done: true,
      text: aiText.replace(/\[PAGE\s+\d+\]/gi, "\n\n").trim(),
      rawText: aiText,
      pages,
      totalPages: maxPage,
      pagesWithContent: pages.filter(p => p.trim().length >= SCANNED_PAGE_THRESHOLD).length,
    };
  } catch (aiError) {
    console.error("Batched AI OCR failed:", aiError);
    // This used to discard the real cause behind a generic message, which
    // masked a genuine bug during live debugging (AS 3008 Part 2 failed with
    // "Could not extract text from this PDF" and no way to tell why without
    // adding throwaway diagnostics). Surfacing the underlying reason costs
    // nothing and saves exactly that debugging cycle next time.
    const reason = aiError instanceof Error ? aiError.message : String(aiError);
    throw new Error(`Could not extract text from this PDF: ${reason}`);
  }
}
