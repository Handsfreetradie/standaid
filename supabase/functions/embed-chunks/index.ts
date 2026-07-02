import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EMBED_BATCH_SIZE = 50;
const PARALLEL_EMBED = 5;
// Re-trigger self if elapsed exceeds this — leaves buffer before Supabase's 150s hard limit
const TIME_BUDGET_MS = 90_000;

async function generateEmbeddingsBatch(texts: string[], apiKey: string): Promise<(number[] | null)[]> {
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: texts.map(t => t.slice(0, 8000)),
        }),
      });
      if (response.status === 429) {
        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
        continue;
      }
      if (!response.ok) throw new Error(`Embedding API error: ${response.status}`);
      const data = await response.json();
      return data.data.map((d: any) => d.embedding);
    } catch (e) {
      if (attempt === MAX_RETRIES - 1) return texts.map(() => null);
      await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
    }
  }
  return texts.map(() => null);
}

serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    serviceRoleKey
  );

  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  if (!OPENAI_API_KEY) {
    return new Response(JSON.stringify({ error: "Service unavailable" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const t0 = Date.now();

  try {
    // Auth: internal calls (process-standard / self-retrigger) use the service
    // role key; the frontend stall-recovery kick uses the user's JWT. This
    // endpoint spends OpenAI credits, so it must never run unauthenticated.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const isInternalCall = authHeader === `Bearer ${serviceRoleKey}`;
    let callerUserId: string | null = null;
    if (!isInternalCall) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
      if (userError || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      callerUserId = user.id;
    }

    const body = await req.json();
    const { standard_id } = body;

    if (!standard_id) {
      return new Response(JSON.stringify({ error: "standard_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: standard } = await supabaseAdmin
      .from("standards")
      .select("total_chunks, extraction_status, user_id")
      .eq("id", standard_id)
      .single();

    // User-JWT callers can only kick embedding for their own standard
    if (callerUserId && standard && standard.user_id !== callerUserId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!standard || standard.extraction_status === "complete" || standard.extraction_status === "failed") {
      return new Response(JSON.stringify({ status: "skipped" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Tier is always looked up from the standard's owner, never a body value
    const user_id = standard.user_id;

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("subscription_tier")
      .eq("user_id", user_id)
      .single();

    const tier = profile?.subscription_tier || "pro";
    const totalChunks = standard.total_chunks || 0;
    const indexLimit = tier === "free"
      ? Math.max(1, Math.ceil(totalChunks * 0.25))
      : totalChunks;

    let processedCount = 0;
    let timedOut = false;

    // Process un-embedded chunks in a loop — re-trigger self if time budget exceeded
    while (true) {
      if (Date.now() - t0 > TIME_BUDGET_MS) {
        timedOut = true;
        break;
      }

      // Fetch next batch of un-embedded chunks within the index limit.
      // Skip figure placeholders — describe-figures rewrites their content with a real
      // description, after which they get embedded. Embedding the placeholder would
      // pollute search with empty "description will be generated shortly" chunks.
      const { data: chunks } = await supabaseAdmin
        .from("standard_chunks")
        .select("id, chunk_index, content")
        .eq("standard_id", standard_id)
        .is("embedding", null)
        .not("content", "ilike", "%visual description will be generated shortly%")
        .lt("chunk_index", indexLimit)
        .order("chunk_index")
        .limit(EMBED_BATCH_SIZE * PARALLEL_EMBED);

      if (!chunks || chunks.length === 0) break;

      // Split into batches and process in parallel groups
      const batches: typeof chunks[] = [];
      for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
        batches.push(chunks.slice(i, i + EMBED_BATCH_SIZE));
      }

      for (let i = 0; i < batches.length; i += PARALLEL_EMBED) {
        const group = batches.slice(i, i + PARALLEL_EMBED);
        const results = await Promise.all(
          group.map(batch => generateEmbeddingsBatch(batch.map(c => c.content), OPENAI_API_KEY))
        );

        // Write embeddings back to DB — parallel updates within each batch
        await Promise.all(
          group.flatMap((batch, gi) =>
            batch.map((chunk, idx) => {
              const emb = results[gi][idx];
              if (!emb) return Promise.resolve();
              return supabaseAdmin
                .from("standard_chunks")
                .update({ embedding: JSON.stringify(emb), is_indexed: true })
                .eq("id", chunk.id);
            })
          )
        );

        processedCount += group.reduce((sum, b) => sum + b.length, 0);
        console.log(`[embed-chunks][${standard_id}] Processed ${processedCount} chunks — ${Date.now() - t0}ms elapsed`);
      }
    }

    // Check remaining un-embedded chunks — excluding figure placeholders so the
    // standard can complete while figures are still being described in the background.
    const { count: remaining } = await supabaseAdmin
      .from("standard_chunks")
      .select("id", { count: "exact", head: true })
      .eq("standard_id", standard_id)
      .is("embedding", null)
      .not("content", "ilike", "%visual description will be generated shortly%")
      .lt("chunk_index", indexLimit);

    const allDone = (remaining ?? 1) === 0;

    if (allDone) {
      const { count: indexedCount } = await supabaseAdmin
        .from("standard_chunks")
        .select("id", { count: "exact", head: true })
        .eq("standard_id", standard_id)
        .eq("is_indexed", true);

      await supabaseAdmin
        .from("standards")
        .update({ extraction_status: "complete", indexed_chunks: indexedCount || 0 })
        .eq("id", standard_id);

      await supabaseAdmin
        .from("processing_jobs")
        .update({ status: "complete", completed_at: new Date().toISOString() })
        .eq("standard_id", standard_id);

      console.log(`[embed-chunks][${standard_id}] Complete — ${indexedCount} chunks indexed`);
    } else if (timedOut) {
      // Re-trigger self to continue from where we left off
      const selfUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/embed-chunks`;
      fetch(selfUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ standard_id, user_id }),
      }).catch(e => console.error("Failed to re-trigger embed-chunks:", e));

      console.log(`[embed-chunks][${standard_id}] Timed out after ${processedCount} chunks — re-triggered`);
    }

    return new Response(
      JSON.stringify({ status: allDone ? "complete" : "continued", processed: processedCount }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("embed-chunks error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
