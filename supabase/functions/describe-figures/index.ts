import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAllowedOrigin } from "../_shared/cors.ts";

const TIME_BUDGET_MS = 85_000;

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

    // Convert PDF to base64 for Claude
    const base64Pdf = btoa(String.fromCharCode(...fileBytes));
    console.log(`[describe-figures] Converted PDF to base64: ${base64Pdf.length} chars`);

    const t0 = Date.now();
    let described = 0;

    try {
      for (const chunk of figureChunks) {
        // Check time budget before each figure
        if (Date.now() - t0 > TIME_BUDGET_MS) {
          console.log(`[describe-figures] Time budget reached after ${described} figures, will retrigger`);
          break;
        }

        try {
          const figureNumber = chunk.clause_number.replace(/^FIGURE\s+/i, "").trim();
          const caption = chunk.clause_title || "";
          const page = chunk.page_number || 1;

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
                    { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64Pdf } },
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

    if ((remaining || 0) > 0) {
      // More figures to describe — retrigger self
      console.log(`[describe-figures] ${remaining} figures remaining, retriggering`);
      fetch(`${baseUrl}/functions/v1/describe-figures`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
        body: JSON.stringify({ standard_id, user_id }),
      }).catch(e => console.error("Failed to retrigger describe-figures:", e));
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
