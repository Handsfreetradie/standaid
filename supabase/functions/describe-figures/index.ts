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

    // Fetch undescribed figure chunks (is_indexed = false means not yet described)
    const { data: figureChunks, error: fetchError } = await supabaseAdmin
      .from("standard_chunks")
      .select("id, clause_number, clause_title, page_number")
      .eq("standard_id", standard_id)
      .like("clause_number", "FIGURE%")
      .eq("is_indexed", false);

    if (fetchError) {
      console.error("Error fetching figure chunks:", fetchError);
      return new Response(JSON.stringify({ error: "Failed to fetch figure chunks" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!figureChunks || figureChunks.length === 0) {
      console.log(`[describe-figures] No undescribed figure chunks for standard ${standard_id}`);
      return new Response(JSON.stringify({ described: 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[describe-figures] Found ${figureChunks.length} undescribed figure chunks`);

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

    try {
      for (const chunk of figureChunks.slice(0, MAX_FIGURES_PER_STANDARD)) {
        // Check time budget before each figure
        if (Date.now() - t0 > TIME_BUDGET_MS) {
          console.log(`[describe-figures] Time budget reached after ${described} figures, will retrigger`);
          break;
        }

        try {
          const figureNumber = chunk.clause_number.replace(/^FIGURE\s+/i, "").trim();
          const caption = chunk.clause_title || "";
          const page = chunk.page_number || 1;

          // Send only the figure's page — not the whole document
          const pageBase64 = await extractPageBase64(srcDoc, page);
          if (!pageBase64) {
            console.warn(`Figure ${figureNumber}: could not isolate page ${page}, skipping`);
            continue;
          }

          const prompt =
            `You are helping Australian tradies understand AS/NZS 3000:2018 Wiring Rules diagrams.\n\n` +
            `Figure ${figureNumber}${caption ? ` — ${caption}` : ""} is on page ${page} of this document.\n\n` +
            `Describe this diagram for a tradie on the job:\n` +
            `1. What does this diagram show? (2-3 sentences, plain English)\n` +
            `2. What should a tradie look for when checking their installation against this diagram? (3-4 dot points)\n` +
            `3. Common mistakes or inspection points? (2-3 dot points)\n\n` +
            `Be practical. No jargon.`;

          const completionResponse = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "x-api-key": ANTHROPIC_API_KEY, "Content-Type": "application/json", "anthropic-version": "2023-06-01" },
            body: JSON.stringify({
              model: "claude-opus-4-8",
              max_tokens: 1000,
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
            console.error(`Figure ${figureNumber} description failed:`, completionResponse.status, errText);
            continue;
          }

          const completionData = await completionResponse.json();
          const description: string = completionData.content?.[0]?.text || "";

          if (!description || description.length < 20) {
            console.warn(`Figure ${figureNumber}: description too short, skipping`);
            continue;
          }

          const standardCode = standard.standard_code || "Unknown";
          const version = standard.version || "";
          const label = `[${standardCode}${version ? ` ${version}` : ""}]`;
          const newContent =
            `${label} Figure ${figureNumber}${caption ? ` — ${caption}` : ""}\n\n` +
            description;

          // Set is_indexed: true so re-triggered runs skip this figure
          const { error: updateError } = await supabaseAdmin
            .from("standard_chunks")
            .update({ content: newContent, is_indexed: true })
            .eq("id", chunk.id);

          if (updateError) {
            console.error(`Failed to update chunk for Figure ${figureNumber}:`, updateError);
            continue;
          }

          described++;
          console.log(`[describe-figures] Described Figure ${figureNumber} (${described}/${figureChunks.length})`);
        } catch (figureErr) {
          console.error(`Error processing figure chunk ${chunk.id}:`, figureErr);
        }
      }
    } catch (e) {
      console.error("[describe-figures] Error processing figures:", e);
    }

    const baseUrl = Deno.env.get("SUPABASE_URL");

    // Check if there are still undescribed figures left
    const { count: remaining } = await supabaseAdmin
      .from("standard_chunks")
      .select("*", { count: "exact", head: true })
      .eq("standard_id", standard_id)
      .like("clause_number", "FIGURE%")
      .eq("is_indexed", false);

    // How many figures have already been described for this standard — the
    // global ceiling that survives across self-retriggers.
    const { count: totalDescribed } = await supabaseAdmin
      .from("standard_chunks")
      .select("*", { count: "exact", head: true })
      .eq("standard_id", standard_id)
      .like("clause_number", "FIGURE%")
      .eq("is_indexed", true);

    if ((remaining || 0) > 0 && (totalDescribed || 0) < MAX_FIGURES_PER_STANDARD) {
      // More figures to describe and still under the ceiling — retrigger self
      console.log(`[describe-figures] ${remaining} figures remaining, retriggering`);
      fetch(`${baseUrl}/functions/v1/describe-figures`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
        body: JSON.stringify({ standard_id, user_id }),
      }).catch(e => console.error("Failed to retrigger describe-figures:", e));
    } else if ((remaining || 0) > 0) {
      console.warn(`[describe-figures] Reached ${MAX_FIGURES_PER_STANDARD}-figure ceiling for ${standard_id}; ${remaining} left undescribed`);
    }

    if (described > 0) {
      // Reset extraction_status to 'processing' so embed-chunks won't skip
      await supabaseAdmin
        .from("standards")
        .update({ extraction_status: "processing" })
        .eq("id", standard_id);

      fetch(`${baseUrl}/functions/v1/embed-chunks`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
        body: JSON.stringify({ standard_id, user_id }),
      }).catch(e => console.error("Failed to trigger embed-chunks:", e));
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
