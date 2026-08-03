import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAllowedOrigin } from "../_shared/cors.ts";
import {
  PIPELINE_VERSION,
  hasGoodTextQuality,
  computeQualityScore,
  parseExtractedText,
} from "./extraction.ts";
import { extractTextFromPdf } from "./ocr.ts";
import { chunkAndPersist } from "./pipeline.ts";

// Mark jobs as failed if processing exceeds this — must be under Supabase's 150s limit.
const PROCESSING_TIMEOUT_MS = 110_000;

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
    let clientExtractedText: string | null = body.extracted_text || null;
    const extractedTextPath: string | null = body.extracted_text_path || null;
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
      .update({ status: "processing", started_at: new Date().toISOString(), heartbeat_at: new Date().toISOString() })
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

    // Big documents: the browser's extracted text was too large for the request
    // body, so the client parked it in storage and sent the path instead. Load
    // it here — this skips server-side PDF re-extraction, which is the path
    // that times out or OOMs on the largest standards.
    if (!clientExtractedText && extractedTextPath && extractedTextPath.startsWith(`${userId}/`) && extractedTextPath.endsWith(".txt")) {
      const { data: textFile, error: textDlError } = await supabaseAdmin.storage
        .from("standards")
        .download(extractedTextPath);
      if (textDlError || !textFile) {
        console.warn(`[${standard_id}] Failed to download client text at ${extractedTextPath}: ${textDlError?.message ?? "no data"} — falling back to server extraction`);
      } else {
        clientExtractedText = await textFile.text();
        console.log(`[${standard_id}] Loaded client-extracted text from storage: ${clientExtractedText.length} chars`);
      }
      // One-shot handoff file — remove it whatever the quality gate decides
      const textCleanup = supabaseAdmin.storage.from("standards").remove([extractedTextPath])
        .then(({ error }) => { if (error) console.warn(`[${standard_id}] Failed to clean up ${extractedTextPath}:`, error.message); });
      (globalThis as any).EdgeRuntime?.waitUntil?.(textCleanup);
    }

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

      // Hard daily circuit-breaker on OCR runs (each run makes 2-5 vision
      // calls on a full document). 40 runs/day covers many scanned uploads;
      // anything past that is a loop or a mistake and must stop, not spend.
      const { data: ocrBudget } = await supabaseAdmin.rpc("check_and_record_ai_usage", {
        p_user_id: userId,
        p_kind: "ocr_run",
        p_max: 40,
        p_window_seconds: 86400,
      });
      if (typeof ocrBudget === "number" && ocrBudget < 0) {
        clearTimeout(timeoutHandle);
        await supabaseAdmin.from("standards").update({ extraction_status: "failed" }).eq("id", standard_id);
        await supabaseAdmin.from("processing_jobs")
          .update({ status: "failed", error_message: "Daily document-processing budget reached. Try again tomorrow.", completed_at: new Date().toISOString() })
          .eq("standard_id", standard_id);
        return new Response(JSON.stringify({ error: "Daily OCR budget reached — stopped to protect API spend" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

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
            .update({ ocr_text: outcome.ocrText, ocr_next_page: outcome.nextPage, status: "processing", heartbeat_at: new Date().toISOString() })
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
            .update({ ocr_text: outcome.rawText, ocr_next_page: outcome.totalPages + 1, status: "processing", heartbeat_at: new Date().toISOString() })
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

    const { data: profile } = await supabaseAdmin.from("profiles").select("subscription_tier").eq("user_id", userId).single();
    const tier = profile?.subscription_tier || "free"; // least privilege — a missing profile must never grant pro

    // extracted.pages carries page 1 = pages[0]; chunkAndPersist rebuilds the
    // [PAGE N]-marked text, chunks it, deletes old chunks, inserts the new
    // ones, stamps pipeline_version, and triggers embed-chunks/describe-figures.
    // Shared with reprocess-standard so a chunking/tagging fix behaves
    // identically whether it runs on first upload or on a reprocess trigger.
    const { totalChunks, isPartial } = await chunkAndPersist(supabaseAdmin, {
      standard_id: standard_id!,
      userId,
      organizationId: standard.organization_id ?? null,
      standardCode,
      version,
      pages: extracted.pages,
      tier,
      qualityScore,
      pipelineVersion: PIPELINE_VERSION,
    });
    clearTimeout(timeoutHandle);

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
