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

const SCANNED_DOC_RATIO = 0.85;
// Memory guard for the >100-page pdf-lib slicing path only (whole-doc mode
// below is unaffected by byte size — it goes through the Files API). 25MB
// matches the whole-doc base64 fallback's already-proven-safe threshold a few
// lines below, which holds a larger in-memory footprint per byte (base64 is
// ~33% bigger than raw) than this raw-byte pdf-lib load — raising to match it
// isn't a new risk. The old 10MB value was an arbitrary conservative pick
// that rejected real standards (AS 3008 Parts 1/2 at 10.2MB) a hair over it.
const AI_EXTRACTION_SIZE_LIMIT = 25 * 1024 * 1024;

// Pages per OCR call. A dense standards page transcribes to ~600-1000 output
// tokens; 15 pages blew straight past the 8k max_tokens and later pages of
// every batch were silently cut off mid-sentence. 6 pages leaves headroom,
// and stop_reason is checked to catch truncation.
const PAGES_PER_AI_BATCH = 6;

// Anthropic Files API: upload the PDF once per OCR window and reference it by
// ID in every batch call instead of re-sending megabytes of base64 each time.
// This lifts the old 25MB whole-document cap — byte size stops mattering, only
// page count does — which is the practical unlock for high-resolution scans
// (they blow the byte caps long before the page caps). Every failure path
// falls back to the base64 flow, so this can only widen what's processable.
const FILES_API_BETA = "files-api-2025-04-14";

async function uploadPdfToFilesApi(fileBytes: Uint8Array, apiKey: string): Promise<string | null> {
  try {
    const form = new FormData();
    form.append("file", new Blob([fileBytes], { type: "application/pdf" }), "document.pdf");
    const res = await fetch("https://api.anthropic.com/v1/files", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-beta": FILES_API_BETA },
      body: form,
    });
    if (!res.ok) {
      console.warn(`Files API upload failed (${res.status}): ${await res.text()} — falling back to base64`);
      return null;
    }
    const data = await res.json();
    return (data?.id as string) || null;
  } catch (e) {
    console.warn("Files API upload error — falling back to base64:", e);
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

// Copy a page range into a fresh PDF so each OCR call only carries the pages it
// needs. Sending the whole document per batch both re-uploads megabytes every
// call and hits the API's 100-page-per-document limit on full standards.
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

// Batched page-by-page AI OCR — slices PAGES_PER_AI_BATCH pages per call so
// long documents are never truncated. Reads the PDF visually so special characters
// like Ω are transcribed correctly rather than corrupted by font encoding.
// Stops at `deadline` and returns what it has — partial text either passes the
// quality gate or gets rejected there with a clear message.
// Returns the transcribed text plus resume state: `nextPage` is the first
// page NOT yet transcribed (null when the whole document is done). The
// caller persists partial text + nextPage and retriggers itself — a scanned
// 60-page standard takes ~10 batches, far more than one function window.
async function extractTextWithAI(
  fileBytes: Uint8Array,
  anthropicApiKey: string,
  totalPages = 0,
  deadline = Number.POSITIVE_INFINITY,
  startPage = 1,
): Promise<{ text: string; nextPage: number | null; totalPages: number }> {
  let srcDoc: PDFDocument | null = null;
  try {
    srcDoc = await PDFDocument.load(fileBytes, { ignoreEncryption: true });
    if (totalPages === 0) totalPages = srcDoc.getPageCount();
  } catch (e) {
    console.warn("pdf-lib could not load document — OCR will send the whole file per batch:", e);
  }

  // Whole-document mode for PDFs within API limits (≤100 pages): pdf-lib
  // page slicing drops the page images of scanned documents entirely — the
  // model received near-blank pages (~220 chars/page came back for AS 3017's
  // scans). Sending the complete file preserves the scans; the prompt limits
  // which pages each call transcribes. Bigger page windows + a bigger output
  // budget keep the call count down since input is the whole doc each time.
  // Files API first (any byte size); base64 fallback keeps the old 25MB cap.
  const wholeDocEligible = totalPages > 0 && totalPages <= 100;
  const fileId = wholeDocEligible ? await uploadPdfToFilesApi(fileBytes, anthropicApiKey) : null;
  const useWholeDoc = fileId !== null || (wholeDocEligible && fileBytes.length <= 25 * 1024 * 1024);
  const pagesPerBatch = useWholeDoc ? 12 : PAGES_PER_AI_BATCH;
  const maxTokensPerBatch = useWholeDoc ? 16000 : 8000;

  const firstBatch = Math.floor((startPage - 1) / pagesPerBatch);
  const batchCount = totalPages > 0
    ? Math.ceil(totalPages / pagesPerBatch)
    : firstBatch + 1; // unknown page count — try single call

  const wholeDocBase64 = ((useWholeDoc && !fileId) || !srcDoc) ? convertPdfToBase64(fileBytes) : null;

  const transcriptionRules =
    `Include every clause number, heading, value, table, note, and figure caption exactly as written. ` +
    `Format: clause headings as "X.X HEADING TITLE" on their own line. ` +
    `Figure captions as "Figure X.X — Caption text" on their own line. ` +
    `Do NOT summarise, paraphrase, or skip any content. ` +
    `Pay special attention to numerical values and units (e.g. 0.5 Ω, 1 MΩ, 500 V).`;

  let fullText = "";
  let nextPage: number | null = null;

  for (let batch = firstBatch; batch < batchCount; batch++) {
    if (Date.now() > deadline) {
      nextPage = batch * pagesPerBatch + 1;
      console.warn(`AI OCR pausing at batch ${batch}/${batchCount} (page ${nextPage}) — time budget reached, will resume`);
      break;
    }

    const startPage = batch * pagesPerBatch + 1;
    const endPage = totalPages > 0
      ? Math.min((batch + 1) * pagesPerBatch, totalPages)
      : 9999;

    let docSource: Record<string, unknown>;
    let prompt: string;

    const sliced = !useWholeDoc && srcDoc && totalPages > 0 ? await slicePdfPages(srcDoc, startPage, endPage) : null;
    if (sliced) {
      docSource = { type: "base64", media_type: "application/pdf", data: convertPdfToBase64(sliced) };
      prompt =
        `This document contains pages ${startPage} to ${endPage} of an Australian/New Zealand technical Standards document. ` +
        `Transcribe ALL pages completely and accurately. ` +
        `Insert [PAGE N] at the start of each page using the ORIGINAL page numbers — the first page here is page ${startPage}. ` +
        transcriptionRules;
    } else {
      docSource = fileId
        ? { type: "file", file_id: fileId }
        : { type: "base64", media_type: "application/pdf", data: wholeDocBase64 ?? convertPdfToBase64(fileBytes) };
      prompt = totalPages > 0
        ? `This is an Australian/New Zealand technical Standards document. ` +
          `Transcribe ONLY pages ${startPage} to ${endPage} of the document (counting from the first page of the file as page 1) completely and accurately. ` +
          `Insert [PAGE N] at the start of each transcribed page, numbering from ${startPage}. ` + transcriptionRules
        : `This is an Australian/New Zealand technical Standards document. Transcribe ALL content completely and accurately. ` +
          `Insert [PAGE N] markers between pages. ` + transcriptionRules;
    }

    console.log(`AI OCR batch ${batch + 1}/${batchCount}: pages ${startPage}–${endPage}${sliced ? " (sliced)" : fileId ? " (whole doc via file)" : " (whole doc)"}`);

    const completionResponse = await fetch("https://api.anthropic.com/v1/messages", {
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
            // cache_control: batches 2..N send the IDENTICAL document (whole-
            // doc mode) — caching it cuts input cost ~90% for every batch
            // after the first. No-op for the sliced path (unique doc per call).
            { type: "document", source: docSource, cache_control: { type: "ephemeral" } },
            { type: "text", text: prompt },
          ],
        }],
      }),
    });

    if (!completionResponse.ok) {
      const errText = await completionResponse.text();
      console.error(`AI OCR batch ${batch + 1} failed:`, completionResponse.status, errText);
      if (batch === firstBatch && fullText.length === 0) {
        if (fileId) await deleteFilesApiFile(fileId, anthropicApiKey);
        throw new Error(`AI extraction failed: ${completionResponse.status}`);
      }
      // Transient failure mid-document — pause here and let the resume
      // retry this batch, instead of shipping a silently truncated document.
      nextPage = batch * pagesPerBatch + 1;
      break;
    }

    const data = await completionResponse.json();
    const batchText: string = data.content?.[0]?.text || "";
    if (data.stop_reason === "max_tokens") {
      console.warn(`AI OCR batch ${batch + 1} hit max_tokens — output may have lost the tail of page ${endPage}`);
    }
    if (batchText.length < 50) {
      console.warn(`AI OCR batch ${batch + 1} returned very little text — stopping`);
      nextPage = null; // nothing more to get (blank/failed pages are caught by the failure gate)
      break;
    }

    fullText += (fullText ? "\n\n" : "") + batchText;
    console.log(`Batch ${batch + 1} extracted: ${batchText.length} chars`);
  }

  // Each OCR window uploads its own copy, so delete it on the way out. A
  // crashed window can orphan one file at Anthropic — harmless, storage is
  // free — but the normal path stays tidy.
  if (fileId) await deleteFilesApiFile(fileId, anthropicApiKey);

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
  const ocrWholeDocEligible = pageTexts.length > 0 && pageTexts.length <= 100;
  if (fileBytes.length > AI_EXTRACTION_SIZE_LIMIT && !ocrWholeDocEligible) {
    throw new Error("This PDF is too big to OCR — scans over 25MB are only supported up to 100 pages. Try a digital copy of the standard.");
  }

  // Use batched page-by-page AI OCR so long documents aren't truncated.
  // Pass the known page count from unpdf so we can batch correctly.
  const knownPageCount = pageTexts.length > 0 ? pageTexts.length : 0;
  console.log(`Attempting batched AI OCR (${knownPageCount > 0 ? knownPageCount + " pages" : "unknown length"})${resume ? `, resuming at page ${resume.startPage}` : ""}...`);
  try {
    const { text: newText, nextPage, totalPages: realPages } = await extractTextWithAI(
      fileBytes, anthropicApiKey, knownPageCount, deadline, resume?.startPage ?? 1,
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
    throw new Error("Could not extract text from this PDF.");
  }
}
