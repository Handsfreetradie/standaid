import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAllowedOrigin } from "../_shared/cors.ts";
import { PIPELINE_VERSION, computeQualityScore } from "../process-standard/extraction.ts";
import { extractTextFromPdf } from "../process-standard/ocr.ts";
import { chunkAndPersist } from "../process-standard/pipeline.ts";
import { buildOcrResume, isStalledResume } from "../process-standard/resume.ts";

// Admin-only, single-standard reprocess trigger: re-runs the chunking/
// extraction/tagging pipeline against an already-uploaded standard's stored
// PDF (no fresh upload required) and stamps pipeline_version so it stops
// showing up as stale. The initial trigger must still be invoked explicitly
// with one standard_id at a time (see scripts/list-stale-standards.mjs) — but
// once started, a scanned standard needing many OCR windows self-retriggers
// (see `resume: true` below) exactly like process-standard, and a stuck job
// is picked up by the same generic stale-job sweeper (20260719000000) since
// that sweep keys off processing_jobs rows regardless of which function
// created them.
//
// Auth pattern copied from grant-trial (the only other owner-only tool in
// this repo) rather than the internal-service-call pattern used between
// pipeline functions — this is meant to be triggered by a human, not code.
// The one exception is the self-retrigger below, which reuses this same
// service-role-key auth path (trusted the same way process-standard trusts
// its own self-retrigger) to pass `resume: true`.
const ADMIN_EMAIL = "kyledixonelectrical@gmail.com";

// Mark the job failed if a single extraction window runs this long — must be
// under Supabase's 150s hard limit, same budget as process-standard.
const PROCESSING_TIMEOUT_MS = 110_000;

serve(async (req) => {
  const origin = req.headers.get("Origin") || "";
  const corsHeaders = {
    "Access-Control-Allow-Origin": getAllowedOrigin(origin),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const requestStart = Date.now();
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, serviceRoleKey);

  let standard_id: string | null = null;
  let jobId: string | null = null;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    // Two callers: the service role key directly (local admin scripts, e.g.
    // scripts/list-stale-standards.mjs's companion trigger), or a logged-in
    // user JWT that must belong to the admin account. No other caller can
    // reach this — it re-spends OCR/vision credits per standard_id.
    const isServiceRoleCall = authHeader === `Bearer ${serviceRoleKey}`;
    if (!isServiceRoleCall) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
      if (userError || !user) return json({ error: "Unauthorized" }, 401);
      if (user.email !== ADMIN_EMAIL) return json({ error: "Forbidden" }, 403);
    }

    const body = await req.json();
    standard_id = body.standard_id;
    if (!standard_id) return json({ error: "standard_id is required" }, 400);

    // Set only by our own self-retrigger below (service-role auth required —
    // same trust boundary process-standard uses for its internal retrigger),
    // never by a human/admin caller. Lets a resumed window through the
    // "already processing" guard below, since window 1 already flipped
    // extraction_status to 'processing' before this call was made.
    const isResumeCall = isServiceRoleCall && body.resume === true;

    const { data: standard, error: standardError } = await supabaseAdmin
      .from("standards").select("*").eq("id", standard_id).single();
    if (standardError || !standard) return json({ error: "Standard not found" }, 404);

    // Don't race an in-flight upload/process — its own chunking will land
    // with the current PIPELINE_VERSION anyway. A resume call is expected to
    // find 'processing' here (it's this same reprocess job's own prior
    // window), so it skips this check.
    if (!isResumeCall && (standard.extraction_status === "pending" || standard.extraction_status === "processing")) {
      return json({ error: "Standard is already being processed — try again once it finishes." }, 409);
    }

    if (!standard.file_path) {
      return json({ error: "This standard has no stored PDF to reprocess from." }, 400);
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) return json({ error: "Service unavailable" }, 500);

    // Old chunks are only deleted once new ones are ready to insert (inside
    // chunkAndPersist) — until then, any failure below just reverts this flag
    // and the standard's existing chunks are completely untouched.
    //
    // Fresh call: create the job row once, stamping the pre-reprocess status
    // so a later window (which finds extraction_status already 'processing')
    // still knows what to revert to on failure.
    // Resume call: reuse that same job row instead of inserting a new one —
    // it already carries the checkpoint (ocr_text/ocr_next_page) and the
    // revert status from window 1.
    let originalStatus: string;
    let job: { id: string; ocr_text: string | null; ocr_next_page: number | null };

    if (!isResumeCall) {
      originalStatus = standard.extraction_status as string;
      await supabaseAdmin.from("standards").update({ extraction_status: "processing" }).eq("id", standard_id);

      const { data: inserted, error: jobError } = await supabaseAdmin
        .from("processing_jobs")
        .insert({
          standard_id, user_id: standard.user_id, status: "processing",
          started_at: new Date().toISOString(), heartbeat_at: new Date().toISOString(),
          revert_extraction_status: originalStatus,
        })
        .select("id, ocr_text, ocr_next_page")
        .single();
      if (jobError || !inserted) {
        await supabaseAdmin.from("standards").update({ extraction_status: originalStatus }).eq("id", standard_id);
        return json({ error: "Failed to create processing job" }, 500);
      }
      job = inserted;
    } else {
      const { data: jobRows } = await supabaseAdmin
        .from("processing_jobs")
        .select("id, ocr_text, ocr_next_page, revert_extraction_status")
        .eq("standard_id", standard_id)
        .order("created_at", { ascending: false })
        .limit(1);
      const found = jobRows?.[0];
      if (!found) {
        // Checkpoint row is gone — nothing to resume into. Fail closed
        // rather than silently starting a fresh OCR pass under someone
        // else's expectations of what this call would do.
        await supabaseAdmin.from("standards").update({ extraction_status: "failed" }).eq("id", standard_id);
        return json({ error: "Resume call found no processing job to continue." }, 500);
      }
      job = found;
      originalStatus = (found.revert_extraction_status as string | null) || "failed";
      await supabaseAdmin.from("processing_jobs")
        .update({ status: "processing", heartbeat_at: new Date().toISOString() })
        .eq("id", job.id);
    }
    jobId = job.id;

    const fail = async (message: string, status = 422) => {
      await supabaseAdmin.from("standards").update({ extraction_status: originalStatus }).eq("id", standard_id);
      await supabaseAdmin.from("processing_jobs")
        .update({ status: "failed", error_message: message, ocr_text: null, ocr_next_page: null, completed_at: new Date().toISOString() })
        .eq("id", job.id);
      return json({ error: message }, status);
    };

    // Same daily circuit-breaker as process-standard, applied per window —
    // reprocessing a scanned standard re-runs OCR and must count against the
    // same spend guard on every self-retriggered window, not just the first.
    const { data: ocrBudget } = await supabaseAdmin.rpc("check_and_record_ai_usage", {
      p_user_id: standard.user_id,
      p_kind: "ocr_run",
      p_max: 40,
      p_window_seconds: 86400,
    });
    if (typeof ocrBudget === "number" && ocrBudget < 0) {
      return fail("Daily document-processing budget reached. Try again tomorrow.", 429);
    }

    const { data: fileData, error: downloadError } = await supabaseAdmin.storage.from("standards").download(standard.file_path);
    if (downloadError || !fileData) return fail("Failed to download the stored PDF.", 500);

    const fileBytes = new Uint8Array(await fileData.arrayBuffer());
    console.log(`[reprocess-standard][${standard_id}] Downloaded ${fileBytes.length} bytes, re-extracting text`);

    // Resume state from a previous OCR window of THIS job — undefined for a
    // fresh job row (ocr_next_page starts null) or a genuinely fresh call.
    const resume = buildOcrResume(job);

    let outcome;
    try {
      const deadline = requestStart + PROCESSING_TIMEOUT_MS - 20_000;
      outcome = await extractTextFromPdf(fileBytes, ANTHROPIC_API_KEY, deadline, resume, {
        supabaseAdmin, userId: standard.user_id, standardId: standard_id,
      });
    } catch (e) {
      return fail(e instanceof Error ? e.message : "Text extraction failed.");
    }

    if (!outcome.done) {
      // No forward progress since last run (e.g. the same batch keeps
      // failing) — fail the job rather than retriggering forever.
      if (isStalledResume(resume, outcome.nextPage)) {
        return fail("Re-extraction stalled partway through this PDF (no progress between OCR windows). The standard is unchanged.");
      }

      // Persist progress and retrigger self to continue from nextPage — same
      // checkpoint mechanism as process-standard (ocr_text/ocr_next_page/
      // heartbeat_at), targeting this function's own URL instead of
      // process-standard's.
      await supabaseAdmin.from("processing_jobs")
        .update({ ocr_text: outcome.ocrText, ocr_next_page: outcome.nextPage, status: "processing", heartbeat_at: new Date().toISOString() })
        .eq("id", job.id);
      const selfUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/reprocess-standard`;
      const retrigger = fetch(selfUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
        body: JSON.stringify({ standard_id, resume: true }),
      }).catch(err => console.error("[reprocess-standard] Failed to retrigger for OCR resume:", err));
      (globalThis as any).EdgeRuntime?.waitUntil?.(retrigger);
      console.log(`[reprocess-standard][${standard_id}] OCR paused at page ${outcome.nextPage} (${outcome.ocrText.length} chars so far) — retriggered to resume`);
      return json({ status: "ocr_resuming", next_page: outcome.nextPage });
    }

    // OCR done but most of this window is spent — chunking + inserts after a
    // long OCR run can blow the cleanup timer (the AS 3017 incident: a job
    // marked failed AFTER all pages were transcribed). Persist the complete
    // text and retrigger: the next run's startPage is past the last page, so
    // extractTextFromPdf's resume path returns the carried-forward text
    // immediately and this gets a fresh window for chunking alone.
    if (Date.now() - requestStart > 60_000) {
      await supabaseAdmin.from("processing_jobs")
        .update({ ocr_text: outcome.rawText, ocr_next_page: outcome.totalPages + 1, status: "processing", heartbeat_at: new Date().toISOString() })
        .eq("id", job.id);
      const selfUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/reprocess-standard`;
      const chunkTrigger = fetch(selfUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
        body: JSON.stringify({ standard_id, resume: true }),
      }).catch(err => console.error("[reprocess-standard] Failed to retrigger for chunking pass:", err));
      (globalThis as any).EdgeRuntime?.waitUntil?.(chunkTrigger);
      console.log(`[reprocess-standard][${standard_id}] OCR complete (${outcome.rawText.length} chars) — deferred chunking to a fresh window`);
      return json({ status: "ocr_done_chunking_deferred" });
    }

    const qualityScore = computeQualityScore(outcome.text, outcome.totalPages, outcome.pagesWithContent);

    const refusalPhrases = /entirely blank|completely (blank|empty)|no (readable|visible) text|blank\/white|cannot transcribe|unable to (read|transcribe)|do not contain any readable/i;
    const charsPerPage = outcome.text.length / Math.max(outcome.totalPages, 1);
    const looksLikeOcrFailure =
      refusalPhrases.test(outcome.text.slice(0, 3000)) ||
      (outcome.totalPages > 5 && charsPerPage < 400);
    if (looksLikeOcrFailure) {
      return fail("Re-extraction came back blank or unreadable — the stored PDF may be copy-protected. The standard is unchanged.");
    }
    if (qualityScore < 35 || outcome.text.length < 100) {
      return fail("Re-extracted text quality too low. The standard is unchanged.");
    }

    const standardCode = (standard.standard_code as string | null) || "Unknown";
    const version = (standard.version as string | null) || "";

    const { data: profile } = await supabaseAdmin.from("profiles").select("subscription_tier").eq("user_id", standard.user_id).single();
    const tier = profile?.subscription_tier || "free"; // least privilege — a missing profile must never grant pro

    // Carry forward already-described figure/table content so a chunking/
    // tagging fix doesn't force every figure/table through vision again —
    // only chunks whose clause_number no longer appears after re-chunking
    // (or whose content changed) lose their carried-forward text, in which
    // case describe-figures naturally re-describes them.
    const { data: describedChunks } = await supabaseAdmin
      .from("standard_chunks")
      .select("clause_number, content")
      .eq("standard_id", standard_id)
      .in("chunk_type", ["table", "figure"])
      .eq("is_indexed", true);
    const preserveDescribed = new Map<string, string>();
    for (const c of describedChunks || []) {
      if (c.clause_number && c.content) preserveDescribed.set(c.clause_number, c.content);
    }
    console.log(`[reprocess-standard][${standard_id}] Carrying forward ${preserveDescribed.size} already-described figure/table chunks`);

    const { totalChunks, isPartial } = await chunkAndPersist(supabaseAdmin, {
      standard_id,
      userId: standard.user_id,
      organizationId: standard.organization_id ?? null,
      standardCode,
      version,
      pages: outcome.pages,
      tier,
      qualityScore,
      pipelineVersion: PIPELINE_VERSION,
      preserveDescribed,
    });

    await supabaseAdmin.from("processing_jobs")
      .update({ status: "processing", heartbeat_at: new Date().toISOString() })
      .eq("id", job.id);

    console.log(`[reprocess-standard][${standard_id}] Reprocessed: ${totalChunks} chunks, pipeline_version=${PIPELINE_VERSION}`);
    return json({ status: "processing", standard_id, total_chunks: totalChunks, quality_score: qualityScore, is_partial: isPartial, pipeline_version: PIPELINE_VERSION });
  } catch (e) {
    console.error("[reprocess-standard] Unexpected error:", e);
    // Past this point chunkAndPersist may already have deleted old chunks —
    // 'failed' is the honest state here, unlike the early-exit paths above
    // (via `fail()`) which restore the standard's original, untouched status.
    if (standard_id) {
      await supabaseAdmin.from("standards").update({ extraction_status: "failed" }).eq("id", standard_id);
    }
    if (jobId) {
      await supabaseAdmin.from("processing_jobs")
        .update({ status: "failed", error_message: e instanceof Error ? e.message : "Unknown error", completed_at: new Date().toISOString() })
        .eq("id", jobId);
    }
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
