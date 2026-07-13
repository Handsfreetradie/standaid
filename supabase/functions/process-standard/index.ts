import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractText } from "https://esm.sh/unpdf@0.12.0";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";
import { getAllowedOrigin } from "../_shared/cors.ts";
import {
  type Chunk,
  SCANNED_PAGE_THRESHOLD,
  hasGoodTextQuality,
  computeQualityScore,
  parseExtractedText,
  convertPdfToBase64,
  sortIntoSections,
  chunkSections,
  extractTableChunks,
  extractFigureChunks,
} from "./extraction.ts";

const SCANNED_DOC_RATIO = 0.85;
const AI_EXTRACTION_SIZE_LIMIT = 10 * 1024 * 1024;

// Mark jobs as failed if processing exceeds this — must be under Supabase's 150s limit.
const PROCESSING_TIMEOUT_MS = 110_000;

// ── PDF extraction ───────────────────────────────────────────────────────────

// Pages per OCR call. A dense standards page transcribes to ~600-1000 output
// tokens; 15 pages blew straight past the 8k max_tokens and later pages of
// every batch were silently cut off mid-sentence. 6 pages leaves headroom,
// and stop_reason is checked to catch truncation.
const PAGES_PER_AI_BATCH = 6;

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
  const useWholeDoc = totalPages > 0 && totalPages <= 100 && fileBytes.length <= 25 * 1024 * 1024;
  const pagesPerBatch = useWholeDoc ? 12 : PAGES_PER_AI_BATCH;
  const maxTokensPerBatch = useWholeDoc ? 16000 : 8000;

  const firstBatch = Math.floor((startPage - 1) / pagesPerBatch);
  const batchCount = totalPages > 0
    ? Math.ceil(totalPages / pagesPerBatch)
    : firstBatch + 1; // unknown page count — try single call

  const wholeDocBase64 = (useWholeDoc || !srcDoc) ? convertPdfToBase64(fileBytes) : null;

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

    let base64Pdf: string;
    let prompt: string;

    const sliced = !useWholeDoc && srcDoc && totalPages > 0 ? await slicePdfPages(srcDoc, startPage, endPage) : null;
    if (sliced) {
      base64Pdf = convertPdfToBase64(sliced);
      prompt =
        `This document contains pages ${startPage} to ${endPage} of an Australian/New Zealand technical Standards document. ` +
        `Transcribe ALL pages completely and accurately. ` +
        `Insert [PAGE N] at the start of each page using the ORIGINAL page numbers — the first page here is page ${startPage}. ` +
        transcriptionRules;
    } else {
      base64Pdf = wholeDocBase64 ?? convertPdfToBase64(fileBytes);
      prompt = totalPages > 0
        ? `This is an Australian/New Zealand technical Standards document. ` +
          `Transcribe ONLY pages ${startPage} to ${endPage} of the document (counting from the first page of the file as page 1) completely and accurately. ` +
          `Insert [PAGE N] at the start of each transcribed page, numbering from ${startPage}. ` + transcriptionRules
        : `This is an Australian/New Zealand technical Standards document. Transcribe ALL content completely and accurately. ` +
          `Insert [PAGE N] markers between pages. ` + transcriptionRules;
    }

    console.log(`AI OCR batch ${batch + 1}/${batchCount}: pages ${startPage}–${endPage}${sliced ? " (sliced)" : " (whole doc)"}`);

    const completionResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": anthropicApiKey, "Content-Type": "application/json", "anthropic-version": "2023-06-01" },
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
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64Pdf }, cache_control: { type: "ephemeral" } },
            { type: "text", text: prompt },
          ],
        }],
      }),
    });

    if (!completionResponse.ok) {
      const errText = await completionResponse.text();
      console.error(`AI OCR batch ${batch + 1} failed:`, completionResponse.status, errText);
      if (batch === firstBatch && fullText.length === 0) throw new Error(`AI extraction failed: ${completionResponse.status}`);
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

  console.log(`AI OCR run: ${fullText.length} chars, nextPage=${nextPage ?? "done"}`);
  return { text: fullText, nextPage, totalPages };
}


type ExtractionOutcome =
  | { done: true; text: string; rawText: string; pages: string[]; totalPages: number; pagesWithContent: number }
  | { done: false; ocrText: string; nextPage: number };

async function extractTextFromPdf(
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

  // Only try AI OCR if unpdf failed or produced corrupted text
  if (fileBytes.length > AI_EXTRACTION_SIZE_LIMIT) {
    throw new Error("PDF too large for AI extraction and text extraction failed.");
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

// ── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  const requestStart = Date.now();
  const origin = req.headers.get("Origin") || "";
  const corsHeaders = {
    "Access-Control-Allow-Origin": getAllowedOrigin(origin),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Admin client bypasses RLS — used for all DB writes so they survive JWT expiry
  // and can always mark jobs as failed on timeout/error.
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    serviceRoleKey
  );

  let standard_id: string | null = null;
  let timeoutHandle: number | null = null;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const body = await req.json();
    standard_id = body.standard_id;
    const clientExtractedText: string | null = body.extracted_text || null;
    console.log(`[DIAG] standard_id=${standard_id} client_text_length=${clientExtractedText?.length ?? 0}`);
    if (!standard_id) {
      return new Response(JSON.stringify({ error: "standard_id is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Support two call patterns:
    // 1. Internal call from upload-standard: uses service role key + passes user_id in body
    // 2. Direct user call: uses user JWT for auth
    const isInternalCall = authHeader === `Bearer ${serviceRoleKey}`;

    let userId: string;
    if (isInternalCall) {
      // Trusted internal call — user_id comes from the request body
      if (!body.user_id) {
        return new Response(JSON.stringify({ error: "user_id required for internal calls" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      userId = body.user_id;
    } else {
      // Direct user call — verify JWT
      const token = authHeader.replace("Bearer ", "");
      const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
      if (userError || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
      }
      userId = user.id;
    }

    const { data: standard, error: standardError } = await supabaseAdmin
      .from("standards").select("*").eq("id", standard_id).eq("user_id", userId).single();
    if (standardError || !standard) {
      return new Response(JSON.stringify({ error: "Standard not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Set up timeout — fires at 110s so we can clean up before Supabase kills the function at 150s
    timeoutHandle = setTimeout(async () => {
      console.error(`Processing timeout for standard ${standard_id}`);
      await supabaseAdmin.from("processing_jobs")
        .update({ status: "failed", error_message: "Processing timed out. Try a smaller or simpler PDF.", completed_at: new Date().toISOString() })
        .eq("standard_id", standard_id!)
        .eq("status", "processing");
      await supabaseAdmin.from("standards")
        .update({ extraction_status: "failed" })
        .eq("id", standard_id!);
    }, PROCESSING_TIMEOUT_MS) as unknown as number;

    // Mark job as processing
    await supabaseAdmin.from("processing_jobs")
      .update({ status: "processing", started_at: new Date().toISOString() })
      .eq("standard_id", standard_id)
      .eq("status", "pending");

    await supabaseAdmin.from("standards").update({ extraction_status: "processing" }).eq("id", standard_id);

    const t0 = Date.now();

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      clearTimeout(timeoutHandle);
      await supabaseAdmin.from("standards").update({ extraction_status: "failed" }).eq("id", standard_id);
      await supabaseAdmin.from("processing_jobs")
        .update({ status: "failed", error_message: "Service unavailable", completed_at: new Date().toISOString() })
        .eq("standard_id", standard_id);
      return new Response(JSON.stringify({ error: "Service unavailable" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let extracted: { text: string; pages: string[]; totalPages: number; pagesWithContent: number } | null = null;

    if (clientExtractedText && clientExtractedText.length > 100) {
      // Use pre-extracted text from the browser — bypasses server-side DRM decryption issues.
      // It must pass the same quality gate as server extraction: corrupted
      // client text (swallowed decimals, fused columns) previously flowed
      // straight into chunks and produced wrong numbers in answers.
      const parsed = parseExtractedText(clientExtractedText);
      if (hasGoodTextQuality(parsed.text)) {
        console.log(`[${standard_id}] Using client-extracted text: ${clientExtractedText.length} chars, ${parsed.totalPages} pages, ${parsed.pagesWithContent} with content`);
        extracted = parsed;
      } else {
        console.warn(`[${standard_id}] Client-extracted text FAILED quality gate — falling back to server extraction`);
      }
    }

    if (!extracted) {
      // Fall back to server-side extraction (unpdf → AI OCR)
      console.log(`[${standard_id}] Starting download (no usable client text)`);
      const { data: fileData, error: downloadError } = await supabaseAdmin.storage.from("standards").download(standard.file_path!);
      if (downloadError || !fileData) {
        clearTimeout(timeoutHandle);
        await supabaseAdmin.from("standards").update({ extraction_status: "failed" }).eq("id", standard_id);
        await supabaseAdmin.from("processing_jobs")
          .update({ status: "failed", error_message: "Failed to download file", completed_at: new Date().toISOString() })
          .eq("standard_id", standard_id);
        return new Response(JSON.stringify({ error: "Failed to download file" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      console.log(`[${standard_id}] Download done: ${Date.now() - t0}ms`);

      const fileBytes = new Uint8Array(await fileData.arrayBuffer());
      console.log(`[${standard_id}] File size: ${fileBytes.length} bytes, starting extraction`);
      // Resume state from a previous OCR run of this job (scanned documents
      // need many OCR batches — far more than one function window)
      const { data: jobRows } = await supabaseAdmin
        .from("processing_jobs")
        .select("id, ocr_text, ocr_next_page")
        .eq("standard_id", standard_id)
        .order("created_at", { ascending: false })
        .limit(1);
      const jobRow = jobRows?.[0];
      const resume = jobRow?.ocr_next_page && jobRow.ocr_next_page > 1
        ? { priorText: (jobRow.ocr_text as string) || "", startPage: jobRow.ocr_next_page as number }
        : undefined;

      try {
        // Leave ~20s of the processing window for chunking + DB writes
        const extractionDeadline = requestStart + PROCESSING_TIMEOUT_MS - 20_000;
        const outcome = await extractTextFromPdf(fileBytes, ANTHROPIC_API_KEY, extractionDeadline, resume);

        if (!outcome.done) {
          // No forward progress since last run (e.g. the same batch keeps
          // failing) — fail the job rather than retriggering forever.
          if (resume && outcome.nextPage <= resume.startPage) {
            clearTimeout(timeoutHandle);
            await supabaseAdmin.from("standards").update({ extraction_status: "failed" }).eq("id", standard_id);
            await supabaseAdmin.from("processing_jobs")
              .update({ status: "failed", error_message: "Text extraction stalled partway through this PDF. Please try again, or upload a cleaner copy.", ocr_text: null, ocr_next_page: null, completed_at: new Date().toISOString() })
              .eq("standard_id", standard_id);
            return new Response(JSON.stringify({ error: "OCR stalled — no progress between runs" }), {
              status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          // Persist progress and retrigger self to continue from nextPage.
          clearTimeout(timeoutHandle);
          await supabaseAdmin.from("processing_jobs")
            .update({ ocr_text: outcome.ocrText, ocr_next_page: outcome.nextPage, status: "processing" })
            .eq("standard_id", standard_id);
          const selfUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/process-standard`;
          const retrigger = fetch(selfUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
            body: JSON.stringify({ standard_id, user_id: userId }),
          }).catch(err => console.error("Failed to retrigger process-standard for OCR resume:", err));
          (globalThis as any).EdgeRuntime?.waitUntil?.(retrigger);
          console.log(`[${standard_id}] OCR paused at page ${outcome.nextPage} (${outcome.ocrText.length} chars so far) — retriggered to resume`);
          return new Response(JSON.stringify({ status: "ocr_resuming", next_page: outcome.nextPage }), {
            status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // OCR done but most of this window is spent — chunking + inserts
        // after a ~90s OCR run blow the 110s cleanup timer (that race marked
        // the AS 3017 job failed AFTER all 57 pages were transcribed, and
        // the early resume-state clear threw the text away). Persist the
        // complete text and retrigger: the next run skips OCR (startPage
        // beyond the last page) and gets a fresh window for chunking.
        if (Date.now() - requestStart > 60_000) {
          clearTimeout(timeoutHandle);
          await supabaseAdmin.from("processing_jobs")
            .update({ ocr_text: outcome.rawText, ocr_next_page: outcome.totalPages + 1, status: "processing" })
            .eq("standard_id", standard_id);
          const selfUrl2 = `${Deno.env.get("SUPABASE_URL")}/functions/v1/process-standard`;
          const chunkTrigger = fetch(selfUrl2, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
            body: JSON.stringify({ standard_id, user_id: userId }),
          }).catch(err => console.error("Failed to retrigger for chunking pass:", err));
          (globalThis as any).EdgeRuntime?.waitUntil?.(chunkTrigger);
          console.log(`[${standard_id}] OCR complete (${outcome.rawText.length} chars) — deferred chunking to a fresh window`);
          return new Response(JSON.stringify({ status: "ocr_done_chunking_deferred" }), {
            status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        extracted = outcome;
      } catch (e) {
        console.error("Text extraction failed:", e);
        clearTimeout(timeoutHandle);
        await supabaseAdmin.from("standards").update({ extraction_status: "failed" }).eq("id", standard_id);
        await supabaseAdmin.from("processing_jobs")
          .update({ status: "failed", error_message: String(e), completed_at: new Date().toISOString() })
          .eq("standard_id", standard_id);
        return new Response(JSON.stringify({ error: "We had trouble reading this PDF. Try a higher quality scan or a digital version." }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }
    console.log(`[${standard_id}] Extraction done: ${Date.now() - t0}ms, ${extracted.text.length} chars`);

    const qualityScore = computeQualityScore(extracted.text, extracted.totalPages, extracted.pagesWithContent);
    console.log(`Quality score: ${qualityScore} (${extracted.pagesWithContent}/${extracted.totalPages} pages with content)`);

    // AI-OCR failure text must never become content. A copy-protected PDF
    // renders blank when sliced for OCR, and the model replies "these pages
    // are entirely blank" — prose that scored 68 and shipped as a "complete"
    // standard (AS 3017 incident, 2026-07-13). Two independent detectors:
    // refusal phrasing, and characters-per-page far below any real document.
    const refusalPhrases = /entirely blank|completely (blank|empty)|no (readable|visible) text|blank\/white|cannot transcribe|unable to (read|transcribe)|do not contain any readable/i;
    const charsPerPage = extracted.text.length / Math.max(extracted.totalPages, 1);
    const looksLikeOcrFailure =
      refusalPhrases.test(extracted.text.slice(0, 3000)) ||
      (extracted.totalPages > 5 && charsPerPage < 400);
    if (looksLikeOcrFailure) {
      clearTimeout(timeoutHandle);
      await supabaseAdmin.from("standards").update({ extraction_status: "failed", extraction_quality_score: 0 }).eq("id", standard_id);
      await supabaseAdmin.from("processing_jobs")
        .update({ status: "failed", error_message: "This PDF appears to be copy-protected or scanned in a way we can't read — the pages came back blank. Try opening it and using Print → Save as PDF to create a fresh copy, then upload that.", completed_at: new Date().toISOString() })
        .eq("standard_id", standard_id);
      return new Response(JSON.stringify({ error: "This PDF appears to be copy-protected or scanned in a way we can't read — the pages came back blank. Try opening it and using Print → Save as PDF to create a fresh copy, then upload that." }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Reject low-quality extractions outright — a half-read standard produces wrong
    // answers, which is worse than asking the user for a cleaner PDF. A genuine
    // standard scores 70+; garbage/partial scans score well below 35.
    if (qualityScore < 35 || extracted.text.length < 100) {
      clearTimeout(timeoutHandle);
      await supabaseAdmin.from("standards").update({ extraction_status: "failed", extraction_quality_score: qualityScore }).eq("id", standard_id);
      await supabaseAdmin.from("processing_jobs")
        .update({ status: "failed", error_message: "Text quality too low", completed_at: new Date().toISOString() })
        .eq("standard_id", standard_id);
      return new Response(JSON.stringify({ error: "Text quality too low. Try a digital PDF instead of a scan." }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // standard_code is often null (the upload wizard only sets a title like
    // "AS 3008.1.1 2017") — which branded every chunk "[Unknown]" and baked
    // that junk into the embeddings. Derive code + version from the title and
    // persist them so citations and the vision prompts name the real standard.
    let standardCode = standard.standard_code as string | null;
    let version = (standard.version as string | null) || "";
    if (!standardCode && standard.title) {
      const m = (standard.title as string).match(/\b(AS(?:\s*\/\s*NZS)?)\s*(\d+(?:\.\d+)*)/i);
      if (m) {
        standardCode = `${m[1].toUpperCase().replace(/\s*\/\s*/, "/")} ${m[2]}`;
        if (!version) {
          const rest = (standard.title as string).slice((m.index || 0) + m[0].length);
          const vm = rest.match(/\b((?:19|20)\d{2})\b/);
          if (vm) version = vm[1];
        }
        await supabaseAdmin.from("standards")
          .update({ standard_code: standardCode, ...(version && !standard.version ? { version } : {}) })
          .eq("id", standard_id);
        console.log(`[${standard_id}] Derived standard_code "${standardCode}"${version ? ` version ${version}` : ""} from title`);
      }
    }
    standardCode = standardCode || "Unknown";

    // Figure/table detection needs the [PAGE N] markers to work out which page
    // each one is on. extracted.text has them stripped, so rebuild a marked
    // version from the pages array (page 1 = pages[0]).
    const markedText = extracted.pages.map((p, i) => `[PAGE ${i + 1}]\n${p}`).join("\n");
    const sections = sortIntoSections(markedText);
    const clauseChunks = chunkSections(sections, standardCode, version);
    const tableChunks = extractTableChunks(markedText, standardCode, version);
    const figureChunks = extractFigureChunks(markedText, standardCode, version);
    console.log(`[${standard_id}] Found ${tableChunks.length} table chunks, ${figureChunks.length} figure chunks`);

    // Merge and re-assign chunk_index globally
    const allChunks: Chunk[] = [...clauseChunks, ...tableChunks, ...figureChunks].map((chunk, idx) => ({
      ...chunk,
      chunk_index: idx,
    }));
    const totalChunks = allChunks.length;
    console.log(`[${standard_id}] Chunking done: ${Date.now() - t0}ms, ${totalChunks} chunks`);

    const { data: profile } = await supabaseAdmin.from("profiles").select("subscription_tier").eq("user_id", userId).single();
    const tier = profile?.subscription_tier || "free"; // least privilege — a missing profile must never grant pro
    const isPartial = tier === "free";

    const DB_BATCH_SIZE = 100;

    // Delete stale chunks from previous extractions before inserting fresh ones
    const { error: deleteError } = await supabaseAdmin
      .from("standard_chunks")
      .delete()
      .eq("standard_id", standard_id);
    if (deleteError) console.error(`Failed to delete old chunks for ${standard_id}:`, deleteError);
    else console.log(`[${standard_id}] Deleted old chunks`);

    // Insert all chunks as text-only — embeddings are generated by embed-chunks separately
    for (let i = 0; i < allChunks.length; i += DB_BATCH_SIZE) {
      const batch = allChunks.slice(i, i + DB_BATCH_SIZE);
      const chunkRecords = batch.map(chunk => ({
        standard_id,
        user_id: userId,
        clause_number: chunk.clause_number,
        clause_title: chunk.clause_title,
        content: chunk.content,
        page_number: chunk.page_number,
        chunk_index: chunk.chunk_index,
        embedding: null,
        is_indexed: false,
      }));
      const { error: chunkError } = await supabaseAdmin.from("standard_chunks").insert(chunkRecords);
      if (chunkError) console.error(`Chunk insert error (batch ${i / DB_BATCH_SIZE}):`, chunkError);
      else console.log(`[${standard_id}] DB insert batch ${Math.floor(i / DB_BATCH_SIZE) + 1} done: ${Date.now() - t0}ms`);
    }

    console.log(`[${standard_id}] All chunks stored (text-only): ${Date.now() - t0}ms`);

    // Chunks are in — safe to drop the OCR resume text now
    await supabaseAdmin.from("processing_jobs")
      .update({ ocr_text: null, ocr_next_page: null })
      .eq("standard_id", standard_id);
    clearTimeout(timeoutHandle);

    // Update standard with chunk count — stays "processing" until embed-chunks finishes
    await supabaseAdmin.from("standards").update({
      extraction_quality_score: qualityScore,
      is_partial: isPartial,
      total_chunks: totalChunks,
      indexed_chunks: 0,
    }).eq("id", standard_id);

    // Hand off embedding to embed-chunks (runs in its own 150s window)
    const embedUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/embed-chunks`;
    const embedTrigger = fetch(embedUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({ standard_id, user_id: userId }),
    }).catch(e => console.error("Failed to trigger embed-chunks:", e));
    // waitUntil stops the runtime killing the instance before the request leaves
    (globalThis as any).EdgeRuntime?.waitUntil?.(embedTrigger);

    // Fire-and-forget: describe-figures generates AI descriptions for figure
    // chunks AND markdown transcriptions for table chunks — must fire for
    // either kind.
    if (figureChunks.length > 0 || tableChunks.length > 0) {
      const describeUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/describe-figures`;
      const describeTrigger = fetch(describeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
        body: JSON.stringify({ standard_id, user_id: userId }),
      }).catch(e => console.error("Failed to trigger describe-figures:", e));
      (globalThis as any).EdgeRuntime?.waitUntil?.(describeTrigger);
    }

    return new Response(JSON.stringify({ status: "processing", total_chunks: totalChunks, quality_score: qualityScore, is_partial: isPartial }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Processing error:", e);
    if (timeoutHandle !== null) clearTimeout(timeoutHandle);
    if (standard_id) {
      await supabaseAdmin.from("processing_jobs")
        .update({ status: "failed", error_message: e instanceof Error ? e.message : "Unknown error", completed_at: new Date().toISOString() })
        .eq("standard_id", standard_id)
        .in("status", ["pending", "processing"]);
      await supabaseAdmin.from("standards")
        .update({ extraction_status: "failed" })
        .eq("id", standard_id);
    }
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
