import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";
import { getAllowedOrigin } from "../_shared/cors.ts";
import {
  applyDescription,
  bumpAttempts,
  buildContinuationPrompt,
  buildPrompt,
  buildVisionParams,
  extractPageBase64,
} from "../describe-figures/shared.ts";

// Runs on a pg_cron heartbeat (every 2 minutes, see migration
// 20260801000001_poll_vision_batches_cron.sql) to pick up Anthropic Message
// Batches submitted by describe-figures. For each batch that has finished:
//  - writes clean results straight to standard_chunks (same as the old
//    synchronous describe-figures did)
//  - runs the small minority needing a retry page (mis-anchored table
//    caption) or a continuation page (multi-page table) through the
//    original, unchanged, synchronous /v1/messages calls — this tail is
//    identical code to what ran in production before batching, just moved
//    here instead of inline in describe-figures.
//  - one deliberate behaviour change from the old synchronous version: a
//    permanently-unusable item now bumps index_attempts (see the try/catch
//    below) instead of being silently retried by resume-stalled-indexing
//    every 10 minutes forever, which is what was actually burning Kyle's
//    daily vision budget in production.
// See /Users/kyledixon/.claude/plans/frolicking-shimmying-coral.md for why
// this hybrid (batch the primary pass, keep the tail synchronous) was chosen.

const MAX_CONTINUATIONS = 3;

interface BatchItem {
  custom_id: string;
  chunk_id: string;
  isTable: boolean;
  refNumber: string;
  caption: string;
  page: number;
}

serve(async (req) => {
  const origin = req.headers.get("Origin") || "";
  const corsHeaders = {
    "Access-Control-Allow-Origin": getAllowedOrigin(origin),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, serviceRoleKey);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader || authHeader !== `Bearer ${serviceRoleKey}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: "Service unavailable" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const anthropicHeaders = { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" };

  let appliedJobs = 0;
  try {
    const { data: jobs } = await supabaseAdmin
      .from("vision_batch_jobs")
      .select("id, standard_id, user_id, batch_id, items")
      .eq("status", "submitted");

    for (const job of jobs || []) {
      const statusRes = await fetch(`https://api.anthropic.com/v1/messages/batches/${job.batch_id}`, {
        headers: anthropicHeaders,
      });
      if (!statusRes.ok) {
        console.error(`[poll-vision-batches] Failed to check batch ${job.batch_id}:`, await statusRes.text());
        continue;
      }
      const batch = await statusRes.json();
      if (batch.processing_status !== "ended") continue; // still processing, check next cron tick

      const items: BatchItem[] = job.items || [];
      const byCustomId = new Map(items.map((it) => [it.custom_id, it]));

      // Fetch fresh index_attempts for these chunks (items[] is a static
      // snapshot from submit time, attempts may have moved since).
      const { data: chunkRows } = await supabaseAdmin
        .from("standard_chunks")
        .select("id, index_attempts")
        .in("id", items.map((it) => it.chunk_id));
      const attemptsByChunk = new Map((chunkRows || []).map((c: { id: string; index_attempts: number | null }) => [c.id, c.index_attempts]));

      const { data: standard } = await supabaseAdmin
        .from("standards")
        .select("file_path, standard_code, version, organization_id")
        .eq("id", job.standard_id)
        .single();
      const standardCode = standard?.standard_code || "Unknown";
      const stdVersion = standard?.version || "";
      const standardLabel = `${standardCode}${stdVersion ? ` ${stdVersion}` : ""}`.trim();
      const label = `[${standardLabel}]`;

      // Only downloaded lazily — most items resolve cleanly from the batch
      // result and never need a second page image.
      let srcDoc: PDFDocument | null = null;
      const getSrcDoc = async (): Promise<PDFDocument | null> => {
        if (srcDoc) return srcDoc;
        if (!standard?.file_path) return null;
        const { data: fileData } = await supabaseAdmin.storage.from("standards").download(standard.file_path);
        if (!fileData) return null;
        const fileBytes = new Uint8Array(await fileData.arrayBuffer());
        try {
          srcDoc = await PDFDocument.load(fileBytes, { ignoreEncryption: true });
        } catch (e) {
          console.error(`[poll-vision-batches] pdf-lib could not load document for ${job.standard_id}:`, e);
          return null;
        }
        return srcDoc;
      };

      let described = 0;

      // Stream the results JSONL.
      const resultsRes = await fetch(batch.results_url, { headers: anthropicHeaders });
      const resultsText = await resultsRes.text();
      for (const line of resultsText.split("\n")) {
        if (!line.trim()) continue;
        const result = JSON.parse(line);
        const item = byCustomId.get(result.custom_id);
        if (!item) continue;

        const attempts = attemptsByChunk.get(item.chunk_id) ?? 0;
        const chunk = { id: item.chunk_id, clause_number: item.isTable ? `TABLE ${item.refNumber}` : `FIGURE ${item.refNumber}`, clause_title: item.caption || null, page_number: item.page, content: "", index_attempts: attempts };

        // A permanently-unusable result (API error, "TABLE NOT ON PAGE" on
        // every candidate page, empty/short text) bumps index_attempts, same
        // as a thrown exception. The original synchronous describe-figures
        // did NOT do this for "no usable output" — only for exceptions and DB
        // write failures — which meant an item Claude could never produce
        // real output for (e.g. a genuinely blank page in the source PDF)
        // stayed at index_attempts=0 forever, so resume-stalled-indexing
        // (every 10 min) re-paid to redescribe it every single time,
        // indefinitely. Confirmed in production: 3 of Kyle's standards each
        // had one table stuck like this for days. Bumping here means it
        // stops after 3 real attempts, same cap already used everywhere else.
        try {
          if (result.result?.type !== "succeeded") {
            console.warn(`[poll-vision-batches] ${item.isTable ? "Table" : "Figure"} ${item.refNumber} batch result: ${result.result?.type}`);
            await bumpAttempts(supabaseAdmin, item.chunk_id, attempts);
            continue;
          }

          let text: string = result.result.message?.content?.[0]?.text || "";
          let usedPage = item.page;

          // ── Tail: mis-anchored caption — try page+1 synchronously ────────
          if (item.isTable && (!text || text.length < 20 || text.includes("TABLE NOT ON PAGE"))) {
            const doc = await getSrcDoc();
            const retryBase64 = doc ? await extractPageBase64(doc, item.page + 1) : null;
            text = "";
            if (retryBase64) {
              const retryPrompt = buildPrompt(true, standardLabel, item.refNumber, item.caption, item.page + 1);
              const retryRes = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: { ...anthropicHeaders, "Content-Type": "application/json" },
                body: JSON.stringify(buildVisionParams(retryBase64, retryPrompt, true)),
              });
              if (retryRes.ok) {
                const retryData = await retryRes.json();
                const retryText: string = retryData.content?.[0]?.text || "";
                if (retryText && retryText.length >= 20 && !retryText.includes("TABLE NOT ON PAGE")) {
                  text = retryText;
                  usedPage = item.page + 1;
                }
              }
            }
            if (!text) {
              console.warn(`Table ${item.refNumber}: no usable output on page ${item.page} or ${item.page + 1}, skipping`);
              await bumpAttempts(supabaseAdmin, item.chunk_id, attempts);
              continue;
            }
          }

          if (!text || (!item.isTable && text.length < 20)) {
            console.warn(`${item.isTable ? "Table" : "Figure"} ${item.refNumber}: no usable output, skipping`);
            await bumpAttempts(supabaseAdmin, item.chunk_id, attempts);
            continue;
          }

          // ── Tail: multi-page table — stitch continuation pages ───────────
          if (item.isTable && text.includes("(table continues on next page)")) {
            const doc = await getSrcDoc();
            let contPage = usedPage;
            for (let cont = 0; cont < MAX_CONTINUATIONS && text.includes("(table continues on next page)"); cont++) {
              contPage += 1;
              const contBase64 = doc ? await extractPageBase64(doc, contPage) : null;
              if (!contBase64) break;
              const contRes = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: { ...anthropicHeaders, "Content-Type": "application/json" },
                body: JSON.stringify(buildVisionParams(contBase64, buildContinuationPrompt(standardLabel, item.refNumber), true)),
              });
              if (!contRes.ok) break;
              const contData = await contRes.json();
              const contText: string = contData.content?.[0]?.text || "";
              if (!contText || contText.length < 20 || contText.includes("TABLE NOT ON PAGE")) break;
              text = text.replace(/\(table continues on next page\)\s*$/i, "").trimEnd() +
                `\n\n[continued — page ${contPage}]\n\n` + contText;
              console.log(`[poll-vision-batches] Table ${item.refNumber}: stitched continuation from page ${contPage}`);
            }
          }

          await applyDescription(supabaseAdmin, {
            chunk, description: text, isTable: item.isTable, refNumber: item.refNumber, caption: item.caption,
            label, usedPage, standard_id: job.standard_id, user_id: job.user_id,
            organization_id: standard?.organization_id ?? null,
          });
          described++;
        } catch (itemErr) {
          console.error(`[poll-vision-batches] Error applying chunk ${item.chunk_id}:`, itemErr);
          await bumpAttempts(supabaseAdmin, item.chunk_id, attempts);
        }
      }

      await supabaseAdmin.from("vision_batch_jobs").update({ status: "applied" }).eq("id", job.id);
      appliedJobs++;
      console.log(`[poll-vision-batches] Applied batch ${job.batch_id} — ${described}/${items.length} described`);

      const baseUrl = Deno.env.get("SUPABASE_URL");

      // More work than fit in this batch (rare — standards ceiling is 200,
      // AS/NZS 3000 has ~124) or items skipped for page-extraction failure —
      // let describe-figures pick up the remainder in a fresh batch.
      const { count: remaining } = await supabaseAdmin
        .from("standard_chunks")
        .select("*", { count: "exact", head: true })
        .eq("standard_id", job.standard_id)
        .eq("is_indexed", false)
        .lt("index_attempts", 3)
        .or("clause_number.like.FIGURE%,clause_number.like.TABLE%");

      // Independent of each other — same as the original describe-figures:
      // newly-described chunks get embedded right away even if more items
      // still need a fresh batch.
      if ((remaining || 0) > 0) {
        const resubmit = fetch(`${baseUrl}/functions/v1/describe-figures`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
          body: JSON.stringify({ standard_id: job.standard_id, user_id: job.user_id }),
        }).catch((e) => console.error("Failed to resubmit describe-figures:", e));
        (globalThis as any).EdgeRuntime?.waitUntil?.(resubmit);
      }

      if (described > 0) {
        const embedTrigger = fetch(`${baseUrl}/functions/v1/embed-chunks`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
          body: JSON.stringify({ standard_id: job.standard_id, user_id: job.user_id }),
        }).catch((e) => console.error("Failed to trigger embed-chunks:", e));
        (globalThis as any).EdgeRuntime?.waitUntil?.(embedTrigger);
      }
    }

    return new Response(JSON.stringify({ applied: appliedJobs }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[poll-vision-batches] Unexpected error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
