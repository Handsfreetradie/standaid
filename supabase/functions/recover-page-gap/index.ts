import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";
import { getAllowedOrigin } from "../_shared/cors.ts";
import { extractPageBase64, bumpAttempts } from "../describe-figures/shared.ts";
import { sortIntoSections, chunkSections, extractTableChunks, extractFigureChunks, type Chunk } from "../process-standard/extraction.ts";
import { transcriptionRules } from "../process-standard/ocr.ts";
import { logTokenUsage } from "../_shared/log-usage.ts";

// Recovers pages the OCR pass silently dropped entirely (chunkAndPersist
// flags them as "PAGE-GAP {N}" placeholder chunks — see pipeline.ts and
// migration 20260804000000). Re-photographs just that one page, re-runs the
// exact same clause/table/figure classifier every other page goes through
// (extraction.ts, unmodified), and replaces the placeholder with whatever
// it finds. A recovered table carries the normal "pending description"
// placeholder and flows into describe-figures/poll-vision-batches exactly
// like any other table — no special-casing needed there.
//
// Own daily budget (page_gap_recovery), deliberately separate from the
// existing "vision" bucket used by describe-figures — a bad batch of gap
// recoveries must never crowd out legitimate table/figure description
// spend, or vice versa.
const DAILY_BUDGET = 40;
const BLANK_SENTINEL = "PAGE GENUINELY BLANK";

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

    const { data: gaps, error: fetchError } = await supabaseAdmin
      .from("standard_chunks")
      .select("id, page_number, index_attempts")
      .eq("standard_id", standard_id)
      .like("clause_number", "PAGE-GAP %")
      .lt("index_attempts", 3)
      .order("page_number");

    if (fetchError) {
      console.error("[recover-page-gap] Error fetching gap placeholders:", fetchError);
      return json({ error: "Failed to fetch gap placeholders" }, 500);
    }
    if (!gaps || gaps.length === 0) {
      return json({ recovered: 0, note: "no open gaps" });
    }

    const { data: standard, error: standardError } = await supabaseAdmin
      .from("standards")
      .select("file_path, standard_code, version, organization_id")
      .eq("id", standard_id)
      .eq("user_id", user_id)
      .single();
    if (standardError || !standard?.file_path) {
      console.error("[recover-page-gap] Error fetching standard:", standardError);
      return json({ error: "Standard not found" }, 404);
    }

    const { data: fileData, error: downloadError } = await supabaseAdmin.storage
      .from("standards").download(standard.file_path);
    if (downloadError || !fileData) {
      console.error("[recover-page-gap] Error downloading PDF:", downloadError);
      return json({ error: "Failed to download PDF" }, 500);
    }
    const fileBytes = new Uint8Array(await fileData.arrayBuffer());
    let srcDoc: PDFDocument;
    try {
      srcDoc = await PDFDocument.load(fileBytes, { ignoreEncryption: true });
    } catch (e) {
      console.error("[recover-page-gap] pdf-lib could not load document:", e);
      return json({ error: "Could not read PDF" }, 422);
    }

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

    let recovered = 0;
    let confirmedBlank = 0;
    let failed = 0;

    for (const gap of gaps) {
      const { data: usageLeft } = await supabaseAdmin.rpc("check_and_record_ai_usage", {
        p_user_id: user_id, p_kind: "page_gap_recovery", p_max: DAILY_BUDGET, p_window_seconds: 86400,
      });
      if (typeof usageLeft === "number" && usageLeft < 0) {
        console.warn(`[recover-page-gap] Daily budget (${DAILY_BUDGET}/day) reached — stopping for ${standard_id}`);
        break;
      }

      const pageBase64 = await extractPageBase64(srcDoc, gap.page_number);
      if (!pageBase64) {
        console.warn(`[recover-page-gap] Could not isolate page ${gap.page_number} for ${standard_id}`);
        await bumpAttempts(supabaseAdmin, gap.id, gap.index_attempts);
        failed++;
        continue;
      }

      const prompt =
        `This is a single page (page ${gap.page_number}) from an Australian/New Zealand technical Standards document. ` +
        `The automatic extraction pass produced no readable text for this page — re-transcribe it now. ` +
        transcriptionRules +
        ` If this page is genuinely blank, a cover/divider page, or otherwise has no substantive content, ` +
        `reply with EXACTLY this and nothing else: ${BLANK_SENTINEL}`;

      let text = "";
      try {
        const visionRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": ANTHROPIC_API_KEY, "Content-Type": "application/json", "anthropic-version": "2023-06-01" },
          body: JSON.stringify({
            model: "claude-sonnet-4-6",
            max_tokens: 4000,
            messages: [{
              role: "user",
              content: [
                { type: "document", source: { type: "base64", media_type: "application/pdf", data: pageBase64 } },
                { type: "text", text: prompt },
              ],
            }],
          }),
        });
        if (!visionRes.ok) {
          console.error(`[recover-page-gap] Vision call failed (${visionRes.status}) for page ${gap.page_number}:`, await visionRes.text());
          await bumpAttempts(supabaseAdmin, gap.id, gap.index_attempts);
          failed++;
          continue;
        }
        const data = await visionRes.json();
        if (data.usage) {
          logTokenUsage(supabaseAdmin, {
            userId: user_id, kind: "page_gap_recovery", model: "claude-sonnet-4-6", refId: standard_id,
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
        console.error(`[recover-page-gap] Vision call threw for page ${gap.page_number}:`, e);
        await bumpAttempts(supabaseAdmin, gap.id, gap.index_attempts);
        failed++;
        continue;
      }

      // Race guard: a reprocess (or an overlapping cron tick) may have
      // already superseded this placeholder. Only act if it's still there.
      const { data: deletedRows } = await supabaseAdmin
        .from("standard_chunks").delete().eq("id", gap.id).select("id");
      if (!deletedRows || deletedRows.length === 0) {
        console.log(`[recover-page-gap] Placeholder ${gap.id} already superseded — discarding work for page ${gap.page_number}`);
        continue;
      }

      if (!text || text.includes(BLANK_SENTINEL) || text.length < 20) {
        confirmedBlank++;
        continue;
      }

      const markedText = `[PAGE ${gap.page_number}]\n${text}`;
      const sections = sortIntoSections(markedText);
      const newChunks: Chunk[] = [
        ...chunkSections(sections, standardCode, version),
        ...extractTableChunks(markedText, standardCode, version),
        ...extractFigureChunks(markedText, standardCode, version),
      ];

      if (newChunks.length === 0) {
        confirmedBlank++;
        continue;
      }

      const records = newChunks.map((chunk) => ({
        standard_id,
        user_id,
        organization_id: standard.organization_id ?? null,
        clause_number: chunk.clause_number,
        clause_title: chunk.clause_title,
        content: chunk.content,
        // Unconditionally overwritten — sortIntoSections/chunkSections
        // default to page 1 internally for heading-less leading text, which
        // is only correct when processing a whole document starting at
        // page 1. Scoped to one isolated recovered page N, it's wrong.
        page_number: gap.page_number,
        chunk_index: nextChunkIndex++,
        chunk_type: chunk.chunk_type,
        is_normative: chunk.is_normative,
        embedding: null,
        is_indexed: false,
      }));

      const { error: insertError } = await supabaseAdmin.from("standard_chunks").insert(records);
      if (insertError) {
        console.error(`[recover-page-gap] Insert failed for recovered page ${gap.page_number}:`, insertError);
        failed++;
        continue;
      }

      console.log(`[recover-page-gap] Recovered page ${gap.page_number} for ${standard_id}: ${records.length} chunk(s)`);
      recovered++;
    }

    return json({ recovered, confirmed_blank: confirmedBlank, failed });
  } catch (e) {
    console.error("[recover-page-gap] Unexpected error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
