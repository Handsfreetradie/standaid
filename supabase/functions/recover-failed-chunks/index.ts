import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";
import { getAllowedOrigin } from "../_shared/cors.ts";
import { extractPageRangeBase64, bumpAttempts } from "../describe-figures/shared.ts";
import { extractTableChunks, extractFigureChunks, type Chunk } from "../process-standard/extraction.ts";
import { transcriptionRules } from "../process-standard/ocr.ts";
import { logTokenUsage } from "../_shared/log-usage.ts";

// Fixes permanently-failed table/figure chunks (embedding IS NULL AND
// index_attempts >= 3 — the same condition embed-chunks uses to compute
// failed_chunks_count/failed_chunks_labels) WITHOUT re-processing the whole
// document. Root cause of most of these: the caption-detection logic that
// produced them fabricated a caption that was never really there — fixed
// earlier in extraction.ts (looksLikeRealCaption). This re-runs that FIXED
// logic against just the couple of real pages the chunk claims to be on,
// instead of the reprocess-standard path's full-document re-extraction —
// ~3 pages of vision input per failed item instead of the whole standard.
//
// ±1 page window (not just the exact recorded page) because a couple of the
// known-bad chunks were anchored to the WRONG page entirely (a Pass-2
// numeric-heading match landing on a neighbour's page) — the real table/
// figure is usually one page either side when that happens. A chunk whose
// caption is off by more than one page still falls through to the full
// reprocess-standard path; this is deliberately narrow in scope, not a
// general-purpose "find it anywhere" search.
//
// Own daily budget bucket — separate from "vision" (describe-figures) and
// "page_gap_recovery" (recover-page-gap), so a bad run in one never crowds
// out legitimate spend in the others.
const DAILY_BUDGET = 40;

serve(async (req) => {
  const origin = req.headers.get("Origin") || "";
  const corsHeaders = {
    "Access-Control-Allow-Origin": getAllowedOrigin(origin),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, serviceRoleKey);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || authHeader !== `Bearer ${serviceRoleKey}`) return json({ error: "Unauthorized" }, 401);

    const { standard_id, user_id } = await req.json();
    if (!standard_id || !user_id) return json({ error: "standard_id and user_id are required" }, 400);

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) return json({ error: "Service unavailable" }, 500);

    // Same condition embed-chunks uses to compute failed_chunks_count/labels —
    // keeps this function's notion of "failed" identical to what the admin
    // panel and the Standards page show the user.
    const { data: failed, error: fetchError } = await supabaseAdmin
      .from("standard_chunks")
      .select("id, clause_number, clause_title, page_number, index_attempts")
      .eq("standard_id", standard_id)
      .is("embedding", null)
      .gte("index_attempts", 3)
      .order("page_number");

    if (fetchError) {
      console.error("[recover-failed-chunks] Error fetching failed chunks:", fetchError);
      return json({ error: "Failed to fetch failed chunks" }, 500);
    }
    if (!failed || failed.length === 0) {
      return json({ fixed: 0, note: "no failed chunks" });
    }

    // Only table/figure captions are this function's job — anything else
    // that somehow hit the retry cap isn't a caption-detection problem and
    // needs the full reprocess path instead.
    const targets = failed.filter((f) => /^(TABLE|FIGURE)\s/i.test(f.clause_number || ""));
    const skippedNonCaption = failed.length - targets.length;
    if (targets.length === 0) {
      return json({ fixed: 0, skipped_non_caption: skippedNonCaption, note: "no table/figure failures to target" });
    }

    const { data: standard, error: standardError } = await supabaseAdmin
      .from("standards")
      .select("file_path, standard_code, version, organization_id")
      .eq("id", standard_id)
      .eq("user_id", user_id)
      .single();
    if (standardError || !standard?.file_path) {
      console.error("[recover-failed-chunks] Error fetching standard:", standardError);
      return json({ error: "Standard not found" }, 404);
    }

    const { data: fileData, error: downloadError } = await supabaseAdmin.storage
      .from("standards").download(standard.file_path);
    if (downloadError || !fileData) {
      console.error("[recover-failed-chunks] Error downloading PDF:", downloadError);
      return json({ error: "Failed to download PDF" }, 500);
    }
    const fileBytes = new Uint8Array(await fileData.arrayBuffer());
    let srcDoc: PDFDocument;
    try {
      srcDoc = await PDFDocument.load(fileBytes, { ignoreEncryption: true });
    } catch (e) {
      console.error("[recover-failed-chunks] pdf-lib could not load document:", e);
      return json({ error: "Could not read PDF" }, 422);
    }
    const totalPages = srcDoc.getPageCount();
    const standardCode = standard.standard_code || "Unknown";
    const version = standard.version || "";

    const { data: maxRow } = await supabaseAdmin
      .from("standard_chunks")
      .select("chunk_index")
      .eq("standard_id", standard_id)
      .order("chunk_index", { ascending: false })
      .limit(1)
      .maybeSingle();
    let nextChunkIndex = (maxRow?.chunk_index ?? -1) + 1;

    let fixed = 0;
    let removedAsFalseMatch = 0;
    let stillFailed = 0;

    for (const item of targets) {
      const { data: usageLeft } = await supabaseAdmin.rpc("check_and_record_ai_usage", {
        p_user_id: user_id, p_kind: "failed_chunk_recovery", p_max: DAILY_BUDGET, p_window_seconds: 86400,
      });
      if (typeof usageLeft === "number" && usageLeft < 0) {
        console.warn(`[recover-failed-chunks] Daily budget (${DAILY_BUDGET}/day) reached — stopping for ${standard_id}`);
        break;
      }

      const anchorPage = item.page_number || 1;
      const startPage = Math.max(1, anchorPage - 1);
      const endPage = Math.min(totalPages, anchorPage + 1);
      const rangeBase64 = await extractPageRangeBase64(srcDoc, startPage, endPage);
      if (!rangeBase64) {
        console.warn(`[recover-failed-chunks] Could not isolate pages ${startPage}-${endPage} for ${item.clause_number}`);
        await bumpAttempts(supabaseAdmin, item.id, item.index_attempts);
        stillFailed++;
        continue;
      }

      const prompt =
        `This document contains pages ${startPage} to ${endPage} of an Australian/New Zealand technical Standards document. ` +
        `Transcribe ALL pages completely and accurately. ` +
        `Insert [PAGE N] at the start of each page using the ORIGINAL page numbers — the first page here is page ${startPage}. ` +
        transcriptionRules;

      let text = "";
      try {
        const visionRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": ANTHROPIC_API_KEY, "Content-Type": "application/json", "anthropic-version": "2023-06-01" },
          body: JSON.stringify({
            model: "claude-sonnet-4-6",
            max_tokens: 8000,
            messages: [{
              role: "user",
              content: [
                { type: "document", source: { type: "base64", media_type: "application/pdf", data: rangeBase64 } },
                { type: "text", text: prompt },
              ],
            }],
          }),
        });
        if (!visionRes.ok) {
          console.error(`[recover-failed-chunks] Vision call failed (${visionRes.status}) for ${item.clause_number}:`, await visionRes.text());
          await bumpAttempts(supabaseAdmin, item.id, item.index_attempts);
          stillFailed++;
          continue;
        }
        const data = await visionRes.json();
        if (data.usage) {
          logTokenUsage(supabaseAdmin, {
            userId: user_id, kind: "failed_chunk_recovery", model: "claude-sonnet-4-6", refId: standard_id,
            usage: {
              input_tokens: data.usage.input_tokens ?? 0,
              output_tokens: data.usage.output_tokens ?? 0,
              cache_read_tokens: data.usage.cache_read_input_tokens ?? 0,
              cache_creation_tokens: data.usage.cache_creation_input_tokens ?? 0,
            },
          });
        }
        text = (data.content?.[0]?.text || "").trim();
      } catch (e) {
        console.error(`[recover-failed-chunks] Vision call threw for ${item.clause_number}:`, e);
        await bumpAttempts(supabaseAdmin, item.id, item.index_attempts);
        stillFailed++;
        continue;
      }

      // Race guard: a full reprocess (or an overlapping cron tick) may have
      // already superseded this chunk. Only act if it's still there.
      const { data: deletedRows } = await supabaseAdmin
        .from("standard_chunks").delete().eq("id", item.id).select("id");
      if (!deletedRows || deletedRows.length === 0) {
        console.log(`[recover-failed-chunks] ${item.clause_number} already superseded — discarding work`);
        continue;
      }

      if (!text || text.length < 20) {
        // Re-read came back empty — treat like any other confirmed-false
        // match: the old broken chunk is gone, nothing to replace it with.
        removedAsFalseMatch++;
        continue;
      }

      // Only re-run the table/figure caption detectors — NOT the general
      // clause chunker — so this never duplicates the surrounding body-text
      // chunks that already exist for these pages from the original pass.
      const candidates: Chunk[] = [
        ...extractTableChunks(text, standardCode, version),
        ...extractFigureChunks(text, standardCode, version),
      ];
      const match = candidates.find(
        (c) => (c.clause_number || "").toUpperCase() === (item.clause_number || "").toUpperCase(),
      );

      if (!match) {
        // The fixed caption-detection logic no longer thinks this is a real
        // table/figure here — it wasn't one. Leaving it deleted (not
        // reinserted) is the fix: it stops showing up as failed forever,
        // instead of retrying a caption that was never really there.
        console.log(`[recover-failed-chunks] ${item.clause_number}: no longer detected as a real caption on pages ${startPage}-${endPage} — removed`);
        removedAsFalseMatch++;
        continue;
      }

      const { error: insertError } = await supabaseAdmin.from("standard_chunks").insert({
        standard_id,
        user_id,
        organization_id: standard.organization_id ?? null,
        clause_number: match.clause_number,
        clause_title: match.clause_title,
        content: match.content,
        page_number: anchorPage,
        chunk_index: nextChunkIndex++,
        chunk_type: match.chunk_type,
        is_normative: match.is_normative,
        embedding: null,
        is_indexed: false,
      });
      if (insertError) {
        console.error(`[recover-failed-chunks] Insert failed for ${item.clause_number}:`, insertError);
        stillFailed++;
        continue;
      }

      console.log(`[recover-failed-chunks] Fixed ${item.clause_number} for ${standard_id}`);
      fixed++;
    }

    if (fixed > 0 || removedAsFalseMatch > 0) {
      // A false-match removal deletes a chunk with nothing re-inserted in
      // its place, so total_chunks goes stale the moment this function
      // changes anything — fix it here, since nothing else ever does
      // (embed-chunks' own allDone update writes indexed/failed but never
      // touches total_chunks).
      const { count: totalCount } = await supabaseAdmin
        .from("standard_chunks")
        .select("id", { count: "exact", head: true })
        .eq("standard_id", standard_id);
      if (totalCount !== null) {
        await supabaseAdmin.from("standards").update({ total_chunks: totalCount }).eq("id", standard_id);
      }

      // indexed_chunks / failed_chunks_count / failed_chunks_labels /
      // extraction_status are embed-chunks' own responsibility — its
      // "all done" check is tier-aware (free-tier indexing caps at 25% of
      // total_chunks) and re-deriving that here would duplicate business
      // logic that must stay in exactly one place. It's built to be safely
      // re-callable on an already-complete standard — a fully-embedded one
      // costs one cheap no-op query — so call it unconditionally rather
      // than trying to predict here whether this run was enough to finish.
      const embedRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/embed-chunks`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
        body: JSON.stringify({ standard_id }),
      });
      if (!embedRes.ok) {
        console.warn(`[recover-failed-chunks] embed-chunks follow-up call failed (${embedRes.status}) for ${standard_id} — status fields may lag until the next resume tick`);
      }
    }

    return json({ fixed, removed_as_false_match: removedAsFalseMatch, still_failed: stillFailed, skipped_non_caption: skippedNonCaption });
  } catch (e) {
    console.error("[recover-failed-chunks] Unexpected error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
