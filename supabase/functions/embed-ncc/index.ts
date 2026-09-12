import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logTokenUsage } from "../_shared/log-usage.ts";

// Embeds rows in a shared index (public.ncc_chunks by default, or
// public.clause_guides with {"table":"clause_guides"}) that have no embedding
// yet. The ingest/seed scripts upsert text-only rows; this fills in the
// vectors server-side so the OpenAI key never leaves the function secrets.
// Ops-only: the caller must present the service-role key. Idempotent and
// resumable — call it until `remaining` is 0. Each call stops before the
// runtime limit and reports progress.
//
//   curl -X POST "$SUPABASE_URL/functions/v1/embed-ncc" \
//     -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "Content-Type: application/json" -d '{}'
//   … -d '{"table":"clause_guides"}'

// table -> column holding the text to embed
const TABLES: Record<string, string> = { ncc_chunks: "content", clause_guides: "search_text" };

const BATCH = 50;
const PARALLEL = 2; // 4 tripped WORKER_RESOURCE_LIMIT on the first full run
const TIME_BUDGET_MS = 40_000; // 100s tripped WORKER_RESOURCE_LIMIT on full runs; shorter calls, more of them
const MODEL = "text-embedding-3-small";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function embedBatch(texts: string[], apiKey: string): Promise<{ vectors: (number[] | null)[]; tokens: number }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: MODEL, input: texts.map((t) => t.slice(0, 24000)) }),
      });
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
        continue;
      }
      if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = await res.json();
      const vectors: (number[] | null)[] = texts.map(() => null);
      for (const item of data.data) vectors[item.index] = item.embedding;
      return { vectors, tokens: data.usage?.prompt_tokens ?? 0 };
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
    }
  }
  return { vectors: texts.map(() => null), tokens: 0 };
}

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // The caller must hold a service-role key. A string compare against the
  // function's own SUPABASE_SERVICE_ROLE_KEY isn't enough — a project can have
  // more than one valid secret key — so prove it: an admin-only GoTrue call
  // with the presented key succeeds only for service_role.
  const presented = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!presented) return json({ error: "Unauthorized" }, 401);
  const probe = createClient(Deno.env.get("SUPABASE_URL")!, presented, { auth: { persistSession: false } });
  const { error: probeErr } = await probe.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (probeErr) return json({ error: "Unauthorized" }, 401);
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  if (!OPENAI_API_KEY) return json({ error: "OPENAI_API_KEY not set" }, 500);

  const body = await req.json().catch(() => ({}));
  const table = typeof body?.table === "string" ? body.table : "ncc_chunks";
  const textCol = TABLES[table];
  if (!textCol) return json({ error: `unknown table: ${table}` }, 400);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceRoleKey);
  const t0 = Date.now();
  let embedded = 0;
  let failed = 0;
  let tokens = 0;

  try {
    while (Date.now() - t0 < TIME_BUDGET_MS) {
      const { data: rawRows, error } = await supabase
        .from(table)
        .select(`id, ${textCol}`)
        .is("embedding", null)
        .order("created_at", { ascending: true })
        .limit(BATCH * PARALLEL);
      if (error) throw error;
      const rows = ((rawRows || []) as any[]).map((r) => ({ id: r.id as string, content: String(r[textCol] ?? "") }));
      if (!rows.length) break;

      const groups: Array<typeof rows> = [];
      for (let i = 0; i < rows.length; i += BATCH) groups.push(rows.slice(i, i + BATCH));

      const results = await Promise.all(groups.map((g) => embedBatch(g.map((r) => r.content), OPENAI_API_KEY)));
      for (let gi = 0; gi < groups.length; gi++) {
        tokens += results[gi].tokens;
        const updates = groups[gi].map((r, i) => ({ id: r.id, embedding: results[gi].vectors[i] }));
        await Promise.all(updates.map(async (u) => {
          if (!u.embedding) { failed++; return; }
          const { error: upErr } = await supabase.from(table).update({ embedding: u.embedding }).eq("id", u.id);
          if (upErr) { failed++; console.error("[embed-ncc] update failed", u.id, upErr.message); }
          else embedded++;
        }));
      }
      // A batch that produced only failures would loop forever on the same rows.
      if (results.every((r) => r.vectors.every((v) => !v))) break;
    }

    if (tokens > 0) {
      await logTokenUsage(supabase, {
        userId: null, kind: `${table}_embed`, model: MODEL,
        usage: { input_tokens: tokens, output_tokens: 0 },
      });
    }

    const { count } = await supabase.from(table).select("id", { count: "exact", head: true }).is("embedding", null);
    return json({ table, embedded, failed, tokens, remaining: count ?? null, elapsed_ms: Date.now() - t0 });
  } catch (e) {
    console.error("[embed-ncc]", e);
    return json({ error: String((e as Error)?.message || e), embedded, failed, tokens }, 500);
  }
});
