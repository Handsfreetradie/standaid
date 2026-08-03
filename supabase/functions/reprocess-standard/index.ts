import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAllowedOrigin } from "../_shared/cors.ts";
import { PIPELINE_VERSION, computeQualityScore } from "../process-standard/extraction.ts";
import { extractTextFromPdf } from "../process-standard/ocr.ts";
import { chunkAndPersist } from "../process-standard/pipeline.ts";

// Admin-only, single-standard reprocess trigger: re-runs the chunking/
// extraction/tagging pipeline against an already-uploaded standard's stored
// PDF (no fresh upload required) and stamps pipeline_version so it stops
// showing up as stale. NOT wired to any cron/sweep — must be invoked
// explicitly with one standard_id at a time. See scripts/list-stale-standards.mjs
// to find candidates before calling this.
//
// Auth pattern copied from grant-trial (the only other owner-only tool in
// this repo) rather than the internal-service-call pattern used between
// pipeline functions — this is meant to be triggered by a human, not code.
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

    const { data: standard, error: standardError } = await supabaseAdmin
      .from("standards").select("*").eq("id", standard_id).single();
    if (standardError || !standard) return json({ error: "Standard not found" }, 404);

    // Don't race an in-flight upload/process — its own chunking will land
    // with the current PIPELINE_VERSION anyway.
    if (standard.extraction_status === "pending" || standard.extraction_status === "processing") {
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
    const originalStatus = standard.extraction_status as string;
    await supabaseAdmin.from("standards").update({ extraction_status: "processing" }).eq("id", standard_id);

    const { data: job, error: jobError } = await supabaseAdmin
      .from("processing_jobs")
      .insert({ standard_id, user_id: standard.user_id, status: "processing", started_at: new Date().toISOString(), heartbeat_at: new Date().toISOString() })
      .select("id")
      .single();
    if (jobError || !job) {
      await supabaseAdmin.from("standards").update({ extraction_status: originalStatus }).eq("id", standard_id);
      return json({ error: "Failed to create processing job" }, 500);
    }
    jobId = job.id;

    const fail = async (message: string, status = 422) => {
      await supabaseAdmin.from("standards").update({ extraction_status: originalStatus }).eq("id", standard_id);
      await supabaseAdmin.from("processing_jobs")
        .update({ status: "failed", error_message: message, completed_at: new Date().toISOString() })
        .eq("id", job.id);
      return json({ error: message }, status);
    };

    // Same daily circuit-breaker as process-standard — reprocessing a scanned
    // standard re-runs OCR and must count against the same spend guard.
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

    let outcome;
    try {
      const deadline = requestStart + PROCESSING_TIMEOUT_MS - 20_000;
      outcome = await extractTextFromPdf(fileBytes, ANTHROPIC_API_KEY, deadline);
    } catch (e) {
      return fail(e instanceof Error ? e.message : "Text extraction failed.");
    }

    // Scanned documents needing more than one OCR window aren't supported by
    // this single-window admin tool yet — fail cleanly rather than leaving
    // the standard stuck mid-reprocess. The original chunks are untouched.
    if (!outcome.done) {
      return fail("This standard needs multiple OCR passes to re-extract (large scanned document) — reprocess-standard doesn't support resuming yet. The standard is unchanged.");
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
