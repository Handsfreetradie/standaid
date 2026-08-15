import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";
import { getAllowedOrigin } from "../_shared/cors.ts";
import { deriveItemInfo, buildPrompt, buildVisionParams, extractPageBase64, type WorkChunk } from "./shared.ts";

// Submits the primary-page vision pass for a standard's undescribed
// figures/tables as a single Anthropic Message Batch (50% cheaper than the
// old one-call-per-item synchronous loop, same model/prompts/pages). Results
// are picked up asynchronously by poll-vision-batches, which also runs the
// small retry/continuation tail (mis-anchored table captions, multi-page
// tables) on the original synchronous path — see
// /Users/kyledixon/.claude/plans/frolicking-shimmying-coral.md for why.
//
// Global ceiling on figures described per standard, enforced across batches —
// covers real standards (AS/NZS 3000 has ~124 figures) while capping a
// pathological/crafted document from driving unbounded vision spend.
const MAX_FIGURES_PER_STANDARD = 200;

serve(async (req) => {
  const origin = req.headers.get("Origin") || "";
  const corsHeaders = {
    "Access-Control-Allow-Origin": getAllowedOrigin(origin),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, serviceRoleKey);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || authHeader !== `Bearer ${serviceRoleKey}`) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { standard_id, user_id } = await req.json();
    if (!standard_id || !user_id) {
      return new Response(JSON.stringify({ error: "standard_id and user_id are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: "Service unavailable" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // A batch is already in flight for this standard — don't double-submit.
    // resume-stalled-indexing re-kicks this function every 10 minutes for any
    // 'complete' standard with leftover placeholder chunks, and a batch can
    // take up to an hour to resolve, so this guard is load-bearing, not
    // defensive-programming filler.
    const { data: inFlight } = await supabaseAdmin
      .from("vision_batch_jobs")
      .select("id")
      .eq("standard_id", standard_id)
      .eq("status", "submitted")
      .limit(1)
      .maybeSingle();
    if (inFlight) {
      console.log(`[describe-figures] Batch already in flight for standard ${standard_id} — skipping`);
      return new Response(JSON.stringify({ submitted: 0, note: "batch already in flight" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch undescribed figure AND table chunks (is_indexed = false means not
    // yet processed). Tables get a vision transcription to markdown — the
    // linear text extraction flattens and fuses table cells, so the page
    // image is the only reliable source of cell-accurate values.
    const { data: figureChunks, error: fetchError } = await supabaseAdmin
      .from("standard_chunks")
      .select("id, clause_number, clause_title, page_number, content, index_attempts")
      .eq("standard_id", standard_id)
      .or("clause_number.like.FIGURE%,clause_number.like.TABLE%")
      .eq("is_indexed", false)
      .lt("index_attempts", 3);

    if (fetchError) {
      console.error("Error fetching figure/table chunks:", fetchError);
      return new Response(JSON.stringify({ error: "Failed to fetch figure chunks" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Only chunks that carry their type's placeholder get a vision pass —
    // reference-only chunks (no caption found) have no known page to
    // photograph and embed as-is. Figures used to bypass this check entirely
    // (any FIGURE-prefixed chunk qualified regardless of content), unlike
    // tables — meaning every reference-only figure (never captioned, only
    // ever mentioned) got sent to vision anchored to wherever it was
    // mentioned, permanently failing every time no matter how many retries.
    // extraction.ts now only emits the figure placeholder when a real
    // caption was actually found, so this filter can gate on it exactly like
    // tables always have.
    const workChunks: WorkChunk[] = (figureChunks || []).filter((c: WorkChunk) =>
      (c.content || "").includes("visual description will be generated shortly") ||
      (c.content || "").includes("transcription of this table will be generated shortly")
    );

    if (workChunks.length === 0) {
      console.log(`[describe-figures] No undescribed figure/table chunks for standard ${standard_id}`);
      return new Response(JSON.stringify({ submitted: 0 }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Respect the global per-standard ceiling across all batches so far.
    const { count: totalDescribed } = await supabaseAdmin
      .from("standard_chunks")
      .select("*", { count: "exact", head: true })
      .eq("standard_id", standard_id)
      .or("clause_number.like.FIGURE%,clause_number.like.TABLE%")
      .eq("is_indexed", true);
    const budget = MAX_FIGURES_PER_STANDARD - (totalDescribed || 0);
    if (budget <= 0) {
      console.warn(`[describe-figures] Reached ${MAX_FIGURES_PER_STANDARD}-figure ceiling for ${standard_id}`);
      return new Response(JSON.stringify({ submitted: 0, note: "ceiling reached" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const candidates = workChunks.slice(0, budget);

    const { data: standard, error: standardError } = await supabaseAdmin
      .from("standards")
      .select("file_path, standard_code, version, organization_id")
      .eq("id", standard_id)
      .eq("user_id", user_id)
      .single();

    if (standardError || !standard?.file_path) {
      console.error("Error fetching standard:", standardError);
      return new Response(JSON.stringify({ error: "Standard not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: fileData, error: downloadError } = await supabaseAdmin.storage
      .from("standards")
      .download(standard.file_path);

    if (downloadError || !fileData) {
      console.error("Error downloading PDF:", downloadError);
      return new Response(JSON.stringify({ error: "Failed to download PDF" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fileBytes = new Uint8Array(await fileData.arrayBuffer());
    let srcDoc: PDFDocument;
    try {
      srcDoc = await PDFDocument.load(fileBytes, { ignoreEncryption: true });
    } catch (e) {
      console.error("[describe-figures] pdf-lib could not load document:", e);
      return new Response(JSON.stringify({ error: "Could not read PDF" }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const standardCode = standard.standard_code || "Unknown";
    const stdVersion = standard.version || "";
    const standardLabel = `${standardCode}${stdVersion ? ` ${stdVersion}` : ""}`.trim();

    // deno-lint-ignore no-explicit-any
    const requests: any[] = [];
    const items: Array<{ custom_id: string; chunk_id: string; isTable: boolean; refNumber: string; caption: string; page: number }> = [];

    for (const chunk of candidates) {
      // Hard daily circuit-breaker: every vision item counted against a
      // per-account daily ceiling, before it's ever billed. A bug, a loop, or
      // an over-eager agent can never again burn unbounded API credit.
      const { data: usageLeft } = await supabaseAdmin.rpc("check_and_record_ai_usage", {
        p_user_id: user_id, p_kind: "vision", p_max: 500, p_window_seconds: 86400,
      });
      if (typeof usageLeft === "number" && usageLeft < 0) {
        console.error(`[describe-figures] DAILY VISION BUDGET REACHED (500/day) — stopping batch build for ${standard_id}`);
        break;
      }

      const { isTable, refNumber, caption, page } = deriveItemInfo(chunk);
      const pageBase64 = await extractPageBase64(srcDoc, page);
      if (!pageBase64) {
        console.warn(`${isTable ? "Table" : "Figure"} ${refNumber}: could not isolate page ${page}`);
        continue;
      }

      const prompt = buildPrompt(isTable, standardLabel, refNumber, caption, page);
      requests.push({ custom_id: chunk.id, params: buildVisionParams(pageBase64, prompt, isTable) });
      items.push({ custom_id: chunk.id, chunk_id: chunk.id, isTable, refNumber, caption, page });
    }

    if (requests.length === 0) {
      console.log(`[describe-figures] Nothing batchable for standard ${standard_id}`);
      return new Response(JSON.stringify({ submitted: 0 }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const batchRes = await fetch("https://api.anthropic.com/v1/messages/batches", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "Content-Type": "application/json", "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ requests }),
    });

    if (!batchRes.ok) {
      const errText = await batchRes.text();
      console.error(`[describe-figures] Batch submission failed (${batchRes.status}):`, errText);
      return new Response(JSON.stringify({ error: "Batch submission failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const batchData = await batchRes.json();
    const batchId = batchData.id as string;

    const { error: insertError } = await supabaseAdmin.from("vision_batch_jobs").insert({
      standard_id, user_id, batch_id: batchId, items, status: "submitted",
    });
    if (insertError) {
      console.error("[describe-figures] Failed to persist vision_batch_jobs row:", insertError);
      return new Response(JSON.stringify({ error: "Failed to record batch" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[describe-figures] Submitted batch ${batchId} with ${requests.length} items for standard ${standard_id}`);
    return new Response(JSON.stringify({ submitted: requests.length, batch_id: batchId }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[describe-figures] Unexpected error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
