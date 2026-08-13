import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PAGE_GAP_SENTINEL } from "../process-standard/pipeline.ts";
import { logTokenUsage } from "../_shared/log-usage.ts";
import { getAllowedOrigin } from "../_shared/cors.ts";

const EMBED_BATCH_SIZE = 50;
const PARALLEL_EMBED = 5;
// Re-trigger self if elapsed exceeds this — leaves buffer before Supabase's 150s hard limit
const TIME_BUDGET_MS = 90_000;

// Contextual retrieval (Anthropic's technique). For each chunk, a cheap Haiku
// pass writes one sentence situating it within the document, prepended to the
// content before embedding. A bare table row or a sub-clause fragment then
// carries "which standard, which section, what it covers" — which lifts recall
// on the vague, keyword-poor questions tradies actually ask. Batched ~10 chunks
// per call to keep cost down; fully degrading — any failure just embeds the
// chunk without the extra line.
async function contextualizeChunks(
  chunks: Array<{ id: string; content: string; context_generated?: boolean }>,
  docTitle: string,
  apiKey: string,
  usageLogger: { supabaseAdmin: any; userId: string; standardId: string },
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const need = chunks.filter((c) => !c.context_generated && (c.content || "").length > 200);
  const GROUP = 10;
  for (let i = 0; i < need.length; i += GROUP) {
    const group = need.slice(i, i + GROUP);
    const listing = group.map((c, j) => `[${j}] ${(c.content || "").replace(/\s+/g, " ").slice(0, 500)}`).join("\n\n");
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": apiKey, "Content-Type": "application/json", "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 500,
          messages: [{
            role: "user",
            content: `These are numbered excerpts from "${docTitle}". For EACH excerpt, write ONE short sentence (max 20 words) situating it within the document — the section/topic it belongs to and what it covers — so it can be found by search. Reply as "[n] sentence" lines, one per excerpt, and nothing else.\n\n${listing}`,
          }],
        }),
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (data.usage) {
        logTokenUsage(usageLogger.supabaseAdmin, {
          userId: usageLogger.userId, kind: "contextualize", model: "claude-haiku-4-5", refId: usageLogger.standardId,
          usage: {
            input_tokens: data.usage.input_tokens ?? 0,
            output_tokens: data.usage.output_tokens ?? 0,
            cache_read_tokens: data.usage.cache_read_input_tokens ?? 0,
            cache_creation_tokens: data.usage.cache_creation_input_tokens ?? 0,
          },
        });
      }
      const text = data.content?.[0]?.text || "";
      for (const m of text.matchAll(/\[(\d+)\]\s*(.+?)(?=\n\[\d+\]|$)/gs)) {
        const idx = parseInt(m[1], 10);
        if (group[idx]) out.set(group[idx].id, m[2].trim().replace(/\s+/g, " ").slice(0, 220));
      }
    } catch (e) {
      console.error("[embed-chunks] contextualize batch failed:", e);
    }
  }
  return out;
}

async function generateEmbeddingsBatch(
  texts: string[],
  apiKey: string,
  usageLogger: { supabaseAdmin: any; userId: string; standardId: string },
): Promise<(number[] | null)[]> {
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
      if (data.usage) {
        logTokenUsage(usageLogger.supabaseAdmin, {
          userId: usageLogger.userId, kind: "embed", model: "text-embedding-3-small", refId: usageLogger.standardId,
          usage: { input_tokens: data.usage.prompt_tokens ?? 0, output_tokens: 0 },
        });
      }
      return data.data.map((d: any) => d.embedding);
    } catch (e) {
      if (attempt === MAX_RETRIES - 1) return texts.map(() => null);
      await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
    }
  }
  return texts.map(() => null);
}

serve(async (req) => {
  const origin = req.headers.get("Origin") || "";
  const corsHeaders = {
    "Access-Control-Allow-Origin": getAllowedOrigin(origin),
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
  // Optional — contextual retrieval is a nice-to-have. If the key is absent we
  // simply embed without the situating line rather than failing the upload.
  const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

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
      .select("total_chunks, extraction_status, user_id, title")
      .eq("id", standard_id)
      .single();

    // User-JWT callers can only kick embedding for their own standard
    if (callerUserId && standard && standard.user_id !== callerUserId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // "complete" standards are allowed through: describe-figures rewrites
    // figure/table placeholders AFTER completion and re-triggers this function
    // to embed them. The chunk query below only picks un-embedded rows, so a
    // fully-embedded complete standard costs one cheap no-op query.
    if (!standard || standard.extraction_status === "failed") {
      return new Response(JSON.stringify({ status: "skipped" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Tier is always looked up from the standard's owner, never a body value
    const user_id = standard.user_id;

    // Heartbeat: each ~90s work window (including self-retriggers) refreshes
    // this, so the stale-job sweeper knows a long embedding chain is alive.
    await supabaseAdmin.from("processing_jobs")
      .update({ heartbeat_at: new Date().toISOString() })
      .eq("standard_id", standard_id)
      .in("status", ["pending", "processing"]);

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("subscription_tier")
      .eq("user_id", user_id)
      .single();

    const tier = profile?.subscription_tier || "free"; // least privilege — a missing profile must never grant pro
    const totalChunks = standard.total_chunks || 0;
    const indexLimit = tier === "free"
      ? Math.max(1, Math.ceil(totalChunks * 0.25))
      : totalChunks;

    let processedCount = 0;
    let timedOut = false;
    let embedFailure = false;

    // Process un-embedded chunks in a loop — re-trigger self if time budget exceeded
    while (true) {
      if (Date.now() - t0 > TIME_BUDGET_MS) {
        timedOut = true;
        break;
      }

      // Fetch next batch of un-embedded chunks within the index limit.
      // Skip figure/table placeholders — describe-figures rewrites their content
      // with a real description/transcription, after which they get embedded.
      // Embedding the placeholder would pollute search with junk chunks.
      // Table and figure chunks are ALWAYS within the limit: they carry the
      // highest chunk_index values (appended after clause chunks), so the free
      // tier's 25% cutoff used to exclude every table — the content users ask
      // about most.
      const { data: chunks } = await supabaseAdmin
        .from("standard_chunks")
        .select("id, chunk_index, content, context_generated, index_attempts")
        .eq("standard_id", standard_id)
        .is("embedding", null)
        .lt("index_attempts", 3)
        .not("content", "ilike", "%visual description will be generated shortly%")
        .not("content", "ilike", "%transcription of this table will be generated shortly%")
        .not("content", "ilike", `%${PAGE_GAP_SENTINEL}%`)
        .or(`chunk_index.lt.${indexLimit},clause_number.like.TABLE%,clause_number.like.FIGURE%`)
        .order("chunk_index")
        .limit(EMBED_BATCH_SIZE * PARALLEL_EMBED);

      if (!chunks || chunks.length === 0) break;

      // Prepend a one-line situating context to each chunk BEFORE embedding, so
      // the embedded text and the retrieved text both carry it. Mutates content
      // in memory; the flag + new content are persisted in the embedding write
      // below (one round-trip, no extra writes). Skipped entirely if no key.
      if (ANTHROPIC_API_KEY) {
        const ctxMap = await contextualizeChunks(chunks, standard.title || "an Australian Standard", ANTHROPIC_API_KEY, {
          supabaseAdmin, userId: user_id, standardId: standard_id,
        });
        for (const c of chunks) {
          const ctx = ctxMap.get(c.id);
          if (ctx) c.content = `[Context] ${ctx}\n\n${c.content}`;
        }
      }

      // Split into batches and process in parallel groups
      const batches: typeof chunks[] = [];
      for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
        batches.push(chunks.slice(i, i + EMBED_BATCH_SIZE));
      }

      for (let i = 0; i < batches.length; i += PARALLEL_EMBED) {
        const group = batches.slice(i, i + PARALLEL_EMBED);
        const results = await Promise.all(
          group.map(batch => generateEmbeddingsBatch(batch.map(c => c.content), OPENAI_API_KEY, {
            supabaseAdmin, userId: user_id, standardId: standard_id,
          }))
        );

        // Write embeddings back to DB — parallel updates within each batch
        let wroteAny = false;
        await Promise.all(
          group.flatMap((batch, gi) =>
            batch.map((chunk, idx) => {
              const emb = results[gi][idx];
              if (!emb) {
                // Cap retries — a chunk whose content the API always rejects
                // would otherwise be re-fetched and re-attempted forever by
                // every future retrigger (self-retrigger, new upload, or the
                // resume-stalled-indexing sweep).
                return supabaseAdmin
                  .from("standard_chunks")
                  .update({ index_attempts: (chunk.index_attempts || 0) + 1 })
                  .eq("id", chunk.id);
              }
              wroteAny = true;
              // Persist the (possibly context-prepended) content and mark it
              // attempted in the same write that stores the embedding — so a
              // retrigger never re-spends Haiku on an already-embedded chunk.
              const update: Record<string, unknown> = { embedding: JSON.stringify(emb), is_indexed: true };
              if (ANTHROPIC_API_KEY) { update.content = chunk.content; update.context_generated = true; }
              return supabaseAdmin
                .from("standard_chunks")
                .update(update)
                .eq("id", chunk.id);
            })
          )
        );

        // If the whole group produced zero embeddings (OpenAI down or key
        // exhausted), the next fetch returns the SAME rows — the old loop
        // hammered the API for the full time budget, then retriggered itself
        // indefinitely. Break instead; the frontend recovery kick or the next
        // upload retriggers once the API recovers.
        if (!wroteAny) {
          console.error(`[embed-chunks][${standard_id}] Entire group failed to embed — stopping to avoid a retry hot-loop`);
          embedFailure = true;
          break;
        }

        processedCount += group.reduce((sum, b) => sum + b.length, 0);
        console.log(`[embed-chunks][${standard_id}] Processed ${processedCount} chunks — ${Date.now() - t0}ms elapsed`);
      }
      if (embedFailure) break;
    }

    // Check remaining un-embedded chunks — excluding figure placeholders so the
    // standard can complete while figures are still being described in the background.
    const { count: remaining } = await supabaseAdmin
      .from("standard_chunks")
      .select("id", { count: "exact", head: true })
      .eq("standard_id", standard_id)
      .is("embedding", null)
      .lt("index_attempts", 3)
      .not("content", "ilike", "%visual description will be generated shortly%")
      .not("content", "ilike", "%transcription of this table will be generated shortly%")
      .not("content", "ilike", `%${PAGE_GAP_SENTINEL}%`)
      .or(`chunk_index.lt.${indexLimit},clause_number.like.TABLE%,clause_number.like.FIGURE%`);

    const allDone = (remaining ?? 1) === 0;

    if (allDone) {
      const { count: indexedCount } = await supabaseAdmin
        .from("standard_chunks")
        .select("id", { count: "exact", head: true })
        .eq("standard_id", standard_id)
        .eq("is_indexed", true);

      // Chunks that hit the retry cap without ever embedding are permanently
      // missing from search — surface the count so the UI can tell the user,
      // instead of silently serving an incomplete document.
      const { count: failedCount } = await supabaseAdmin
        .from("standard_chunks")
        .select("id", { count: "exact", head: true })
        .eq("standard_id", standard_id)
        .is("embedding", null)
        .gte("index_attempts", 3);

      await supabaseAdmin
        .from("standards")
        .update({ extraction_status: "complete", indexed_chunks: indexedCount || 0, failed_chunks_count: failedCount || 0 })
        .eq("id", standard_id);

      await supabaseAdmin
        .from("processing_jobs")
        .update({ status: "complete", completed_at: new Date().toISOString() })
        .eq("standard_id", standard_id);

      console.log(`[embed-chunks][${standard_id}] Complete — ${indexedCount} chunks indexed`);
    } else if (timedOut) {
      // Re-trigger self to continue from where we left off
      const selfUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/embed-chunks`;
      const retrigger = fetch(selfUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ standard_id, user_id }),
      }).catch(e => console.error("Failed to re-trigger embed-chunks:", e));
      // Without waitUntil the runtime can kill this instance before the
      // retrigger request leaves — the documented mid-embedding stall.
      (globalThis as any).EdgeRuntime?.waitUntil?.(retrigger);

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
