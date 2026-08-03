import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildStaticSystemPrompt, buildContextSystemBlock, promptVersionSource, type TradeType } from "./system-prompt.ts";
import { detectTrade, standardTradeFromCode } from "./trade-detection.ts";
import { validateResponse } from "./validation.ts";
import { getAllowedOrigin } from "../_shared/cors.ts";
import { expandQuery, TRADIE_SYNONYMS } from "./synonyms.ts";

// Hash of the prompt + synonym logic, computed once per cold start. Cached
// answers are tagged with this on write and only reused on read if it still
// matches — so a deploy that changes system-prompt.ts or synonyms.ts (e.g.
// fixing a wrong answer) invalidates every previously cached answer instead
// of leaving pre-fix answers in circulation for up to 30 days.
const PROMPT_VERSION = await (async () => {
  const source = promptVersionSource() + JSON.stringify(TRADIE_SYNONYMS);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
})();

// The model is instructed to end its answer with a literal "---METADATA---"
// line, but occasionally drifts (drops a dash, adds a line break) — an exact
// string match then fails and the whole raw tail (metadata JSON included)
// used to leak into the visible answer. Matching a tolerant marker pattern
// instead absorbs that drift. A generous safe margin (well over the longest
// realistic marker length) holds back enough of the stream so the marker
// can't be split across two forwarded chunks.
const MARKER_RE = /-{0,3}\s*METADATA\s*-{0,3}/i;
const MARKER_SAFE_MARGIN = 24;

// Haiku reranking. RRF orders candidates by cross-channel agreement, but a
// chunk can rank high on keyword overlap while being tangential to the actual
// question. One cheap Haiku pass reads the top candidates and floats the ones
// most likely to CONTAIN THE ANSWER, not just share vocabulary. Timeout-
// guarded and fully degrading: any failure keeps the original RRF order, so
// this can only ever help.
async function rerankChunks(question: string, candidates: any[], apiKey: string): Promise<any[]> {
  if (candidates.length <= 8) return candidates;
  const pool = candidates.slice(0, 20);
  const listing = pool.map((c, i) =>
    `[${i}] ${c.clause_number ? `Clause ${c.clause_number}: ` : ""}${(c.content || "").replace(/\s+/g, " ").slice(0, 280)}`
  ).join("\n");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json", "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 60,
        messages: [{
          role: "user",
          content: `Question: ${question}\n\nExtracts:\n${listing}\n\nList the extract numbers most likely to contain the answer, best first, max 12. Comma-separated numbers only, nothing else.`,
        }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return candidates;
    const data = await res.json();
    const raw = data.content?.[0]?.text || "";
    const order = [...raw.matchAll(/\d+/g)].map((m: any) => parseInt(m[0], 10)).filter((n: number) => n >= 0 && n < pool.length);
    if (order.length === 0) return candidates;
    // Reranked picks float first; everything else keeps its RRF order. Dedupe
    // by id keeps the first (reranked) occurrence — nothing is lost, so recall
    // is preserved even if the reranker names only a handful.
    const ranked = order.map((idx: number) => pool[idx]);
    const seen = new Set<string>();
    return [...ranked, ...candidates].filter((c: any) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
  } catch {
    return candidates;
  } finally {
    clearTimeout(timeout);
  }
}

// Deterministic table-row extraction. When the question contains a specific
// value ("2.5 mm²", "20 A") and a retrieved table has been transcribed to
// markdown, pull the exact matching row(s) out and surface them up top. The AI
// reads tables well but occasionally grabs an adjacent row; handing it the
// pre-extracted row removes that failure mode for the numbers tradies depend on.
function extractTableRows(question: string, chunks: any[]): string {
  const nums = [...new Set(question.match(/\b\d+(?:\.\d+)?\b/g) || [])];
  if (nums.length === 0) return "";
  const blocks: string[] = [];
  for (const c of chunks) {
    if (!/^TABLE/i.test((c.clause_number || "").toString())) continue;
    const rows = (c.content || "").split("\n").filter((l: string) => (l.match(/\|/g) || []).length >= 2);
    if (rows.length < 2) continue;
    const header = rows[0];
    const matched = rows.filter((r: string, i: number) =>
      i > 0 && nums.some((n) => new RegExp(`(^|[^\\d.])${n.replace(".", "\\.")}([^\\d]|$)`).test(r))
    );
    if (matched.length > 0 && matched.length <= 8) {
      blocks.push(`${c.clause_number}${c.clause_title ? ` — ${c.clause_title}` : ""}:\n${header}\n${matched.join("\n")}`);
    }
  }
  return blocks.length > 0
    ? `\n\n[EXACT TABLE ROWS matching values in the question — quote these precise figures if relevant]\n${blocks.join("\n\n")}`
    : "";
}

serve(async (req) => {
  const origin = req.headers.get("Origin") || "";
  const corsHeaders = {
    "Access-Control-Allow-Origin": getAllowedOrigin(origin),
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
    const userId = user.id;

    // Team members share one standards library — resolve the caller's active
    // org once and reuse this filter everywhere the standards-library tables
    // (standard_chunks/standards/standard_figures/standard_tables) are
    // queried directly, so org-shared content is included alongside their
    // own uploads. Chat/question history itself stays personal — this only
    // widens which STANDARDS are visible, matching the RLS extension already
    // applied to those tables.
    const { data: membershipRow } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    const orgId = membershipRow?.organization_id ?? null;
    const ownershipFilter = orgId ? `user_id.eq.${userId},organization_id.eq.${orgId}` : `user_id.eq.${userId}`;

    const { question, conversation_history, image_base64 } = await req.json();
    const hasImage = typeof image_base64 === "string" && image_base64.length > 0;
    if ((!question || typeof question !== "string" || question.trim().length === 0) && !hasImage) {
      return new Response(JSON.stringify({ error: "Question is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    if (question && question.length > 2000) {
      return new Response(JSON.stringify({ error: "Question must be 2,000 characters or less" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (hasImage && image_base64.length > 7_000_000) {
      return new Response(JSON.stringify({ error: "Image too large — please use a smaller photo." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const effectiveQuestion = (question?.trim()) || "Please analyse this image and give guidance based on the relevant Australian standards.";

    // Use effectiveQuestion throughout for retrieval
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: "Service unavailable" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "Service unavailable" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Phase 1: profile lookup, then an atomic rate-limit gate.
    const { data: profile } = await supabase.from("profiles").select("*").eq("user_id", userId).single();
    const tier = profile?.subscription_tier || "free"; // least privilege — a missing profile must never grant pro

    // Free: 5/day. Pro/business: 200/day fair-use ceiling (stops a runaway
    // client loop or abused account burning unbounded AI spend).
    const maxQueries = tier === "free" ? 3 : 200;

    // Atomic count-and-record under an advisory lock — concurrent requests
    // cannot race past the cap. Returns the usage count including this request,
    // or -1 if over the limit. 24h rolling window.
    const { data: usedRaw, error: rlError } = await supabase.rpc("check_and_record_ai_usage", {
      p_user_id: userId,
      p_kind: "query",
      p_max: maxQueries,
      p_window_seconds: 86400,
    });
    if (rlError) {
      console.error("[query] rate-limit RPC failed:", rlError);
      return new Response(JSON.stringify({ error: "Service temporarily unavailable" }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const used = typeof usedRaw === "number" ? usedRaw : 0;
    if (used < 0) {
      const msg = tier === "free"
        ? "You've reached your daily limit of 3 queries. Upgrade to Pro for unlimited queries."
        : "StandAId is currently experiencing problems, try again later.";
      return new Response(JSON.stringify({ error: msg }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Usage count including this request (drives queries_remaining below)
    const todayCount = used;

    // History is raw client input — whitelist roles, force string content and
    // cap per-message size so fabricated roles or megabyte messages can't
    // reach the model (prompt-injection surface + cost abuse).
    const history: Array<{ role: "user" | "assistant"; content: string }> =
      (Array.isArray(conversation_history) ? conversation_history : [])
        .filter((m: any) => (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string" && m.content.trim())
        .slice(-6)
        .map((m: any) => ({ role: m.role, content: m.content.slice(0, 4000) }));
    // Anthropic requires the first message to be from the user
    while (history.length > 0 && history[0].role === "assistant") history.shift();

    // Condense follow-ups into a standalone retrieval question. The old
    // approach concatenated the last two USER messages — it dragged retrieval
    // toward stale topics after a subject change, and missed referents that
    // lived in assistant replies ("what about in a bathroom?").
    let retrievalQuestion = effectiveQuestion;
    if (history.length > 0) {
      try {
        const condenseController = new AbortController();
        const condenseTimeout = setTimeout(() => condenseController.abort(), 8000);
        try {
          const condenseRes = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "x-api-key": ANTHROPIC_API_KEY, "Content-Type": "application/json", "anthropic-version": "2023-06-01" },
            body: JSON.stringify({
              model: "claude-haiku-4-5-20251001",
              max_tokens: 150,
              messages: [{
                role: "user",
                content:
                  `Conversation so far:\n${history.map((m) => `${m.role}: ${m.content.slice(0, 500)}`).join("\n")}\n\n` +
                  `Latest question: ${effectiveQuestion}\n\n` +
                  `Rewrite the latest question as ONE standalone search query for Australian Standards documents, resolving any pronouns or references using the conversation. If it is already standalone, return it unchanged. Output only the query, nothing else.`,
              }],
            }),
            signal: condenseController.signal,
          });
          if (condenseRes.ok) {
            const condenseData = await condenseRes.json();
            const t = (condenseData.content?.[0]?.text || "").trim();
            if (t && t.length > 2 && t.length < 500) retrievalQuestion = t;
          }
        } finally {
          clearTimeout(condenseTimeout);
        }
      } catch (e) {
        console.error("[query] condense failed, using raw question:", e);
      }
    }

    // Vision pre-pass: when a photo is uploaded, get a fast description of what it
    // actually shows (in standards terminology) and use that to drive retrieval.
    // Without this, a generic question like "is this compliant?" retrieves chunks
    // unrelated to the photo — e.g. a switchboard photo pulling wet-area clauses.
    let imageDescription = "";
    if (hasImage) {
      try {
        const visionController = new AbortController();
        const visionTimeout = setTimeout(() => visionController.abort(), 20000);
        try {
          const visionRes = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "x-api-key": ANTHROPIC_API_KEY, "Content-Type": "application/json", "anthropic-version": "2023-06-01" },
            body: JSON.stringify({
              model: "claude-haiku-4-5-20251001",
              max_tokens: 300,
              messages: [{
                role: "user",
                content: [
                  { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image_base64 } },
                  { type: "text", text: "This photo is from an Australian trade job site. In one sentence, state what installation it shows using Australian Standards (AS/NZS) terminology (e.g. switchboard, socket-outlet near a sink, hot water system). Then list 8-12 search keywords for the compliance topics that apply to it (e.g. RCD protection, main switch, MEN link, circuit protection, conductor identification). Plain text only, no markdown." },
                ],
              }],
            }),
            signal: visionController.signal,
          });
          if (visionRes.ok) {
            const visionData = await visionRes.json();
            imageDescription = (visionData.content?.[0]?.text || "").trim();
          } else {
            console.error(`[query] vision pre-pass HTTP ${visionRes.status}`);
          }
        } finally {
          clearTimeout(visionTimeout);
        }
      } catch (e) {
        console.error("[query] vision pre-pass failed:", e);
      }
    }

    // Fallback boost only if the vision pre-pass failed AND the question is generic —
    // deliberately topic-neutral so it can't steer retrieval to the wrong section.
    const imageBoost = hasImage && !imageDescription && (!question || question.trim().length < 40)
      ? "installation compliance requirements wiring rules clearance"
      : "";
    const retrievalQuery = [retrievalQuestion, imageDescription, imageBoost]
      .filter(Boolean)
      .join(" ");

    // Trade guess from the question text alone (no standard bias yet — that
    // would be circular, since we haven't retrieved anything). Used below to
    // drop confidently wrong-trade chunks (e.g. a plumbing stormwater clause
    // surfacing for an electrical question) before they can reach the AI or
    // be cited. "general" means no confident signal, so nothing is filtered.
    const queryTrade = detectTrade(retrievalQuery);

    // Expand tradie terms to standards terminology
    const { keywords, expandedText, matchedPhrases } = expandQuery(retrievalQuery);
    const hasExpansion = expandedText !== effectiveQuestion;

    // Detect explicit clause numbers
    const clauseNumberMatches = effectiveQuestion.match(/\b[A-Za-z]?\d+(?:\.\d+){1,4}\b/g) || [];

    // Ranked full-text search replaces the old `ilike '%word%'` scan over the
    // first five words of the question (which happily searched on "what" and
    // "does"). Keywords are OR-joined for recall; websearch_to_tsquery drops
    // stopwords automatically and ts_rank orders by real relevance.
    const sanitizeKw = (kw: string) => kw.replace(/[(),.*:"%\\!&|<>]/g, " ").trim();
    const ftsQuery = [...new Set(
      keywords.slice(0, 10).map(sanitizeKw).filter((kw: string) => kw.length > 2)
    )].join(" or ");

    // Phase 2: all expensive operations in parallel
    const [embResponse, expandedEmbResponse, keywordChunksResult, clauseResult, ownedStandardsResult] = await Promise.all([
      fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "text-embedding-3-small", input: retrievalQuery }),
      }),
      hasExpansion
        ? fetch("https://api.openai.com/v1/embeddings", {
            method: "POST",
            headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model: "text-embedding-3-small", input: expandedText }),
          })
        : Promise.resolve(null),
      ftsQuery
        ? supabase.rpc("match_chunks_fts", {
            match_user_id: userId,
            query_text: ftsQuery,
            match_count: 15,
          })
        : Promise.resolve({ data: [] }),
      clauseNumberMatches.length > 0
        ? supabase
            .from("standard_chunks")
            .select("id, standard_id, content, clause_number, clause_title, page_number, chunk_index, chunk_type, is_normative")
            .or(ownershipFilter)
            .in("clause_number", clauseNumberMatches)
            .limit(20)
        : Promise.resolve({ data: [] }),
      supabase.from("standards").select("id, standard_code, title").or(ownershipFilter),
    ]);

    // Map every standard the user/org can see to its trade (by code/title
    // prefix — see STANDARD_TO_TRADE). Unrecognised standards map to null
    // ("unknown"), not "general" — they must never be excluded below, since
    // we can't actually tell what trade they belong to.
    const standardTradeMap = new Map<string, TradeType | null>(
      (ownedStandardsResult.data || []).map((s: any) => [
        s.id,
        standardTradeFromCode(s.standard_code) ?? standardTradeFromCode(s.title),
      ])
    );
    // Drops chunks from a standard we're confident belongs to a different
    // trade than the question. Never filters on an unconfident query guess
    // ("general") or an unrecognised standard (null), and never empties a
    // channel entirely on a shaky guess — better to risk one wrong-trade
    // result slipping through than to silently return nothing.
    const filterCrossTrade = (chunks: any[]) => {
      if (queryTrade === "general" || chunks.length === 0) return chunks;
      const filtered = chunks.filter((c: any) => {
        const t = standardTradeMap.get(c.standard_id);
        return !t || t === queryTrade;
      });
      return filtered.length > 0 ? filtered : chunks;
    };

    // Vector search 1 — original query; also search for past feedback corrections in parallel
    let vectorChunks1: any[] = [];
    let feedbackCorrections: Array<{ question_text: string; user_comment: string }> = [];
    // Hoisted so the cache-write step near the end of a cache MISS can reuse
    // the same embedding — no second OpenAI call needed either way.
    let cachedQueryEmbedding: number[] | null = null;
    if (embResponse.ok) {
      const embData = await embResponse.json();
      const queryEmbedding = embData.data[0].embedding;
      cachedQueryEmbedding = queryEmbedding;

      // Shared team question cache — a close-enough repeat question within
      // the org reuses a previous answer instead of paying for Claude again.
      // Deliberately conservative (high threshold, bounded age — see the
      // migration) since answers here are safety-critical: a wrong "close
      // enough" reuse is a real correctness risk, not just a cost detail.
      // Chat history stays private per person regardless — a hit still
      // writes a normal queries/citations row under THIS user's own id.
      if (orgId) {
        const { data: cacheRows } = await supabase.rpc("match_cached_question", {
          query_embedding: queryEmbedding,
          match_organization_id: orgId,
          match_prompt_version: PROMPT_VERSION,
        });
        const cacheHit = cacheRows?.[0];
        if (cacheHit) {
          const cached = cacheHit.response as Record<string, any>;
          const cachedCitationsForLog = (cached.citations || []).map((c: any) => ({ ...c }));
          let outCitations = cachedCitationsForLog;
          let gated = false;
          let gatedMessage: string | undefined;
          if (tier === "free" && outCitations.length > 0) {
            outCitations = outCitations.map((c: any) => ({
              ...c,
              clause_number: "[Upgrade to Pro to unlock this clause]",
              relevant_text: "This clause is available with a Pro subscription.",
              gated: true,
            }));
            gated = true;
            gatedMessage = "You're on the right track — upgrade to Pro to get the full clause and complete guidance.";
          }

          const cacheQueryId = crypto.randomUUID();
          const donePayload = {
            done: true,
            ...cached,
            citations: outCitations,
            gated,
            ...(gated ? { gated_message: gatedMessage } : {}),
            cached: true,
            queries_remaining: tier === "free" ? Math.max(0, maxQueries - todayCount) : null,
            queryId: cacheQueryId,
            confidence_score: cacheHit.similarity,
          };

          // Non-blocking — mirrors the miss-path logging below.
          (async () => {
            await supabase.rpc("bump_question_cache_hit", { p_id: cacheHit.id });
            const { data: queryRecord } = await supabase.from("queries").insert({
              user_id: userId,
              question: effectiveQuestion,
              response: cached.answer,
              citations: cachedCitationsForLog,
              confidence_score: cacheHit.similarity,
              safety_flagged: cached.safety_critical || false,
              subscription_tier_at_time: tier,
            }).select().single();
            if (queryRecord && cachedCitationsForLog.length > 0) {
              await supabase.from("citations").insert(cachedCitationsForLog.map((c: any) => ({
                query_id: queryRecord.id,
                standard_id: c.standard_id || null,
                clause_number: c.clause_number,
                standard_code: c.standard_code,
                version: c.standard_version,
                page_number: c.page_number,
                confidence_score: cacheHit.similarity,
                chunk_content: c.relevant_text,
              })));
            }
            try {
              const { data: profileRow } = await supabase.from("profiles")
                .select("daily_query_count").eq("user_id", userId).single();
              await supabase.from("profiles")
                .update({ daily_query_count: (profileRow?.daily_query_count ?? 0) + 1 })
                .eq("user_id", userId);
            } catch (countErr) {
              console.error("[query] cache-hit daily_query_count update failed:", countErr);
            }
          })();

          return new Response(
            `data: ${JSON.stringify(donePayload)}\n\n`,
            { headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } }
          );
        }
      }

      const [chunksResult, correctionsResult] = await Promise.all([
        supabase.rpc("match_chunks", {
          query_embedding: queryEmbedding,
          match_user_id: userId,
          match_threshold: 0.30,
          match_count: 20,
        }),
        supabase.rpc("match_feedback_corrections", {
          query_embedding: queryEmbedding,
          match_user_id: userId,
          match_threshold: 0.82,
          match_count: 3,
        }),
      ]);
      if (!chunksResult.error && chunksResult.data?.length) vectorChunks1 = chunksResult.data;
      if (!correctionsResult.error && correctionsResult.data?.length) feedbackCorrections = correctionsResult.data;
    }

    // Vector search 2 — expanded query
    let vectorChunks2: any[] = [];
    if (hasExpansion && expandedEmbResponse?.ok) {
      const embData2 = await expandedEmbResponse.json();
      const expandedEmbedding = embData2.data[0].embedding;
      const { data, error: matchError2 } = await supabase.rpc("match_chunks", {
        query_embedding: expandedEmbedding,
        match_user_id: userId,
        match_threshold: 0.30,
        match_count: 20,
      });
      if (!matchError2 && data?.length) vectorChunks2 = data;
    }

    // Merge vector results (deduplicated)
    const seenVectorIds = new Set<string>();
    const vectorChunks: any[] = [];
    for (const c of [...vectorChunks1, ...vectorChunks2]) {
      if (!seenVectorIds.has(c.id)) {
        seenVectorIds.add(c.id);
        vectorChunks.push(c);
      }
    }

    const keywordChunks: any[] = keywordChunksResult.data || [];
    const clauseChunks: any[] = (clauseResult.data || []).map((c: any) => ({ ...c, similarity: 1.0 }));

    // Drop confidently wrong-trade chunks from every channel before they can
    // be fused, ranked, cited, or opened via a source link — this is the
    // fix for cross-trade contamination (e.g. a plumbing stormwater clause
    // surfacing and being cited for an electrical question).
    vectorChunks1 = filterCrossTrade(vectorChunks1);
    vectorChunks2 = filterCrossTrade(vectorChunks2);
    const keywordChunksFiltered = filterCrossTrade(keywordChunks);
    const clauseChunksFiltered = filterCrossTrade(clauseChunks);

    // Reciprocal-rank fusion across channels. The old merge appended every
    // expanded-query vector hit after ALL original-query hits and tacked
    // keyword rows (in arbitrary order) on the end — a 0.62-similarity
    // expanded hit could be cut by slice(15) in favour of a 0.31 original
    // hit. RRF scores each chunk by its rank in every channel it appears in,
    // so agreement between channels floats to the top. Exact clause-number
    // hits stay pinned first: asking about a clause by number is explicit
    // intent, not fuzzy matching.
    const rrf = new Map<string, { chunk: any; score: number }>();
    const addRanked = (list: any[], weight: number) => {
      list.forEach((c: any, i: number) => {
        const prev = rrf.get(c.id);
        const chunk = prev
          ? { ...prev.chunk, similarity: Math.max(prev.chunk.similarity || 0, c.similarity || 0) }
          : c;
        rrf.set(c.id, { chunk, score: (prev?.score || 0) + weight / (60 + i) });
      });
    };
    addRanked(vectorChunks1, 1.0);
    addRanked(vectorChunks2, 1.0);
    addRanked(keywordChunksFiltered, 0.8);
    const clauseIds = new Set(clauseChunksFiltered.map((c: any) => c.id));
    const fused = [...rrf.values()]
      .sort((a, b) => b.score - a.score)
      .map((e) => e.chunk)
      .filter((c: any) => !clauseIds.has(c.id));
    // Rerank the fused pool before the cut. Exact clause-number hits stay
    // pinned first (explicit intent, not fuzzy matching); everything else is
    // reordered by a Haiku pass that judges which chunks actually answer the
    // question. Falls back to RRF order on any failure.
    const fusedRanked = await rerankChunks(retrievalQuestion, fused, ANTHROPIC_API_KEY);
    const matchedChunks = [...clauseChunksFiltered, ...fusedRanked].slice(0, 15);

    // Genuine relevance signal: the best REAL cosine similarity from vector
    // search. Clause hits get a fabricated 1.0 and keyword hits a fabricated
    // 0.5 for ranking, so matchedChunks[0].similarity is meaningless as a
    // confidence measure — it made every clause-number match report full
    // confidence and let stopword ilike hits defeat the refusal path.
    const maxVectorSim = vectorChunks.reduce((m: number, c: any) => Math.max(m, c.similarity || 0), 0);
    const hasExactClauseHit = clauseChunks.length > 0;
    const topSimilarity = maxVectorSim;

    // One-hop expansion: pull the actual TABLE/FIGURE chunks for any table or
    // figure referenced by the question or the retrieved clauses. Clauses
    // constantly point at tables ("...in accordance with Table 8.1") — without
    // the table chunk in context the AI can't quote the values and the
    // validator flags the reference as ungrounded.
    const refScan = `${effectiveQuestion}\n${matchedChunks.map((c: any) => c.content).join("\n")}`;
    const refKeys = new Set<string>();
    for (const m of refScan.matchAll(/\b(TABLE|FIGURE)S?\s+([A-Z]?\d+(?:\.\d+)*)\b/gi)) {
      refKeys.add(`${m[1].toUpperCase()} ${m[2].toUpperCase()}`);
    }
    // Clause cross-references ("in accordance with Clause 3.9.4") and parent
    // clauses of the top hits (2.3.4.1 → 2.3.4) — standards are cross-
    // reference-dense, and a sub-clause's conditions often live in its
    // parent. Without following these the AI answers from fragments.
    const clauseRefs = new Set<string>();
    for (const m of refScan.matchAll(/\bCLAUSES?\s+(\d+(?:\.\d+){1,4})\b/gi)) {
      clauseRefs.add(m[1]);
    }
    for (const c of matchedChunks.slice(0, 3)) {
      const cn = (c.clause_number || "").toString().trim();
      if (/^\d+(?:\.\d+){1,4}$/.test(cn) && cn.includes(".")) {
        clauseRefs.add(cn.slice(0, cn.lastIndexOf(".")));
      }
    }
    const haveClauseNums = new Set(matchedChunks.map((c: any) => (c.clause_number || "").toString().trim()));
    const wantClauses = [...clauseRefs].filter((n) => !haveClauseNums.has(n)).slice(0, 8);

    const [refChunksRes, refClauseRes] = await Promise.all([
      refKeys.size > 0
        ? supabase
            .from("standard_chunks")
            .select("id, standard_id, content, clause_number, clause_title, page_number, chunk_index, chunk_type, is_normative")
            .or(ownershipFilter)
            .in("clause_number", [...refKeys].slice(0, 12))
            .limit(8)
        : Promise.resolve({ data: [] }),
      wantClauses.length > 0
        ? supabase
            .from("standard_chunks")
            .select("id, standard_id, content, clause_number, clause_title, page_number, chunk_index, chunk_type, is_normative")
            .or(ownershipFilter)
            .in("clause_number", wantClauses)
            .limit(8)
        : Promise.resolve({ data: [] }),
    ]);
    {
      const haveIds = new Set(matchedChunks.map((c: any) => c.id));
      for (const rc of refChunksRes.data || []) {
        if (!haveIds.has(rc.id) && matchedChunks.length < 20) {
          haveIds.add(rc.id);
          matchedChunks.push({ ...rc, similarity: 0.9 });
        }
      }
      for (const rc of refClauseRes.data || []) {
        if (!haveIds.has(rc.id) && matchedChunks.length < 20) {
          haveIds.add(rc.id);
          matchedChunks.push({ ...rc, similarity: 0.75 });
        }
      }
    }

    // Cross-standard reference following. Standards defer to each other
    // constantly ("...selected in accordance with AS/NZS 3008.1.1"). If the
    // user owns the referenced standard, pull a few relevant chunks from it so
    // the AI can actually follow the reference instead of replying "refer to
    // AS/NZS 3008". Scoped FTS on the fts column — no extra embedding spend.
    {
      const scanText = matchedChunks.map((c: any) => c.content).join("\n");
      const refCodes = new Set<string>();
      for (const m of scanText.matchAll(/\bAS(?:\/NZS)?\s?(\d{3,5}(?:\.\d+){0,3})\b/gi)) refCodes.add(m[1]);
      const presentStdIds = new Set(matchedChunks.map((c: any) => c.standard_id));
      const xFtsQuery = [...new Set(keywords.slice(0, 8).map(sanitizeKw).filter((k: string) => k.length > 2))].join(" OR ");
      if (refCodes.size > 0 && xFtsQuery) {
        const ownedStds = ownedStandardsResult.data;
        const targetIds = (ownedStds || [])
          .filter((s: any) => !presentStdIds.has(s.id))
          .filter((s: any) => {
            const norm = (s.standard_code || "").replace(/[^0-9.]/g, "");
            return norm && [...refCodes].some((rc) => norm === rc || norm.startsWith(rc + ".") || rc.startsWith(norm + "."));
          })
          .map((s: any) => s.id)
          .slice(0, 3);
        if (targetIds.length > 0) {
          const { data: xRows } = await supabase
            .from("standard_chunks")
            .select("id, standard_id, content, clause_number, clause_title, page_number, chunk_index, chunk_type, is_normative")
            .or(ownershipFilter)
            .in("standard_id", targetIds)
            .textSearch("fts", xFtsQuery, { type: "websearch" })
            .limit(6);
          const haveIds = new Set(matchedChunks.map((c: any) => c.id));
          for (const rc of xRows || []) {
            if (!haveIds.has(rc.id) && matchedChunks.length < 22) {
              haveIds.add(rc.id);
              matchedChunks.push({ ...rc, similarity: 0.7 });
            }
          }
        }
      }
    }

    // Get standard details
    const standardIds = [...new Set(matchedChunks.map((c: any) => c.standard_id))];
    const standards = standardIds.length > 0
      ? (await supabase.from("standards").select("id, standard_code, version, title").in("id", standardIds)).data
      : [];
    const standardMap = new Map(standards?.map((s: any) => [s.id, s]) || []);

    // Definitions injection. Terms like "socket-outlet", "MEN", "damp
    // situation" carry precise standards meanings; pulling their definition
    // into context stops the AI answering from a colloquial reading. Search the
    // matched standards' definitions clauses for the question's key terms.
    if (standardIds.length > 0) {
      const stop = new Set(["what","which","where","does","the","and","for","are","can","how","with","from","that","this","when","must","need","should","installation","standard","standards","requirement","requirements","allowed","required","between","there"]);
      const terms = [...new Set(effectiveQuestion.toLowerCase().match(/\b[a-z][a-z-]{3,}\b/g) || [])]
        .filter((w) => !stop.has(w)).slice(0, 6);
      if (terms.length > 0) {
        const orTerms = terms.map((t) => `content.ilike.%${t}%`).join(",");
        const { data: defRows } = await supabase
          .from("standard_chunks")
          .select("id, standard_id, content, clause_number, clause_title, page_number, chunk_index, chunk_type, is_normative")
          .or(ownershipFilter)
          .in("standard_id", standardIds)
          .or("clause_title.ilike.%definition%,clause_title.ilike.%terms and definitions%,clause_number.ilike.1.4%")
          .or(orTerms)
          .limit(4);
        const haveIds = new Set(matchedChunks.map((c: any) => c.id));
        for (const dr of defRows || []) {
          if (!haveIds.has(dr.id) && matchedChunks.length < 24) {
            haveIds.add(dr.id);
            matchedChunks.push({ ...dr, similarity: 0.68 });
          }
        }
      }
    }

    // Detect trade
    const standardCounts = new Map<string, number>();
    for (const chunk of matchedChunks) {
      const std = standardMap.get(chunk.standard_id);
      if (std?.standard_code) standardCounts.set(std.standard_code, (standardCounts.get(std.standard_code) || 0) + 1);
    }
    const topStandardName = standardCounts.size > 0
      ? [...standardCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
      : null;
    // Include the photo description so e.g. a switchboard photo detects "electrical"
    const trade: TradeType = detectTrade(
      imageDescription ? `${effectiveQuestion} ${imageDescription}` : effectiveQuestion,
      topStandardName,
    );

    // Pre-call figure lookup — when question explicitly names a figure, fetch its
    // caption from the DB so Claude knows what it shows before it answers.
    // Letter prefix covers appendix figures/tables ("Figure B2", "Table C1") —
    // the digits-only pattern made appendix content unreachable by name.
    const preFigNums = [...effectiveQuestion.matchAll(/\bfig(?:ure)?s?\s+([A-Z]?\d+(?:\.\d+)*)\b/gi)].map((m) => m[1].toUpperCase());
    let figCaptionContext = "";
    if (preFigNums.length > 0) {
      const { data: preFigData } = await supabase
        .from("standard_figures")
        .select("figure_number, caption, page_number")
        .or(ownershipFilter)
        .in("figure_number", preFigNums);
      if (preFigData?.length) {
        figCaptionContext = "\n\n[FIGURE REFERENCE]\n" + preFigData.map((f: any) =>
          `Figure ${f.figure_number}: ${f.caption || "Diagram from the standard"} (Page ${f.page_number})`
        ).join("\n");
      }
    }

    // Corrections from past user feedback — injected before Claude answers so it
    // can avoid repeating mistakes flagged on similar questions.
    const correctionsContext = feedbackCorrections.length > 0
      ? "\n\n[PAST FEEDBACK CORRECTIONS — Users flagged similar questions as wrong or unclear. Review these before answering:]\n" +
        feedbackCorrections.map((c, i) =>
          `Correction ${i + 1}: A user asked "${c.question_text}" and reported this issue: "${c.user_comment}"`
        ).join("\n")
      : "";

    // Normative/informative tag stamped at processing time. Chunks written
    // before tagging existed carry NULL — those get no annotation rather
    // than a guess the model would treat as authoritative.
    const chunkTag = (c: any): string => {
      if (c.chunk_type === "note") return " [NOTE]";
      if (c.chunk_type === "definition") return " [DEFINITION]";
      if (c.is_normative === true) return " [MANDATORY — normative]";
      if (c.is_normative === false) return " [GUIDANCE — informative]";
      return "";
    };

    // Build context string
    const tableRowContext = extractTableRows(effectiveQuestion, matchedChunks);
    const contextChunks = matchedChunks.length > 0
      ? matchedChunks.map((chunk: any, i: number) => {
          const std = standardMap.get(chunk.standard_id);
          return `[Source ${i + 1} — ${std?.standard_code || "Unknown"} ${std?.version || ""} Clause ${chunk.clause_number || "N/A"} (Page ${chunk.page_number || "N/A"})${chunkTag(chunk)}]
${chunk.content}`;
        }).join("\n\n") + tableRowContext + figCaptionContext + correctionsContext
      : null;

    // Refusal gate — refuse to fabricate rather than answer from weak context.
    // Fires when nothing was retrieved at all, OR when nothing genuinely
    // relevant was retrieved: no exact clause-number hit and the best real
    // vector similarity is below 0.40 (with text-embedding-3-small, unrelated
    // text scores 0.2–0.35; real matches sit 0.45+). Previously only the
    // zero-chunks case refused, and stopword keyword hits guaranteed chunks
    // always existed — so questions about standards the user never uploaded
    // sailed through to Claude with irrelevant context and got answered from
    // training memory.
    if (contextChunks === null || (!hasExactClauseHit && maxVectorSim < 0.40)) {
      const noChunksPayload = {
        done: true,
        answer: "I couldn't find relevant content in your uploaded standards for this query. Please check that the relevant standard has been uploaded and fully processed, or try rephrasing your question.",
        answer_found: false,
        citations: [],
        figures_referenced: [],
        tables_referenced: [],
        safety_critical: false,
        confidence: "low",
        low_confidence: true,
        queries_remaining: tier === "free" ? Math.max(0, maxQueries - todayCount) : null,
      };
      return new Response(
        `data: ${JSON.stringify(noChunksPayload)}\n\n`,
        { headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } }
      );
    }

    const staticSystemPrompt = buildStaticSystemPrompt(trade);
    const contextSystemBlock = buildContextSystemBlock(contextChunks, matchedPhrases);
    const queryId = crypto.randomUUID();
    // Calibrated for genuine text-embedding-3-small similarities (real matches
    // ~0.45–0.65; 0.80 was unreachable and flagged nearly every answer). An
    // exact clause-number hit is high confidence regardless of vector score.
    const isLowConfidence = !hasExactClauseHit && topSimilarity < 0.50;

    // Build user message content — include image if uploaded
    const complianceInstruction = hasImage ? `

[PHOTO COMPLIANCE CHECK]
Analyse the photo above against the retrieved standard extracts. Structure your response exactly as follows:

**What I can see:**
2-4 sentences describing the installation — type of equipment, location, visible wiring, mounting. Don't inventory every component.

**Compliance assessment:**
ONLY assess points the retrieved extracts actually cover. For each of those, state: ✅ Compliant, ⚠️ Concern, or ❌ Non-compliant — with the clause number and what the extract requires. If something is not visible enough to assess, say so.
If important aspects of the photo are NOT covered by the extracts, roll them into ONE short line naming where they live (e.g. "RCD protection and switchboard requirements aren't in these extracts — check the RCD and switchboard sections of AS/NZS 3000"). Do NOT walk through them point by point saying you can't cite each one.
If the extracts are completely unrelated to what the photo shows, say so in one sentence, give a brief plain-English description of what a compliant installation of this type involves (no clause numbers or specific values from memory), then move on.

**Need to know:**
The 3-5 most important measurements or details needed for a definitive verdict. Be precise — e.g. "What is the horizontal distance from the socket outlet face to the nearest tap?" or "Is this circuit RCD protected?"

If everything visible appears compliant, state that clearly with the clauses that confirm it.
Keep the whole response tight — a tradie reads this on site on a phone.

User's question/context: ${effectiveQuestion}` : "";

    const lastUserContent: any = hasImage
      ? [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image_base64 } },
          { type: "text", text: complianceInstruction || effectiveQuestion },
        ]
      : effectiveQuestion;

    // Call Claude with streaming (60-second timeout — image analysis takes longer)
    const aiController = new AbortController();
    const aiTimeout = setTimeout(() => aiController.abort(), 60000);
    let aiResponse: Response;
    try {
      aiResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": ANTHROPIC_API_KEY, "Content-Type": "application/json", "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          // Sonnet 4.6: with retrieval doing the heavy lifting and the strict
          // grounding prompt, answer quality holds while cost drops ~5x vs
          // Opus. Swap back to claude-opus-4-8 here if quality ever dips.
          model: "claude-sonnet-4-6",
          // Photo compliance answers are longer and structured — 2000 was getting
          // truncated mid-sentence, losing the metadata separator entirely
          max_tokens: hasImage ? 3500 : 2000,
          stream: true,
          // Instructions live in the system param (stronger adherence and
          // prompt-injection resistance than the old user-message prompt,
          // where client history competed at equal rank). The static block is
          // cached — ~4k tokens skipped on every repeat call per trade.
          system: [
            { type: "text", text: staticSystemPrompt, cache_control: { type: "ephemeral" } },
            { type: "text", text: contextSystemBlock },
          ],
          messages: [
            ...history,
            { role: "user", content: lastUserContent },
          ],
        }),
        signal: aiController.signal,
      });
    } finally {
      clearTimeout(aiTimeout);
    }

    if (!aiResponse.ok) {
      const errBody = await aiResponse.json().catch(() => null);
      const errMsg = errBody?.error?.message || errBody?.error || `AI error ${aiResponse.status}`;
      console.error(`[query] Claude error ${aiResponse.status}: ${JSON.stringify(errBody)}`);
      return new Response(JSON.stringify({ error: errMsg }), {
        status: aiResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sseHeaders = {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    };

    const encoder = new TextEncoder();
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();

    // Process Claude stream and forward as SSE
    (async () => {
      try {
        let accumulated = "";
        let lastSentIdx = 0;
        let pastSeparator = false;

        const reader = aiResponse.body!.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          for (const line of chunk.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data);
              // Claude format: { type: "content_block_delta", delta: { type: "text_delta", text: "..." } }
              const token = parsed.delta?.text || "";
              if (!token) continue;
              accumulated += token;

              if (!pastSeparator) {
                const markerMatch = accumulated.match(MARKER_RE);
                if (markerMatch && markerMatch.index !== undefined) {
                  // Marker found — send any buffered answer text before it
                  const unsent = accumulated.slice(lastSentIdx, markerMatch.index);
                  if (unsent.trim()) {
                    await writer.write(encoder.encode(`data: ${JSON.stringify({ token: unsent })}\n\n`));
                  }
                  pastSeparator = true;
                } else {
                  // Send up to (length - margin) to avoid splitting the marker across chunks
                  const safeEnd = Math.max(lastSentIdx, accumulated.length - MARKER_SAFE_MARGIN);
                  if (safeEnd > lastSentIdx) {
                    const toSend = accumulated.slice(lastSentIdx, safeEnd);
                    await writer.write(encoder.encode(`data: ${JSON.stringify({ token: toSend })}\n\n`));
                    lastSentIdx = safeEnd;
                  }
                }
              }
            } catch { /* ignore parse errors on incomplete lines */ }
          }
        }

        // Flush remaining answer buffer if separator never appeared
        if (!pastSeparator) {
          const remaining = accumulated.slice(lastSentIdx);
          if (remaining.trim()) {
            await writer.write(encoder.encode(`data: ${JSON.stringify({ token: remaining })}\n\n`));
          }
        }

        // Parse full accumulated response
        const markerMatch = accumulated.match(MARKER_RE);
        let answerText: string;
        let metadataRaw: string;

        if (markerMatch && markerMatch.index !== undefined) {
          answerText = accumulated.slice(0, markerMatch.index).trim();
          metadataRaw = accumulated.slice(markerMatch.index + markerMatch[0].length).trim();
        } else {
          // Marker genuinely missing — look for a trailing JSON object instead
          // of assuming any particular shape. Never fall back to dumping the
          // raw (possibly JSON-containing) text as the answer.
          const cleaned = accumulated.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          const lastBrace = cleaned.lastIndexOf("{");
          let parsedTail: any = null;
          if (lastBrace !== -1) {
            try { parsedTail = JSON.parse(cleaned.slice(lastBrace)); } catch { parsedTail = null; }
          }
          if (parsedTail && typeof parsedTail === "object") {
            if ("answer" in parsedTail) {
              // Old single-blob format: the whole response was one JSON object.
              answerText = parsedTail.answer || "";
              metadataRaw = JSON.stringify(parsedTail);
            } else {
              // Current metadata-only format, just missing its marker line.
              answerText = cleaned.slice(0, lastBrace).trim();
              metadataRaw = cleaned.slice(lastBrace);
            }
          } else {
            // No parseable metadata found at all — show the plain text rather
            // than risk leaking an unparsed JSON tail into the answer.
            answerText = accumulated;
            metadataRaw = "{}";
          }
        }

        let parsedMetadata: any = {};
        try {
          parsedMetadata = JSON.parse(metadataRaw);
        } catch {
          const j = metadataRaw.indexOf("{");
          if (j !== -1) { try { parsedMetadata = JSON.parse(metadataRaw.slice(j)); } catch {} }
        }

        // Defensive: the model occasionally leaks a fragment of its own
        // citations/tables JSON into the answer VALUE itself, even when the
        // overall JSON is well-formed enough to parse (confirmed in
        // production 2026-08-03 — an answer ending "...too much imped":
        // [{"standard_code":"AS/NZS 3000",...}]..." mid-sentence). These
        // key names never appear legitimately in prose, so treat the first
        // one as the point everything already-parsed (citations/
        // tables_referenced below) makes redundant, and cut there rather
        // than show broken JSON to the user.
        const LEAKED_JSON_MARKER = /"(?:standard_code|clause_number|table_number|figure_number|relevant_text)"\s*:/;
        function sanitizeAnswerText(text: string): string {
          const m = text.match(LEAKED_JSON_MARKER);
          if (!m || m.index === undefined) return text;
          return text.slice(0, m.index).replace(/[\s":,[{]+$/, "").trim();
        }

        const parsedResponse: any = {
          answer: sanitizeAnswerText(answerText),
          citations: parsedMetadata.citations || [],
          figures_referenced: parsedMetadata.figures_referenced || [],
          tables_referenced: parsedMetadata.tables_referenced || [],
          safety_critical: parsedMetadata.safety_critical || false,
          safety_message: parsedMetadata.safety_message,
          confidence: parsedMetadata.confidence || "medium",
          answer_found: parsedMetadata.answer_found !== false,
          clarification_question: parsedMetadata.clarification_question || null,
        };

        // Figure/table lookup — supports whole numbers ("Table 50"), appendix
        // letters ("Table C1"), and "fig" abbreviation/typos
        const questionFigNums = [...effectiveQuestion.matchAll(/\bfig(?:ure)?s?\s+([A-Z]?\d+(?:\.\d+)*)\b/gi)].map((m) => m[1].toUpperCase());
        const questionTblNums = [...effectiveQuestion.matchAll(/\btable[s]?\s+([A-Z]?\d+(?:\.\d+)*)\b/gi)].map((m) => m[1].toUpperCase());
        const aiFigures: any[] = parsedResponse.figures_referenced || [];
        const aiTables: any[] = parsedResponse.tables_referenced || [];

        const seenFigNums = new Set(aiFigures.map((f: any) => f.figure_number));
        for (const n of questionFigNums) {
          if (!seenFigNums.has(n)) { aiFigures.push({ figure_number: n }); seenFigNums.add(n); }
        }
        const seenTblNums = new Set(aiTables.map((t: any) => t.table_number));
        for (const n of questionTblNums) {
          if (!seenTblNums.has(n)) { aiTables.push({ table_number: n }); seenTblNums.add(n); }
        }

        // Always scan answer text for figure/table references — Claude is
        // instructed to mention figure numbers from extracts, so any answer
        // mentioning "Figure 4.17" should surface that figure regardless of
        // whether the question was explicitly a visual request.
        const answerText2 = parsedResponse.answer || "";
        const answerFigRefs = [...answerText2.matchAll(/\bfigure\s+([A-Z]?\d+(?:\.\d+)*)\b/gi)].map((m) => m[1].toUpperCase());
        for (const n of answerFigRefs) {
          if (!seenFigNums.has(n)) { aiFigures.push({ figure_number: n }); seenFigNums.add(n); }
        }
        const answerTblRefs = [...answerText2.matchAll(/\btable\s+([A-Z]?\d+(?:\.\d+)*)\b/gi)].map((m) => m[1].toUpperCase());
        for (const n of answerTblRefs) {
          if (!seenTblNums.has(n)) { aiTables.push({ table_number: n }); seenTblNums.add(n); }
        }

        const figNums = aiFigures.map((f: any) => f.figure_number).filter(Boolean);
        const tblNums = aiTables.map((t: any) => t.table_number).filter(Boolean);

        // Build standard code → UUID map once; used by figures, tables, and citations below
        const normCode = (s: string) => (s || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
        const codeToStdId = new Map<string, string>();
        for (const [id, s] of standardMap.entries()) {
          const n = normCode((s as any).standard_code);
          if (n) codeToStdId.set(n, id);
          // Some standards have no standard_code set at all (confirmed in
          // production, 2026-08-03 — a real user's own AS/NZS 3000 upload).
          // Without this, resolveStdId can never find that standard no
          // matter how correctly the AI cites it, so every table/figure/
          // clause lookup below falls back to "any standard with the same
          // number" — how a plumbing table opened for an electrical
          // citation even after standard_id-based cross-trade scoping.
          const titleKey = normCode((s as any).title);
          if (titleKey && !codeToStdId.has(titleKey)) codeToStdId.set(titleKey, id);
        }

        if (figNums.length > 0 || tblNums.length > 0) {
          const [figRows, tblRows] = await Promise.all([
            figNums.length > 0
              ? supabase.from("standard_figures").select("figure_number, image_url, caption, page_number, standard_id")
                  .or(ownershipFilter).in("figure_number", figNums).in("standard_id", standardIds)
              : Promise.resolve({ data: [] }),
            tblNums.length > 0
              ? supabase.from("standard_tables").select("table_number, image_url, caption, page_number, standard_id")
                  .or(ownershipFilter).in("table_number", tblNums).in("standard_id", standardIds)
              : Promise.resolve({ data: [] }),
          ]);

          // Key by "standardId::number" so same number from two standards don't overwrite each other
          const figMap = new Map((figRows.data || []).map((r: any) => [`${r.standard_id}::${r.figure_number}`, r]));
          const tblMap = new Map((tblRows.data || []).map((r: any) => [`${r.standard_id}::${r.table_number}`, r]));
          // Fallback maps keyed by number only (used when no standard hint available)
          const figMapByNum = new Map<string, any>();
          for (const r of figRows.data || []) { if (!figMapByNum.has(r.figure_number)) figMapByNum.set(r.figure_number, r); }
          const tblMapByNum = new Map<string, any>();
          for (const r of tblRows.data || []) { if (!tblMapByNum.has(r.table_number)) tblMapByNum.set(r.table_number, r); }

          // Find page in matched chunks. When hintStdId is known, only look
          // within that standard — falling back to matches[0] (any standard)
          // silently swapped in a different standard's identically-numbered
          // table/clause, which is how a plumbing table opened for an
          // electrical citation. Only use the cross-standard best-guess when
          // we genuinely don't know which standard the AI meant.
          const findPageInChunks = (label: string, num: string, hintStdId?: string) => {
            const pat = new RegExp(`\\b${label}\\s+${num.replace(/\./g, "\\.")}\\b`, "i");
            const matches = matchedChunks.filter((c: any) =>
              pat.test(c.content) || (c.clause_number || "").toUpperCase() === `${label.toUpperCase()} ${num}`
            );
            const hit = hintStdId ? matches.find((c: any) => c.standard_id === hintStdId) : matches[0];
            return hit ? { page_number: hit.page_number, standard_id: hit.standard_id } : null;
          };

          // Resolve hintStdId from a standard_code string (same normCode helper defined below)
          const resolveStdId = (code: string | null | undefined): string | null => {
            if (!code) return null;
            const norm = (code || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
            return [...codeToStdId.entries()].find(([k]) => k.includes(norm) || norm.includes(k))?.[1] ?? null;
          };

          // The standard-figures bucket is private, but rows store the public
          // URL from upload time — served as-is those 403 in chat. Convert to
          // a short-lived signed URL; if signing fails, fall back to the page
          // link (image_url: null keeps standard_id + page_number intact).
          const signImageUrl = async (storedUrl: string | null): Promise<string | null> => {
            if (!storedUrl) return null;
            const marker = "/standard-figures/";
            const i = storedUrl.indexOf(marker);
            if (i === -1) return storedUrl;
            const path = decodeURIComponent(storedUrl.slice(i + marker.length).split("?")[0]);
            const { data } = await supabase.storage.from("standard-figures").createSignedUrl(path, 3600);
            return data?.signedUrl ?? null;
          };

          parsedResponse.figures_referenced = (await Promise.all(aiFigures.map(async (f: any) => {
            const hintStdId = resolveStdId(f.standard_code);
            const row = hintStdId ? figMap.get(`${hintStdId}::${f.figure_number}`) : figMapByNum.get(f.figure_number);
            if (row?.image_url) {
              const signed = await signImageUrl(row.image_url);
              return { ...f, image_url: signed, caption: f.caption || row.caption, page_number: row.page_number, standard_id: row.standard_id };
            }
            const pi = findPageInChunks("Figure", f.figure_number, hintStdId ?? undefined);
            if (pi) return { ...f, page_number: pi.page_number, standard_id: pi.standard_id };
            if (hintStdId) return { ...f, standard_id: hintStdId, page_number: null };
            return null;
          }))).filter(Boolean);

          parsedResponse.tables_referenced = aiTables.map((t: any) => {
            const hintStdId = resolveStdId(t.standard_code);
            const row = hintStdId ? tblMap.get(`${hintStdId}::${t.table_number}`) : tblMapByNum.get(t.table_number);
            // standard_tables rows carry the authoritative caption page even
            // when image_url is empty (tables use the PDF page link, not an
            // image) — prefer that over scanning chunks.
            if (row) return { ...t, image_url: row.image_url || null, caption: t.caption || row.caption, page_number: row.page_number, standard_id: row.standard_id };
            const pi = findPageInChunks("Table", t.table_number, hintStdId ?? undefined);
            if (pi) return { ...t, page_number: pi.page_number, standard_id: pi.standard_id };
            if (hintStdId) return { ...t, standard_id: hintStdId, page_number: null };
            return null;
          }).filter(Boolean);
        } else {
          parsedResponse.figures_referenced = [];
          parsedResponse.tables_referenced = [];
        }

        // Verify clause numbers cited in the answer against the standards the
        // context actually came from — not the whole library. A clause that
        // exists in the cited standard isn't a hallucination just because its
        // chunk missed the retrieval cut; but a clause number that only exists
        // in a DIFFERENT standard (AS 2870's "2.5.1" legitimising a cited
        // AS/NZS 3000 "2.5.1") must not pass.
        const answerNums = [...new Set(
          [...(parsedResponse.answer || "").matchAll(/\b\d+(?:\.\d+)+\b/g)].map((m: any) => m[0])
        )].slice(0, 25) as string[];
        let dbClauseNumbers = new Set<string>();
        if (answerNums.length > 0 && standardIds.length > 0) {
          const { data: verifiedRows } = await supabase
            .from("standard_chunks")
            .select("clause_number")
            .or(ownershipFilter)
            .in("standard_id", standardIds)
            .in("clause_number", answerNums)
            .limit(50);
          dbClauseNumbers = new Set((verifiedRows || []).map((r: any) => r.clause_number));
        }

        // Validate answer
        const validation = validateResponse({
          response: parsedResponse.answer || "",
          chunks: matchedChunks,
          query: effectiveQuestion,
          trade,
          knownClauseNumbers: dbClauseNumbers,
        });
        parsedResponse.answer = validation.cleanedResponse;

        // Strip hallucinated citations
        if (parsedResponse.citations?.length && matchedChunks.length > 0) {
          const allChunkText = matchedChunks.map((c: any) => c.content.toLowerCase()).join(" ");
          // Clauses we genuinely put in context. A citation pointing at one of
          // these is grounded by retrieval — keep it even if the AI paraphrased
          // the quote. The old filter dropped these whenever relevant_text
          // wasn't near-verbatim, which is why correct, well-retrieved answers
          // (MEN, main-earth resistance) came back with no clause chip at all.
          const retrievedClauseNums = new Set(
            matchedChunks.map((c: any) => (c.clause_number || "").toString().trim().toUpperCase()).filter(Boolean)
          );
          parsedResponse.citations = parsedResponse.citations.filter((c: any) => {
            const cn = (c.clause_number || "").toString().trim().toUpperCase();
            if (cn && retrievedClauseNums.has(cn)) return true;
            // Otherwise the clause wasn't retrieved — demand the quote actually
            // matches the extracts before trusting it (hallucination guard).
            if (!c.relevant_text || c.relevant_text.trim().length < 10) return false;
            const words = c.relevant_text.toLowerCase().split(/\W+/).filter((w: string) => w.length > 3);
            if (words.length === 0) return false;
            const matches = words.filter((w: string) => allChunkText.includes(w)).length;
            return matches / words.length >= 0.6;
          });
        }

        // Attach the real standard_id + page to each citation from the matched
        // chunks. Prefer chunks from the same standard the AI cited (c.standard_code)
        // to avoid e.g. AS3000 clause 3.1.1 shadowing AS3017 clause 3.1.1.
        if (parsedResponse.citations?.length) {
          for (const c of parsedResponse.citations) {
            const want = (c.clause_number || "").toString().trim();
            const cHint = normCode(c.standard_code || "");
            // Find the standard_id that best matches the AI's stated standard_code
            const hintStdId = cHint
              ? ([...codeToStdId.entries()].find(([code]) => code.includes(cHint) || cHint.includes(code))?.[1] ?? null)
              : null;

            if (hintStdId) {
              // Always trust the AI's standard_code over a chunk hit — avoids same clause
              // number in a different standard (e.g. AS3000 3.1.1) poisoning the page lookup.
              // Set page_number to null so fetch-pdf does a fresh DB lookup for the right page.
              c.standard_id = hintStdId;
              c.page_number = null;
            } else {
              // No standard hint — fall back to chunk matching
              const hit =
                matchedChunks.find((mc: any) => (mc.clause_number || "").toString().trim() === want) ||
                matchedChunks.find((mc: any) => want && (mc.clause_number || "").toString().trim().startsWith(want));
              if (hit) {
                c.standard_id = hit.standard_id;
                if (c.page_number == null) c.page_number = hit.page_number;
              } else if (standardIds.length === 1) {
                c.standard_id = standardIds[0];
              }
            }
          }
        }

        // Fallback: scan answer text for clause references and auto-cite from
        // matched chunks. Catches "Clause 2.2.2", "clause 2.2.2", bare "2.2.2"
        // references, and high-similarity top chunks when no citations were found.
        if (matchedChunks.length > 0) {
          const citedNums = new Set(
            parsedResponse.citations.map((c: any) => (c.clause_number || "").toString().trim())
          );

          // Pattern 1: explicit "clause X.X.X" or "section X.X.X"
          const answerClauseRefs = [
            ...(parsedResponse.answer || "").matchAll(/\b(?:clause|section)\s+(\d+(?:\.\d+){1,4})\b/gi)
          ].map((m) => m[1]);

          // Pattern 2: bare clause numbers like "2.2.2" appearing in answer (only X.X.X+ depth)
          const bareClauseRefs = [
            ...(parsedResponse.answer || "").matchAll(/\b(\d+(?:\.\d+){2,4})\b/g)
          ].map((m) => m[1]);

          // Pattern 3: if still no citations after all patterns, surface the top
          // high-similarity chunk so at least one clause badge appears
          const allRefs = [...new Set([...answerClauseRefs, ...bareClauseRefs])];

          // Determine dominant standard from answer context — look for explicit standard
          // mentions near each ref so auto-cited clauses pick the right standard.
          const findNearbyStdId = (answer: string, ref: string): string | null => {
            const idx = answer.search(new RegExp(`\\b${ref.replace(/\./g, "\\.")}\\b`));
            if (idx === -1) return null;
            const window = answer.slice(Math.max(0, idx - 120), idx + ref.length + 120);
            const m = window.match(/\bAS(?:\/NZS)?\s*\d+(?:\.\d+)*(?::\d+)?\b/i);
            if (!m) return null;
            const norm = (m[0] || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
            return [...codeToStdId.entries()].find(([k]) => k.includes(norm) || norm.includes(k))?.[1] ?? null;
          };

          for (const ref of allRefs) {
            if (citedNums.has(ref)) continue;
            const hintStdId = findNearbyStdId(parsedResponse.answer || "", ref);
            // Exact clause-number match ONLY. The old startsWith fallbacks
            // attached a parent or sibling chunk (2.5.1.2 for "2.5.1") whose
            // text may not support the claim — a manufactured citation. When
            // a nearby standard mention names the standard, only match within
            // it — a same-numbered clause in a different standard is not the
            // same clause.
            const hit = hintStdId
              ? matchedChunks.find((mc: any) => mc.standard_id === hintStdId && (mc.clause_number || "").toString().trim() === ref)
              : matchedChunks.find((mc: any) => (mc.clause_number || "").toString().trim() === ref);
            if (hit) {
              const std = standardMap.get(hit.standard_id);
              parsedResponse.citations.push({
                standard_code: std?.standard_code || null,
                standard_version: std?.version || null,
                clause_number: hit.clause_number,
                relevant_text: (hit.content || "").slice(0, 300).trim(),
                page_number: hit.page_number,
                standard_id: hit.standard_id,
              });
              citedNums.add((hit.clause_number || "").toString().trim());
            }
          }

          // Grounded last-resort citation. If the answer still earned no
          // citation, recover one ONLY when retrieval was genuinely relevant
          // (an exact clause hit, or a strong vector match) AND the answer text
          // lexically overlaps a retrieved clause chunk — proof the answer came
          // from that clause. The dual guard is exactly what stops this
          // manufacturing authority on a general-knowledge answer (low
          // similarity, or no overlap), which is why the blanket version was
          // removed. Rule 3 keeps clause numbers out of the answer prose, so
          // without this a correct, well-grounded answer shows no clickable
          // source at all — the gap the eval surfaced.
          if (parsedResponse.citations.length === 0 && (hasExactClauseHit || maxVectorSim >= 0.55)) {
            const answerWords = new Set((parsedResponse.answer || "").toLowerCase().match(/\b[a-z]{5,}\b/g) || []);
            if (answerWords.size >= 3) {
              const isRealClause = (cn: string) => cn !== "" && /^[A-Z]?\d+(?:\.\d+)*$/.test(cn);
              const scored = matchedChunks
                .filter((c: any) => isRealClause((c.clause_number || "").toString().trim()) && c.chunk_index !== 0)
                .map((c: any) => {
                  const chunkLc = (c.content || "").toLowerCase();
                  let hit = 0;
                  for (const w of answerWords) if (chunkLc.includes(w)) hit++;
                  return { c, overlap: hit / answerWords.size };
                })
                .filter((s: any) => s.overlap >= 0.30)
                .sort((a: any, b: any) => b.overlap - a.overlap)
                .slice(0, 2);
              for (const { c: hit } of scored) {
                const std = standardMap.get(hit.standard_id);
                parsedResponse.citations.push({
                  standard_code: std?.standard_code || null,
                  standard_version: std?.version || null,
                  clause_number: hit.clause_number,
                  relevant_text: (hit.content || "").replace(/^\[[^\]]*\]\s*/, "").slice(0, 300).trim(),
                  page_number: hit.page_number,
                  standard_id: hit.standard_id,
                });
              }
            }
          }
        }

        // Dedupe citation chips and figure/table references — the model
        // sometimes emits the same clause twice, and question + answer scans
        // can add the same figure from two paths.
        {
          const seenCites = new Set<string>();
          parsedResponse.citations = (parsedResponse.citations || []).filter((c: any) => {
            const key = `${normCode(c.standard_code || "")}::${(c.clause_number || "").toString().trim().toUpperCase()}`;
            if (seenCites.has(key)) return false;
            seenCites.add(key);
            return true;
          });
          const dedupeRefs = (list: any[], numKey: string) => {
            const seen = new Set<string>();
            return (list || []).filter((r: any) => {
              const key = `${r.standard_id || ""}::${(r[numKey] || "").toString().toUpperCase()}`;
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
          };
          parsedResponse.figures_referenced = dedupeRefs(parsedResponse.figures_referenced, "figure_number");
          parsedResponse.tables_referenced = dedupeRefs(parsedResponse.tables_referenced, "table_number");
        }

        // Snapshot the real citations BEFORE gating — the analytics tables
        // used to permanently store "[Upgrade to Pro to unlock this clause]"
        // for every free-tier query.
        const citationsForLog = (parsedResponse.citations || []).map((c: any) => ({ ...c }));

        // Free tier clause gating
        if (tier === "free" && parsedResponse.citations) {
          parsedResponse.citations = parsedResponse.citations.map((c: any) => ({
            ...c,
            clause_number: "[Upgrade to Pro to unlock this clause]",
            relevant_text: "This clause is available with a Pro subscription.",
            gated: true,
          }));
          parsedResponse.gated = true;
          parsedResponse.gated_message = "You're on the right track — upgrade to Pro to get the full clause and complete guidance.";
        }

        // Send done event with full metadata
        const donePayload = {
          done: true,
          ...parsedResponse,
          low_confidence: isLowConfidence,
          queries_remaining: tier === "free" ? Math.max(0, maxQueries - todayCount) : null,
          queryId,
          confidence_score: validation.confidenceScore,
          needs_review: validation.needsReview,
        };
        await writer.write(encoder.encode(`data: ${JSON.stringify(donePayload)}\n\n`));

        // Non-blocking DB logging
        (async () => {
          await supabase.from("query_log").insert({
            id: queryId,
            user_id: userId,
            query_text: effectiveQuestion,
            trade,
            retrieved_chunk_ids: matchedChunks.map((c: any) => c.id).filter(Boolean),
            retrieved_chunk_count: matchedChunks.length,
            model_used: "claude-sonnet-4-6",
            response_text: parsedResponse.answer,
            confidence_score: validation.confidenceScore,
            validation_issues: validation.issues,
            needs_review: validation.needsReview,
          });
          const { data: queryRecord } = await supabase.from("queries").insert({
            user_id: userId,
            question: effectiveQuestion,
            response: parsedResponse.answer,
            citations: citationsForLog,
            confidence_score: topSimilarity,
            safety_flagged: parsedResponse.safety_critical || false,
            subscription_tier_at_time: tier,
          }).select().single();
          const resolvedCitations = citationsForLog.map((c: any) => ({
            ...c,
            standard_id: standards?.find((s: any) => s.standard_code === c.standard_code)?.id || standardIds[0],
          }));
          if (queryRecord && resolvedCitations.length > 0) {
            await supabase.from("citations").insert(resolvedCitations.map((c: any) => ({
              query_id: queryRecord.id,
              standard_id: c.standard_id,
              clause_number: c.clause_number,
              standard_code: c.standard_code,
              version: c.standard_version,
              page_number: c.page_number,
              confidence_score: topSimilarity,
              chunk_content: c.relevant_text,
            })));
          }

          // Write into the shared team question cache so a teammate's
          // close-enough repeat question can reuse this instead of paying
          // for Claude again. Skipped for gated/safety-flagged answers and
          // whenever the embedding call failed — never cache a degraded or
          // unverified response. Citations are stored WITH standard_id
          // already resolved (above) since a cache-hit read has no access
          // to the `standards` metadata lookup used to resolve it here.
          if (orgId && cachedQueryEmbedding && !parsedResponse.gated && !parsedResponse.safety_critical) {
            await supabase.from("question_cache").insert({
              organization_id: orgId,
              standard_id: standardIds[0] || null,
              question: effectiveQuestion,
              prompt_version: PROMPT_VERSION,
              // Table INSERT of a vector column needs the JSON-stringified
              // form to be parsed correctly by PostgREST — RPC parameters
              // (e.g. match_chunks/match_cached_question above) accept the
              // raw array directly, but a plain table write does not (same
              // pattern already used in embed-chunks/index.ts).
              question_embedding: JSON.stringify(cachedQueryEmbedding),
              response: {
                answer: parsedResponse.answer,
                citations: resolvedCitations,
                figures_referenced: parsedResponse.figures_referenced || [],
                tables_referenced: parsedResponse.tables_referenced || [],
                confidence: parsedResponse.confidence,
                follow_up_questions: parsedResponse.follow_up_questions || [],
                safety_critical: parsedResponse.safety_critical || false,
                safety_message: parsedResponse.safety_message,
                answer_found: parsedResponse.answer_found,
              },
            });
          }

          // Increment daily_query_count on profiles (best-effort, never crashes the response)
          try {
            const { data: profileRow } = await supabase
              .from("profiles")
              .select("daily_query_count")
              .eq("user_id", userId)
              .single();
            const currentCount: number = profileRow?.daily_query_count ?? 0;
            await supabase
              .from("profiles")
              .update({ daily_query_count: currentCount + 1 })
              .eq("user_id", userId);
          } catch (countErr) {
            console.error("[query] Failed to increment daily_query_count:", countErr);
          }
        })().catch(console.error);

      } catch (e) {
        console.error("Stream error:", e);
        try {
          const encoder2 = new TextEncoder();
          await writer.write(encoder2.encode(`data: ${JSON.stringify({ error: "Stream processing failed" })}\n\n`));
        } catch {}
      } finally {
        writer.close().catch(() => {});
      }
    })();

    return new Response(readable, { headers: sseHeaders });

  } catch (e) {
    console.error("Query error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
