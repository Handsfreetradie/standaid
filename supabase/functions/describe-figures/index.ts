import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";
import { getAllowedOrigin } from "../_shared/cors.ts";

const TIME_BUDGET_MS = 85_000;
// Global ceiling on figures described per standard, enforced across
// self-retriggers — covers real standards (AS/NZS 3000 has ~124 figures)
// while capping a pathological/crafted document from driving unbounded
// Opus vision spend.
const MAX_FIGURES_PER_STANDARD = 200;

// Convert bytes to base64 in fixed slices. Spreading a whole file into
// String.fromCharCode(...bytes) overflows the call stack above ~125KB, which
// crashed this function on every real (multi-MB) standard.
function toBase64(bytes: Uint8Array): string {
  const SLICE = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += SLICE) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + SLICE) as unknown as number[]);
  }
  return btoa(binary);
}

// Extract a single page as its own small PDF so each vision call carries one
// page (~tens of KB) instead of re-uploading the entire multi-MB document per
// figure — fixes both the crash and the per-figure cost blowout.
async function extractPageBase64(srcDoc: PDFDocument, pageNumber: number): Promise<string | null> {
  try {
    const total = srcDoc.getPageCount();
    const idx = Math.min(Math.max(pageNumber - 1, 0), total - 1);
    const out = await PDFDocument.create();
    const [pg] = await out.copyPages(srcDoc, [idx]);
    out.addPage(pg);
    return toBase64(await out.save());
  } catch (e) {
    console.warn(`Could not extract page ${pageNumber}:`, e);
    return null;
  }
}

serve(async (req) => {
  const origin = req.headers.get("Origin") || "";
  const corsHeaders = {
    "Access-Control-Allow-Origin": getAllowedOrigin(origin),
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    serviceRoleKey
  );

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || authHeader !== `Bearer ${serviceRoleKey}`) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { standard_id, user_id } = await req.json();
    if (!standard_id || !user_id) {
      return new Response(JSON.stringify({ error: "standard_id and user_id are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: "Service unavailable" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch undescribed figure AND table chunks (is_indexed = false means not
    // yet processed). Tables get a vision transcription to markdown — the
    // linear text extraction flattens and fuses table cells, so the page image
    // is the only reliable source of cell-accurate values.
    const { data: figureChunks, error: fetchError } = await supabaseAdmin
      .from("standard_chunks")
      .select("id, clause_number, clause_title, page_number, content")
      .eq("standard_id", standard_id)
      .or("clause_number.like.FIGURE%,clause_number.like.TABLE%")
      .eq("is_indexed", false);

    if (fetchError) {
      console.error("Error fetching figure/table chunks:", fetchError);
      return new Response(JSON.stringify({ error: "Failed to fetch figure chunks" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Only table chunks that carry the transcription placeholder get a vision
    // pass — reference-only table chunks (no caption found) have no known page
    // to photograph and embed as-is.
    const workChunks = (figureChunks || []).filter((c: any) =>
      c.clause_number?.toUpperCase().startsWith("FIGURE") ||
      (c.content || "").includes("transcription of this table will be generated shortly")
    );

    if (workChunks.length === 0) {
      console.log(`[describe-figures] No undescribed figure/table chunks for standard ${standard_id}`);
      return new Response(JSON.stringify({ described: 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[describe-figures] Found ${workChunks.length} undescribed figure/table chunks`);

    const { data: standard, error: standardError } = await supabaseAdmin
      .from("standards")
      .select("file_path, standard_code, version")
      .eq("id", standard_id)
      .eq("user_id", user_id)
      .single();

    if (standardError || !standard?.file_path) {
      console.error("Error fetching standard:", standardError);
      return new Response(JSON.stringify({ error: "Standard not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: fileData, error: downloadError } = await supabaseAdmin.storage
      .from("standards")
      .download(standard.file_path);

    if (downloadError || !fileData) {
      console.error("Error downloading PDF:", downloadError);
      return new Response(JSON.stringify({ error: "Failed to download PDF" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fileBytes = new Uint8Array(await fileData.arrayBuffer());
    console.log(`[describe-figures] Downloaded PDF: ${fileBytes.length} bytes`);

    // Load once; each figure gets only its own page sent to the vision model.
    let srcDoc: PDFDocument;
    try {
      srcDoc = await PDFDocument.load(fileBytes, { ignoreEncryption: true });
    } catch (e) {
      console.error("[describe-figures] pdf-lib could not load document:", e);
      return new Response(JSON.stringify({ error: "Could not read PDF" }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const t0 = Date.now();
    let described = 0;

    const standardCode = standard.standard_code || "Unknown";
    const stdVersion = standard.version || "";
    const standardLabel = `${standardCode}${stdVersion ? ` ${stdVersion}` : ""}`.trim();
    const label = `[${standardLabel}]`;

    try {
      for (const chunk of workChunks.slice(0, MAX_FIGURES_PER_STANDARD)) {
        // Check time budget before each item
        if (Date.now() - t0 > TIME_BUDGET_MS) {
          console.log(`[describe-figures] Time budget reached after ${described} items, will retrigger`);
          break;
        }

        try {
          const isTable = chunk.clause_number.toUpperCase().startsWith("TABLE");
          const kind = isTable ? "Table" : "Figure";
          const refNumber = chunk.clause_number.replace(/^(FIGURE|TABLE)\s+/i, "").trim();
          const caption = chunk.clause_title || "";
          const page = chunk.page_number || 1;

          // Send only the relevant page — not the whole document. Tables get
          // a second shot at the next page: mis-anchored captions (wrapped
          // reference lines) often sit one page before the table itself, and
          // big tables start on the page after their heading.
          const candidatePages = isTable ? [page, page + 1] : [page];
          let description = "";
          let usedPage = page;
          for (const tryPage of candidatePages) {
            const pageBase64 = await extractPageBase64(srcDoc, tryPage);
            if (!pageBase64) {
              console.warn(`${kind} ${refNumber}: could not isolate page ${tryPage}`);
              continue;
            }

          const prompt = isTable
            ? `This page is from ${standardLabel !== "Unknown" ? standardLabel : "an Australian Standard"}. ` +
              `TABLE ${refNumber}${caption ? ` — ${caption}` : ""} appears on this page.\n\n` +
              `Transcribe that table COMPLETELY as a GitHub-flavoured markdown table:\n` +
              `- Keep the header rows exactly as printed, including units (mm², A, V, °C, m).\n` +
              `- Transcribe EVERY visible row and column — never summarise, skip rows, or round values.\n` +
              `- Copy every number exactly as printed, including decimal points.\n` +
              `- Include any notes printed below the table, after the table.\n` +
              `- If the table clearly continues on another page, transcribe what is visible and end with: (table continues on next page)\n` +
              `- If the table is not actually on this page, reply with exactly: TABLE NOT ON PAGE\n\n` +
              `Output ONLY the markdown table and its notes — no commentary.`
            : `You are helping Australian tradies understand diagrams from ${standardLabel !== "Unknown" ? standardLabel : "an Australian Standard"}.\n\n` +
              `Figure ${refNumber}${caption ? ` — ${caption}` : ""} is on page ${page} of this document.\n\n` +
              `Describe this diagram for a tradie on the job:\n` +
              `1. What does this diagram show? (2-3 sentences, plain English)\n` +
              `2. What should a tradie look for when checking their installation against this diagram? (3-4 dot points)\n` +
              `3. Common mistakes or inspection points? (2-3 dot points)\n\n` +
              `Be practical. No jargon.`;

            const completionResponse = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: { "x-api-key": ANTHROPIC_API_KEY, "Content-Type": "application/json", "anthropic-version": "2023-06-01" },
              body: JSON.stringify({
                // Sonnet transcribes documents as accurately as Opus at ~1/5
                // the price — the Opus vision run across two standards
                // (~300 calls) drained the API credit balance in one day.
                model: "claude-sonnet-4-6",
                // Big AS/NZS tables run to thousands of tokens; figures don't.
                max_tokens: isTable ? 4000 : 1000,
                messages: [
                  {
                    role: "user",
                    content: [
                      { type: "document", source: { type: "base64", media_type: "application/pdf", data: pageBase64 } },
                      { type: "text", text: prompt },
                    ],
                  },
                ],
              }),
            });

            if (!completionResponse.ok) {
              const errText = await completionResponse.text();
              console.error(`${kind} ${refNumber} description failed:`, completionResponse.status, errText);
              break;
            }

            const completionData = await completionResponse.json();
            const text: string = completionData.content?.[0]?.text || "";
            if (text && text.length >= 20 && !text.includes("TABLE NOT ON PAGE")) {
              description = text;
              usedPage = tryPage;
              break;
            }
            console.warn(`${kind} ${refNumber}: not found on page ${tryPage}`);
          }

          if (!description) {
            console.warn(`${kind} ${refNumber}: no usable output, skipping`);
            continue;
          }

          const newContent = isTable
            ? `${label} Table ${refNumber}${caption ? `: ${caption}` : ""}\n\n${description}`
            : `${label} Figure ${refNumber}${caption ? ` — ${caption}` : ""}\n\n${description}`;

          // Set is_indexed: true so re-triggered runs skip this item; correct
          // the page anchor if the table was found on the retry page.
          const { error: updateError } = await supabaseAdmin
            .from("standard_chunks")
            .update({ content: newContent, is_indexed: true, page_number: usedPage })
            .eq("id", chunk.id);

          if (updateError) {
            console.error(`Failed to update chunk for ${kind} ${refNumber}:`, updateError);
            continue;
          }

          // Register transcribed tables in standard_tables so query-time
          // "Table X" lookups resolve to a page (schema existed but nothing
          // ever wrote to it). image_url is intentionally empty — the chat
          // falls back to the "Open Table X" PDF page link.
          if (isTable) {
            await supabaseAdmin.from("standard_tables")
              .delete()
              .eq("standard_id", standard_id)
              .eq("table_number", refNumber);
            const { error: tblInsertError } = await supabaseAdmin.from("standard_tables").insert({
              standard_id,
              user_id,
              table_number: refNumber,
              caption: caption || null,
              page_number: usedPage,
              image_url: "",
            });
            if (tblInsertError) console.error(`standard_tables insert failed for Table ${refNumber}:`, tblInsertError);
          }

          described++;
          console.log(`[describe-figures] Described ${kind} ${refNumber} (${described}/${workChunks.length})`);
        } catch (figureErr) {
          console.error(`Error processing chunk ${chunk.id}:`, figureErr);
        }
      }
    } catch (e) {
      console.error("[describe-figures] Error processing figures/tables:", e);
    }

    const baseUrl = Deno.env.get("SUPABASE_URL");

    // Check if there is still undescribed work left: figure chunks, plus table
    // chunks still carrying the transcription placeholder (reference-only
    // table chunks are embedded as-is and never processed here).
    const [{ count: remainingFigs }, { count: remainingTbls }] = await Promise.all([
      supabaseAdmin.from("standard_chunks")
        .select("*", { count: "exact", head: true })
        .eq("standard_id", standard_id)
        .like("clause_number", "FIGURE%")
        .eq("is_indexed", false),
      supabaseAdmin.from("standard_chunks")
        .select("*", { count: "exact", head: true })
        .eq("standard_id", standard_id)
        .like("clause_number", "TABLE%")
        .ilike("content", "%transcription of this table will be generated shortly%")
        .eq("is_indexed", false),
    ]);
    const remaining = (remainingFigs || 0) + (remainingTbls || 0);

    // How many figures/tables have already been described for this standard —
    // the global ceiling that survives across self-retriggers.
    const { count: totalDescribed } = await supabaseAdmin
      .from("standard_chunks")
      .select("*", { count: "exact", head: true })
      .eq("standard_id", standard_id)
      .or("clause_number.like.FIGURE%,clause_number.like.TABLE%")
      .eq("is_indexed", true);

    // Only retrigger when this run made progress. Retriggering on
    // remaining>0 alone caused a ~1.5s hot-loop during an API credit outage:
    // every call failed instantly, described stayed 0, and the function
    // re-fired itself ~860 times in 20 minutes (each run re-downloading the
    // multi-MB PDF). If nothing was described, stop — the next upload or a
    // manual kick resumes the work once the underlying problem is fixed.
    if (described > 0 && (remaining || 0) > 0 && (totalDescribed || 0) < MAX_FIGURES_PER_STANDARD) {
      // More figures to describe and still under the ceiling — retrigger self
      console.log(`[describe-figures] ${remaining} figures/tables remaining, retriggering`);
      const retrigger = fetch(`${baseUrl}/functions/v1/describe-figures`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
        body: JSON.stringify({ standard_id, user_id }),
      }).catch(e => console.error("Failed to retrigger describe-figures:", e));
      (globalThis as any).EdgeRuntime?.waitUntil?.(retrigger);
    } else if ((remaining || 0) > 0) {
      console.warn(`[describe-figures] Reached ${MAX_FIGURES_PER_STANDARD}-figure ceiling for ${standard_id}; ${remaining} left undescribed`);
    }

    if (described > 0) {
      // Reset extraction_status to 'processing' so embed-chunks won't skip
      await supabaseAdmin
        .from("standards")
        .update({ extraction_status: "processing" })
        .eq("id", standard_id);

      const embedTrigger = fetch(`${baseUrl}/functions/v1/embed-chunks`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
        body: JSON.stringify({ standard_id, user_id }),
      }).catch(e => console.error("Failed to trigger embed-chunks:", e));
      (globalThis as any).EdgeRuntime?.waitUntil?.(embedTrigger);
      console.log(`[describe-figures] Triggered embed-chunks for ${described} described figures`);
    }

    return new Response(JSON.stringify({ described, remaining: remaining || 0 }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[describe-figures] Unexpected error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
