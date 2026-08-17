import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAllowedOrigin } from "../_shared/cors.ts";
import { logTokenUsage } from "../_shared/log-usage.ts";
import { parseExtractedText } from "../process-standard/extraction.ts";
import { detectTrade } from "../query/trade-detection.ts";
import type { TradeType } from "../query/system-prompt.ts";

type StandardChunk = {
  content: string;
  clause_number: string | null;
  clause_title: string | null;
  chunk_index?: number;
};

// Matches both placeholder wordings the pipeline has used over time
const FIGURE_PLACEHOLDER = "description will be generated shortly";

// Unbiased in-place shuffle — Math.random()-0.5 in sort() is biased and was
// making "random" question selection lean heavily on insertion order.
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// The AI sometimes returns correct_answer as a letter ("B") or slightly
// reworded text. The frontend compares option text exactly, so any mismatch
// makes a question impossible to answer correctly. Normalise to the exact
// option text, or drop the question rather than serve a broken one.
function normaliseQuestions(raw: any[]): any[] {
  const letters = ["A", "B", "C", "D"];
  return (raw || []).flatMap((q: any) => {
    if (!q?.question || !Array.isArray(q.options) || q.options.length !== 4) return [];
    let ca = (q.correct_answer ?? "").toString().trim();
    if (!q.options.includes(ca)) {
      const letterIdx = letters.indexOf(ca.toUpperCase().replace(/[).:\s]/g, ""));
      const caLower = ca.toLowerCase();
      const match =
        (letterIdx >= 0 ? q.options[letterIdx] : undefined) ??
        q.options.find((o: string) => o.toLowerCase().trim() === caLower) ??
        q.options.find((o: string) => o.toLowerCase().includes(caLower) || caLower.includes(o.toLowerCase().trim()));
      if (!match) return [];
      ca = match;
    }
    return [{ ...q, correct_answer: ca }];
  });
}

async function fetchStandardChunks(
  supabase: any,
  standardId: string,
  limit: number,
  topic?: string,
  sectionFilter?: string,
): Promise<StandardChunk[]> {
  // Always fetch a large pool and sample from it — taking the first N chunks
  // meant every quiz was generated from the front of the standard (scope and
  // definitions) and never reached earthing, testing, or the appendices.
  const poolSize = Math.max(limit * 10, 300);

  const buildQuery = (indexed: boolean) => {
    let q = supabase
      .from("standard_chunks")
      .select("content, clause_number, clause_title, chunk_index")
      .eq("standard_id", standardId)
      .order("chunk_index", { ascending: true })
      .limit(poolSize);
    if (indexed) q = q.eq("is_indexed", true);
    if (sectionFilter) {
      // Include text clauses, figures, and tables for this section
      q = q.or(
        `clause_number.like.${sectionFilter}.%,clause_number.eq.${sectionFilter},clause_number.ilike.FIGURE ${sectionFilter}.%,clause_number.ilike.FIGURE ${sectionFilter},clause_number.ilike.TABLE ${sectionFilter}.%,clause_number.ilike.TABLE ${sectionFilter}`
      );
    }
    return q;
  };

  let { data: chunks, error: indexedError } = await buildQuery(true);

  if (indexedError) throw indexedError;

  if (!chunks?.length) {
    const { data: fallbackChunks, error: fallbackError } = await buildQuery(false);
    if (fallbackError) throw fallbackError;
    chunks = fallbackChunks;
  }

  // Drop chunks with no substance for question generation: bare headings and
  // figure placeholders make for empty or misleading questions.
  const usable = ((chunks || []) as StandardChunk[]).filter((c) => {
    const content = c.content || "";
    if (content.length < 150) return false;
    if (content.toLowerCase().includes(FIGURE_PLACEHOLDER.toLowerCase())) return false;
    return true;
  });

  // If a topic is given, score by keyword relevance and take the top N
  if (topic && usable.length) {
    const words = topic.toLowerCase().split(/[\s,\/\-]+/).filter((w) => w.length > 3);
    if (words.length > 0) {
      const scored = usable.map((c) => {
        const hay = ((c.content || "") + " " + (c.clause_title || "")).toLowerCase();
        const score = words.reduce((acc, w) => acc + (hay.includes(w) ? 1 : 0), 0);
        return { chunk: c, score };
      });
      const relevant = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
      // Use topic-relevant chunks if we have enough; otherwise fall back to sampling
      if (relevant.length >= Math.min(limit, 5)) {
        return relevant.slice(0, limit).map((s) => s.chunk);
      }
    }
  }

  // No topic (or not enough topical matches): random sample across the whole
  // pool so questions cover the full standard, not just its opening pages —
  // then restore document order so study guides and prompts read coherently.
  return shuffle(usable)
    .slice(0, limit)
    .sort((a, b) => (a.chunk_index ?? 0) - (b.chunk_index ?? 0));
}

// Fetch described figure chunks (those that have been processed by describe-figures)
async function fetchDescribedFigures(
  supabase: any,
  standardId: string,
  limit: number,
  sectionFilter?: string,
): Promise<StandardChunk[]> {
  let q = supabase
    .from("standard_chunks")
    .select("content, clause_number, clause_title")
    .eq("standard_id", standardId)
    .like("clause_number", "FIGURE%")
    .not("content", "ilike", `%${FIGURE_PLACEHOLDER}%`)
    .limit(limit);

  if (sectionFilter) {
    q = q.or(`clause_number.ilike.FIGURE ${sectionFilter}.%,clause_number.ilike.FIGURE ${sectionFilter}`);
  }

  const { data } = await q;
  return data || [];
}

async function getChunksWithRecovery(
  supabase: any,
  standardId: string,
  authHeader: string,
  limit: number,
  topic?: string,
  sectionFilter?: string,
): Promise<StandardChunk[]> {
  let chunks = await fetchStandardChunks(supabase, standardId, limit, topic, sectionFilter);
  if (chunks.length > 0) return chunks;

  const processUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/process-standard`;
  const processResponse = await fetch(processUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
      apikey: Deno.env.get("SUPABASE_ANON_KEY") || "",
    },
    body: JSON.stringify({ standard_id: standardId }),
  });

  const processBody = await processResponse.text();
  if (!processResponse.ok) {
    console.error("process-standard recovery failed:", processResponse.status, processBody);
    return chunks;
  }

  chunks = await fetchStandardChunks(supabase, standardId, limit, topic, sectionFilter);
  return chunks;
}

type OtherStandardChunk = StandardChunk & { standard_code: string };

// Semantic search for scenario_walkthrough. Two parts:
// 1. primaryChunks — search across the WHOLE selected standard (via
//    match_chunks_by_standard), not a keyword-filtered slice of it. The AI's
//    own decision points often use terms (e.g. "RCD") the apprentice's
//    scenario text never mentioned, so keyword-overlap retrieval misses real
//    clauses that semantic search finds.
// 2. otherChunks — the same embedding, searched across the rest of the
//    user's own uploaded standards (via match_chunks, scoped to their
//    user/org — never another user's licensed content). Lets the AI say
//    "that's covered in AS/NZS 3017, not the standard you're studying"
//    instead of a flat "not covered" when the apprentice has that standard
//    uploaded but simply isn't studying it right now.
// Falls back to keyword-based fetchStandardChunks for primaryChunks if
// embeddings are unavailable or return too little — never leave the caller
// with nothing to work with.
async function fetchScenarioContext(
  supabase: any,
  standardId: string,
  queryText: string,
  openaiKey: string | undefined,
  limit: number,
  userId: string,
  sectionFilter?: string,
): Promise<{ primaryChunks: StandardChunk[]; otherChunks: OtherStandardChunk[] }> {
  if (openaiKey) {
    try {
      const embResponse = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "text-embedding-3-small", input: queryText }),
      });
      if (embResponse.ok) {
        const embData = await embResponse.json();
        if (embData.usage) {
          logTokenUsage(supabase, {
            userId, kind: "capstone_scenario_embedding", model: "text-embedding-3-small",
            usage: { input_tokens: embData.usage.prompt_tokens ?? 0, output_tokens: 0 },
          });
        }
        const queryEmbedding = embData.data[0].embedding;
        const [primaryResult, otherResult] = await Promise.all([
          supabase.rpc("match_chunks_by_standard", {
            query_embedding: queryEmbedding,
            match_standard_id: standardId,
            match_threshold: 0.30,
            match_count: limit,
          }),
          // Higher threshold than the primary search — this is only for
          // "you might find this elsewhere" hints, so only surface genuinely
          // close matches, not loosely-related noise from another standard.
          supabase.rpc("match_chunks", {
            query_embedding: queryEmbedding,
            match_user_id: userId,
            match_threshold: 0.45,
            match_count: 15,
          }),
        ]);

        let primaryChunks: StandardChunk[] = [];
        if (!primaryResult.error && primaryResult.data?.length >= 5) {
          primaryChunks = primaryResult.data as StandardChunk[];
          // The RPC can't apply the section filter itself, so narrow client
          // side — but only if enough survives, otherwise the unfiltered
          // whole-standard result is more useful than an empty one.
          if (sectionFilter) {
            const re = new RegExp(`^(FIGURE |TABLE )?${sectionFilter.replace(".", "\\.")}(\\.|$)`, "i");
            const narrowed = primaryChunks.filter((c) => c.clause_number && re.test(c.clause_number));
            if (narrowed.length >= 3) primaryChunks = narrowed;
          }
        } else {
          primaryChunks = await fetchStandardChunks(supabase, standardId, limit, queryText, sectionFilter);
        }

        let otherChunks: OtherStandardChunk[] = [];
        const otherRaw = ((otherResult.data || []) as any[]).filter((c) => c.standard_id !== standardId);
        if (otherRaw.length > 0) {
          const otherIds = [...new Set(otherRaw.map((c) => c.standard_id))];
          const { data: otherStandards } = await supabase
            .from("standards")
            .select("id, standard_code, title")
            .in("id", otherIds);
          const codeById = new Map((otherStandards || []).map((s: any) => [s.id, s.standard_code || s.title || "another standard"]));
          otherChunks = otherRaw
            .slice(0, 10)
            .map((c) => ({ ...c, standard_code: codeById.get(c.standard_id) || "another standard" }));
        }

        return { primaryChunks, otherChunks };
      }
      console.error("[capstone] embedding request failed:", embResponse.status, await embResponse.text());
    } catch (e) {
      console.error("[capstone] semantic retrieval failed, falling back to keyword search:", e);
    }
  }
  const primaryChunks = await fetchStandardChunks(supabase, standardId, limit, queryText, sectionFilter);
  return { primaryChunks, otherChunks: [] };
}

// Convert an OpenAI-style message content array into Anthropic blocks.
// Mainly handles images: OpenAI uses {type:"image_url", image_url:{url}},
// Anthropic uses {type:"image", source:{type:"base64", media_type, data}}.
function toAnthropicContent(content: unknown): unknown {
  if (!Array.isArray(content)) return content;
  return content.map((block: any) => {
    if (block?.type === "image_url" && block.image_url?.url) {
      const m = String(block.image_url.url).match(/^data:(.+?);base64,(.*)$/);
      if (m) return { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } };
    }
    return block;
  });
}

// Pull the input object from the first Anthropic tool_use block (replaces
// OpenAI's choices[0].message.tool_calls[0].function.arguments).
function getToolInput(aiData: any): any | null {
  const block = aiData?.content?.find?.((b: any) => b.type === "tool_use");
  return block ? block.input : null;
}

// Concatenate text from Anthropic text blocks (replaces choices[0].message.content).
function getText(aiData: any): string {
  const blocks = aiData?.content?.filter?.((b: any) => b.type === "text") || [];
  return blocks.map((b: any) => b.text).join("").trim();
}

async function callAI(
  body: Record<string, unknown>,
  anthropicKey: string,
  options: {
    temperature?: number;
    max_tokens?: number;
    usageLogger?: { supabaseAdmin: any; userId: string; kind: string };
  } = {},
): Promise<Response> {
  const payload: Record<string, unknown> = { ...body };
  if (!("max_tokens" in payload)) payload.max_tokens = options.max_tokens ?? 1000;
  // Claude doesn't use temperature; remove if present
  delete payload.temperature;

  // ── Translate OpenAI-shaped fields → Anthropic Messages API format ──
  // System: Anthropic takes a top-level `system` string, not a message role.
  if (Array.isArray(payload.messages)) {
    const msgs = payload.messages as any[];
    const systemText = msgs.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    if (systemText) payload.system = systemText;
    payload.messages = msgs
      .filter((m) => m.role !== "system")
      .map((m) => ({ ...m, content: toAnthropicContent(m.content) }));
  }
  // Tools: OpenAI {type:"function", function:{name, description, parameters}}
  //        → Anthropic {name, description, input_schema}
  if (Array.isArray(payload.tools)) {
    payload.tools = (payload.tools as any[]).map((t) =>
      t?.function
        ? { name: t.function.name, description: t.function.description, input_schema: t.function.parameters }
        : t
    );
  }
  // tool_choice: OpenAI {type:"function", function:{name}} → Anthropic {type:"tool", name}
  if (payload.tool_choice && (payload.tool_choice as any).function) {
    payload.tool_choice = { type: "tool", name: (payload.tool_choice as any).function.name };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);
  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": anthropicKey, "Content-Type": "application/json", "anthropic-version": "2023-06-01" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    const errText = await res.clone().text();
    console.error(`[capstone] Claude error (${res.status}): ${errText}`);
  } else if (options.usageLogger) {
    // Clone so the caller can still read the body — .json() can only be
    // consumed once per Response.
    res.clone().json().then((data) => {
      if (!data?.usage) return;
      logTokenUsage(options.usageLogger!.supabaseAdmin, {
        userId: options.usageLogger!.userId, kind: options.usageLogger!.kind, model: (payload.model as string) || "claude-sonnet-4-6",
        usage: {
          input_tokens: data.usage.input_tokens ?? 0,
          output_tokens: data.usage.output_tokens ?? 0,
          cache_read_tokens: data.usage.cache_read_input_tokens ?? 0,
          cache_creation_tokens: data.usage.cache_creation_input_tokens ?? 0,
        },
      });
    }).catch((e) => console.error("[capstone] usage logging parse failed:", e));
  }
  return res;
}

// Appended to every system prompt whose output an apprentice reads directly.
const APPRENTICE_STYLE = `
Writing style (all output is read by Australian apprentices on a phone):
- Plain English, short sentences, Australian spelling (colour, earthing, metre)
- Explain any technical term the first time you use it
- Use markdown: short headings, then real "- " bullet list items underneath each one for each fact/rule — do NOT write flowing paragraph sentences, one fact per bullet
- Bold sparingly: at most one key term or value per line, never multiple bolded phrases in the same sentence — bold that loses its emphasis is as bad as no bold
- Never use "---" horizontal-rule dividers between sections — heading spacing alone separates them; a divider after every section reads as a wall of clutter
- Never use wide tables — use bullet lists instead
- Put every formula and calculation step on its own line, always with units`;

// Used by generate_calculation to phrase "Section C ... capstone exams" per trade.
const TRADE_LABEL: Record<TradeType, string> = {
  electrical: "electrical",
  plumbing: "plumbing",
  mechanical: "mechanical/HVAC",
  structural: "structural",
  building: "building",
  general: "trade",
};

// Mirrors the `id` keys in TOOL_COMPONENTS (src/pages/Tools.tsx) — keep in
// sync if a tool is added/renamed there. Used by scenario_walkthrough to
// point an apprentice at an existing calculator instead of leaving a
// calculation-shaped decision point as plain text.
const TOOL_CATALOG: { id: string; title: string; hint: string }[] = [
  { id: "voltage-drop", title: "Voltage Drop", hint: "AC/DC voltage drop over a cable run" },
  { id: "cable-sizer", title: "Cable Sizer", hint: "selecting cable size/rating for a load, run and install conditions" },
  { id: "max-demand", title: "Maximum Demand", hint: "diversity/demand factor and main switch sizing" },
  { id: "conduit-fill", title: "Conduit Fill", hint: "space-factor check for multiple cables in one conduit" },
  { id: "earth-conductor", title: "Earth Conductor Size", hint: "minimum earthing conductor size" },
  { id: "fault-loop", title: "Fault Loop Impedance", hint: "maximum Zs for a breaker/curve to trip in time" },
  { id: "pv-string", title: "PV String Sizing", hint: "temperature-corrected solar string voltage vs inverter window" },
  { id: "dc-isolator", title: "DC Isolator Rating", hint: "minimum DC isolator ratings from array datasheet values" },
  { id: "battery-check", title: "Battery Install Checker", hint: "battery location/install screening" },
  { id: "heat-load", title: "Heat Load", hint: "cooling/heating capacity estimate" },
  { id: "duct-sizing", title: "Duct Sizing", hint: "round/rectangular duct size from airflow" },
  { id: "ventilation", title: "Ventilation Sizing", hint: "exhaust/outside-air rate" },
  { id: "pipe-sizing", title: "Pipe Sizing", hint: "pipe diameter from flow rate" },
  { id: "gas-pipe", title: "Gas Pipe Sizing", hint: "gas pipe size by load and run length" },
  { id: "drainage-fall", title: "Drainage Fall", hint: "drainage pipe grade/fall" },
  { id: "backflow", title: "Backflow Prevention", hint: "backflow device selection by hazard rating" },
  { id: "stormwater", title: "Stormwater Sizing", hint: "gutter/downpipe sizing" },
  { id: "brick-calc", title: "Brick & Block", hint: "brick/mortar/sand quantity estimate" },
  { id: "timber-span", title: "Timber Span", hint: "joist/rafter/bearer span selection" },
  { id: "roof-pitch", title: "Roof Pitch", hint: "pitch, rafter length, roof area" },
  { id: "concrete-volume", title: "Concrete Volume", hint: "concrete volume for a slab/footing/pad" },
  { id: "steel-lintel", title: "Steel Lintel Sizing", hint: "indicative lintel size guide" },
  { id: "stair-compliance", title: "Stair Rise & Going", hint: "stair riser/going compliance check" },
];

// Electrical keeps its own dedicated formula cheat-sheet (proven, unchanged).
// Every other trade is steered towards topics that are genuinely calculation-
// shaped in these standards, but the actual formulas/values must always come
// from the retrieved standard content — never hand-authored here, since
// getting a pipe-sizing or span-table figure wrong is worse than not asking.
const CALC_TRADE_CONFIG: Record<TradeType, { topic: string; hint: string }> = {
  electrical: { topic: "maximum demand voltage drop cable", hint: "" },
  plumbing: {
    topic: "pipe sizing flow rate loading units discharge pressure loss hot water gas consumption",
    hint: "pipe or fixture sizing by loading units, discharge/vent sizing, hot water delivery time, pressure or head loss along a run, or gas pipe sizing by MJ/h consumption",
  },
  mechanical: {
    topic: "duct sizing airflow ventilation rate fan pump",
    hint: "duct or pipe sizing from airflow/velocity, fan or pump selection, or required ventilation rate for a room volume",
  },
  structural: {
    topic: "span load beam footing bracing reinforcement",
    hint: "span tables for beams or joists, footing sizing from load, or bracing unit calculations",
  },
  building: {
    topic: "concrete volume slab reinforcement footing soil classification",
    hint: "concrete volume or quantity takeoff, slab reinforcement spacing, or footing depth for a soil classification",
  },
  general: {
    topic: "",
    hint: "a realistic sizing, capacity or compliance calculation directly grounded in the standard content provided",
  },
};

serve(async (req) => {
  const origin = req.headers.get("Origin") || "";
  const corsHeaders = {
    "Access-Control-Allow-Origin": getAllowedOrigin(origin),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const unauthorised = () => new Response(JSON.stringify({ error: "Session expired. Please sign in again." }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return unauthorised();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return unauthorised();

    // Fetch subscription tier for rate limit enforcement
    // If profile missing, default to free tier
    let tier: "free" | "pro" | "business" = "free";
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("subscription_tier")
      .eq("id", user.id)
      .single();
    if (!profileError && profile?.subscription_tier) {
      tier = profile.subscription_tier;
    }

    const { action, standardId, topic, difficulty, questionCount, examId, questionId, questionIds, userAnswer, imageBase64, chunkId, examTopics, examPdfText, sectionFilter: rawSectionFilter, userClauseRef, practiceQuestionId, scenarioText } = await req.json();
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

    // sectionFilter is interpolated into PostgREST .or() filter strings, so it
    // must be a bare section/clause number (e.g. "3", "8.3.1"). Reject anything
    // else rather than let filter metacharacters through.
    const sectionFilter: string | undefined =
      typeof rawSectionFilter === "string" && /^[A-Za-z]?\d+(\.\d+)*$/.test(rawSectionFilter.trim())
        ? rawSectionFilter.trim()
        : undefined;

    const aiError = async (res: Response): Promise<Response> => {
      const body = await res.json().catch(() => null);
      const msg = body?.error?.message || body?.error || `AI error (${res.status})`;
      console.error(`[capstone] AI error ${res.status}: ${JSON.stringify(body)}`);
      if (res.status === 429) return new Response(JSON.stringify({ error: `Rate limited: ${msg}` }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (res.status === 402) return new Response(JSON.stringify({ error: `AI credits exhausted: ${msg}` }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ error: `AI error: ${msg}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    };

    // ── RATE LIMIT: 20 AI calls per hour per user (applies to AI actions only) ──
    // Atomic: the RPC records usage under an advisory lock, so concurrent
    // requests can't race past the cap. Recorded at the gate (not post-call),
    // so this replaces the old scattered capstone_usage inserts.
    // ── TIER GATES — Block free tier from premium features ──
    if (tier === "free") {
      if (action === "analyze_photo") {
        return new Response(JSON.stringify({
          error: "Photo analysis is a Pro feature. Upgrade to Pro to analyse your handwritten work.",
        }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (action === "scenario_walkthrough") {
        return new Response(JSON.stringify({
          error: "Scenario walkthroughs are a Pro feature. Upgrade to Pro to work through real job situations.",
        }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Validate photo input before the rate-limit gate so a rejected upload
    // doesn't burn one of the user's daily AI credits.
    if (action === "analyze_photo") {
      if (!imageBase64) throw new Error("No image provided");
      if (imageBase64.length > 5_000_000) {
        return new Response(JSON.stringify({ error: "That photo is too large even after compression. Try a lower-resolution photo or crop it to just your working." }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Validate before the rate-limit gate so a rejected scenario doesn't
    // burn one of the user's daily AI credits.
    if (action === "scenario_walkthrough") {
      if (!standardId) throw new Error("Select a standard first");
      if (typeof scenarioText !== "string" || !scenarioText.trim()) {
        return new Response(JSON.stringify({ error: "Describe the job situation first" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (scenarioText.length > 2000) {
        return new Response(JSON.stringify({ error: "That's a lot of detail — keep it under 2000 characters." }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // start_exam is not in AI_ACTIONS: it only calls Claude when the question
    // pool is short, so it invokes enforceAiRateLimit() itself at that point
    // rather than charging a slot for every exam start.
    const AI_ACTIONS = ["generate_questions", "analyze_photo", "explain_chunk", "generate_study_guide", "generate_short_answer", "generate_calculation", "grade_calculation", "grade_short_answer", "exam_prep", "scenario_walkthrough"];
    const enforceAiRateLimit = async (): Promise<Response | null> => {
      // Tier-based limits: free = 5/day, pro/business = 1000/day (effectively unlimited)
      const limits = tier === "free"
        ? { max: 5, window: 86400, desc: "5 per day" }
        : { max: 1000, window: 86400, desc: "per day" };

      // check_and_record_ai_usage is locked to service_role (migration
      // 20260706000001) — the user-scoped client would get permission denied.
      const serviceClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      const { data: used, error: rlError } = await serviceClient.rpc("check_and_record_ai_usage", {
        p_user_id: user.id,
        p_kind: "capstone",
        p_max: limits.max,
        p_window_seconds: limits.window,
      });
      if (rlError) {
        console.error("[capstone] rate-limit RPC failed:", rlError);
        return new Response(JSON.stringify({ error: "Service temporarily unavailable" }), {
          status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (typeof used === "number" && used < 0) {
        const tier_label = tier === "free" ? "Free tier" : "Pro";
        return new Response(JSON.stringify({
          error: `Daily limit reached. ${tier_label} accounts can make ${limits.desc} capstone AI requests. Please try again tomorrow.`,
        }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return null;
    };
    if (AI_ACTIONS.includes(action)) {
      const limited = await enforceAiRateLimit();
      if (limited) return limited;
    }

    // ── GENERATE QUIZ QUESTIONS ──
    if (action === "generate_questions") {
      // These three are independent — run them concurrently instead of
      // serially so their round trips overlap instead of stacking up.
      const [chunks, figureChunks, standardRes] = await Promise.all([
        getChunksWithRecovery(supabase, standardId, authHeader, 30, topic, sectionFilter),
        fetchDescribedFigures(supabase, standardId, 5, sectionFilter),
        supabase.from("standards").select("title, standard_code").eq("id", standardId).single(),
      ]);

      if (!chunks?.length) throw new Error("No content found for this standard");

      const allChunks = [...chunks, ...figureChunks];
      const { data: standard } = standardRes;

      const count = questionCount || 5;
      const diff = difficulty || "medium";
      const topicFilter = topic ? `Focus on the topic: ${topic}.` : "";

      const aiResponse = await callAI({
          model: "claude-sonnet-4-6",
          messages: [
            { role: "system", content: `You are an exam question generator for trade apprentices studying ${standard?.title || "industry standards"}. Generate practical, scenario-based multiple-choice questions ONLY from the provided standard content. Never invent facts. Frame questions as real on-site situations — e.g. "You are wiring a bathroom and...", "A customer asks you to install...", "On a job site you find...". Do NOT ask "What does Clause X.X say?" or "According to Clause X.X..." — test understanding and application, not clause memorisation. CRITICAL: Never mention any clause number in the question text. Clause numbers belong only in the explanation field.
Write questions and explanations in plain Australian English. Each explanation must be 1-3 short sentences that tell the apprentice WHY the right answer is right, quoting the key value or rule with units.` },
            { role: "user", content: `Generate ${count} ${diff}-difficulty multiple-choice questions from this standard content. ${topicFilter}\n\nStandard: ${standard?.standard_code || standard?.title}\n\nContent:\n${allChunks.map((c) => `[${c.clause_number || ""}] ${(c.content || "").slice(0, 700)}`).join("\n\n")}` },
          ],
          tools: [{
            type: "function",
            function: {
              name: "return_questions",
              description: "Return generated quiz questions",
              parameters: {
                type: "object",
                properties: {
                  questions: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        question: { type: "string" },
                        options: { type: "array", items: { type: "string" }, minItems: 4, maxItems: 4 },
                        correct_answer: { type: "string" },
                        explanation: { type: "string" },
                        clause_reference: { type: "string" },
                        topic: { type: "string" },
                      },
                      required: ["question", "options", "correct_answer", "explanation", "clause_reference"],
                    },
                  },
                },
                required: ["questions"],
                additionalProperties: false,
              },
            },
          }],
          tool_choice: { type: "function", function: { name: "return_questions" } },
      }, ANTHROPIC_API_KEY, { temperature: 0.1, max_tokens: 3000, usageLogger: { supabaseAdmin: supabase, userId: user.id, kind: "capstone_generate_questions" } });

      if (!aiResponse.ok) return await aiError(aiResponse);

      const aiData = await aiResponse.json();
      const input = getToolInput(aiData);
      if (!input) throw new Error("No questions generated");
      const questions = normaliseQuestions(input.questions);
      if (!questions.length) throw new Error("No valid questions generated. Please try again.");

      const inserts = questions.map((q: any) => ({
        user_id: user.id, standard_id: standardId, question: q.question, options: q.options,
        correct_answer: q.correct_answer, explanation: q.explanation, clause_reference: q.clause_reference,
        difficulty: diff, topic: q.topic || topic || null,
      }));

      const { data: saved, error: saveErr } = await supabase.from("capstone_questions").insert(inserts).select();
      if (saveErr) throw saveErr;
      return new Response(JSON.stringify({ questions: saved }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── ANALYZE PHOTO OF HANDWRITTEN WORK ──
    if (action === "analyze_photo") {
      const chunks = await getChunksWithRecovery(supabase, standardId, authHeader, 50);

      if (!chunks?.length) throw new Error("No content found for this standard");

      const { data: standard } = await supabase.from("standards").select("title, standard_code").eq("id", standardId).single();

      const aiResponse = await callAI({
          model: "claude-sonnet-4-6",
          messages: [
            {
              role: "system",
              content: `You are reviewing handwritten exam work from an Australian electrical apprentice studying ${standard?.standard_code || standard?.title}.

CRITICAL — NEVER GUESS HANDWRITING:
If any word, number, or symbol is not clearly legible, write [unclear] — do NOT guess what it says.
Misreading a number (e.g. reading "2.5" as "25") gives dangerously wrong feedback on a real exam.
Only evaluate content you can clearly and confidently read.

USING YOUR KNOWLEDGE:
You know ${standard?.standard_code || standard?.title} well. Use that knowledge to identify:
- Calculation errors (wrong formula application, arithmetic mistakes)
- Missing steps or omitted safety checks
- Incorrect clause interpretations
Then cite the relevant clause number from the standard content provided. If you identify an error but the specific clause isn't in the provided content, note it and suggest the apprentice verify with their supervisor or the standard itself.

Respond in this exact format:

**What I can read:**
Transcribe the handwritten text word-for-word. Mark anything uncertain as [unclear]. If the image is too blurry, dark, or unclear overall, say so and stop here.

**Feedback:**
Only comment on content you clearly transcribed above — never on [unclear] sections.
Reference specific clause numbers from the standard content provided, or acknowledge if a gap should be checked against the full standard.
Max 4 bullet points. Be direct and honest about what is correct vs what needs work.
${APPRENTICE_STYLE}`,
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `Review this apprentice's handwritten work. Transcribe what you can read first, then give feedback against the standard.\n\nRelevant standard content:\n${chunks.map((c) => `[${c.clause_number || ""}] ${(c.content || "").slice(0, 600)}`).join("\n\n")}`,
                },
                {
                  type: "image_url",
                  image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
                },
              ],
            },
          ],
      }, ANTHROPIC_API_KEY, { temperature: 0.1, max_tokens: 1500, usageLogger: { supabaseAdmin: supabase, userId: user.id, kind: "capstone_analyze_photo" } });

      if (!aiResponse.ok) return await aiError(aiResponse);

      const aiData = await aiResponse.json();
      const analysis = getText(aiData);
      if (!analysis) throw new Error("No analysis generated");
      return new Response(JSON.stringify({ analysis }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── EXPLAIN CHUNK (Standards Explanation) ──
    if (action === "explain_chunk") {
      const { data: chunk } = await supabase
        .from("standard_chunks")
        .select("content, clause_number, clause_title, standard_id")
        .eq("id", chunkId)
        .single();

      if (!chunk) throw new Error("Chunk not found");

      // Check cache first
      const cacheKey = `explain_${chunkId}`;
      const { data: cached } = await supabase
        .from("queries")
        .select("response")
        .eq("question", cacheKey)
        .eq("user_id", user.id)
        .limit(1)
        .single();

      if (cached?.response) {
        return new Response(JSON.stringify({ explanation: cached.response, cached: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const aiResponse = await callAI({
          model: "claude-sonnet-4-6",
          messages: [
            {
              role: "system",
              content: `You are a trade educator explaining standards to apprentices in plain language.
Rules:
- Max 5 bullet points
- Use simple, apprentice-friendly language
- Reference the clause number
- Do NOT give step-by-step instructions
- Explain WHAT the clause means and WHY it matters
${APPRENTICE_STYLE}`,
            },
            {
              role: "user",
              content: `Explain this standard clause in apprentice-friendly language:\n\n[${chunk.clause_number || ""}${chunk.clause_title ? " — " + chunk.clause_title : ""}]\n${chunk.content}`,
            },
          ],
      }, ANTHROPIC_API_KEY, { temperature: 0.1, max_tokens: 1000, usageLogger: { supabaseAdmin: supabase, userId: user.id, kind: "capstone_explain_chunk" } });

      if (!aiResponse.ok) return await aiError(aiResponse);

      const aiData = await aiResponse.json();
      const explanation = getText(aiData);
      if (!explanation) throw new Error("No explanation generated");

      // Cache the result
      const { error: cacheInsertError } = await supabase.from("queries").insert({
        user_id: user.id,
        question: cacheKey,
        response: explanation,
        confidence_score: 1.0,
        safety_flagged: false,
      });
      if (cacheInsertError) {
        console.warn("Failed to cache explanation:", cacheInsertError.message);
      }
      return new Response(JSON.stringify({ explanation, cached: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── START EXAM ──
    if (action === "start_exam") {
      const timeLimit = 30 * 60;
      const count = questionCount || 10;

      let questionQuery = supabase
        .from("capstone_questions").select("*")
        .eq("user_id", user.id).eq("standard_id", standardId).limit(count * 3);
      if (sectionFilter) {
        questionQuery = questionQuery.or(`clause_reference.like.${sectionFilter}.%,clause_reference.like.Clause ${sectionFilter}.%,topic.ilike.Section ${sectionFilter}%`);
      }
      let { data: existingQuestions } = await questionQuery;

      // Auto-generate if not enough questions in the pool
      if (!existingQuestions || existingQuestions.length < count) {
        const limited = await enforceAiRateLimit();
        if (limited) return limited;
        const [chunks, figureChunks, standardRes] = await Promise.all([
          getChunksWithRecovery(supabase, standardId, authHeader, 30, undefined, sectionFilter),
          fetchDescribedFigures(supabase, standardId, 5, sectionFilter),
          supabase.from("standards").select("title, standard_code").eq("id", standardId).single(),
        ]);
        if (!chunks?.length) throw new Error("No content found for this standard. Please ensure it has been fully processed.");
        const allChunks = [...chunks, ...figureChunks];
        const { data: standard } = standardRes;

        const genResponse = await callAI({
          model: "claude-sonnet-4-6",
          messages: [
            { role: "system", content: `You are an exam question generator for trade apprentices studying ${standard?.title || "industry standards"}. Generate practical, scenario-based multiple-choice questions ONLY from the provided standard content. Never invent facts. Frame questions as real on-site situations — e.g. "You are wiring a bathroom and...", "A customer asks you to install...", "On a job site you find...". Do NOT ask "What does Clause X.X say?" — test understanding and application, not clause memorisation. CRITICAL: Never mention any clause number in the question text. Clause numbers belong only in the explanation field.
Write questions and explanations in plain Australian English. Each explanation must be 1-3 short sentences that tell the apprentice WHY the right answer is right, quoting the key value or rule with units.` },
            { role: "user", content: `Generate ${count} medium-difficulty multiple-choice questions from this standard content.\n\nStandard: ${standard?.standard_code || standard?.title}\n\nContent:\n${allChunks.map((c) => `[${c.clause_number || ""}] ${(c.content || "").slice(0, 700)}`).join("\n\n")}` },
          ],
          tools: [{
            type: "function",
            function: {
              name: "return_questions",
              description: "Return generated quiz questions",
              parameters: {
                type: "object",
                properties: {
                  questions: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        question: { type: "string" },
                        options: { type: "array", items: { type: "string" }, minItems: 4, maxItems: 4 },
                        correct_answer: { type: "string" },
                        explanation: { type: "string" },
                        clause_reference: { type: "string" },
                        topic: { type: "string" },
                      },
                      required: ["question", "options", "correct_answer", "explanation", "clause_reference"],
                    },
                  },
                },
                required: ["questions"],
                additionalProperties: false,
              },
            },
          }],
          tool_choice: { type: "function", function: { name: "return_questions" } },
        }, ANTHROPIC_API_KEY, { max_tokens: 3000, usageLogger: { supabaseAdmin: supabase, userId: user.id, kind: "capstone_start_exam" } });

        if (!genResponse.ok) return await aiError(genResponse);
        const genData = await genResponse.json();
        const genInput = getToolInput(genData);
        if (genInput?.questions?.length) {
          genInput.questions = normaliseQuestions(genInput.questions);
        }
        if (genInput?.questions?.length) {
          const inserts = genInput.questions.map((q: any) => ({
            user_id: user.id, standard_id: standardId, question: q.question, options: q.options,
            correct_answer: q.correct_answer, explanation: q.explanation, clause_reference: q.clause_reference,
            difficulty: "medium", topic: q.topic || null,
          }));
          const { data: newQ } = await supabase.from("capstone_questions").insert(inserts).select();
          existingQuestions = [...(existingQuestions || []), ...(newQ || [])];
        }
      }

      if (!existingQuestions?.length) throw new Error("Failed to generate questions. Please try again.");

      const shuffled = shuffle([...existingQuestions]).slice(0, count);

      const { data: exam, error: examErr } = await supabase.from("capstone_exams").insert({
        user_id: user.id, title: "Mock Exam", total_questions: shuffled.length,
        time_limit_seconds: timeLimit, status: "in_progress",
      }).select().single();
      if (examErr) throw examErr;

      return new Response(JSON.stringify({ exam, questions: shuffled }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── START A TIMED MOCK EXAM FROM A SPECIFIC SET OF QUESTIONS ──
    // Used by Exam Prep's "Take as a Timed Mock Exam" — reuses the exact same
    // capstone_exams/timer/resume machinery as start_exam, just seeded from
    // the questions already generated (and already saved to capstone_questions)
    // for that uploaded past paper, instead of a fresh standard-wide pool.
    // No AI call here, so this isn't in AI_ACTIONS / rate-limited.
    if (action === "start_exam_from_questions") {
      const ids: string[] = Array.isArray(questionIds) ? questionIds : [];
      if (!ids.length) throw new Error("No questions provided");

      const { data: ownQuestions, error: qErr } = await supabase
        .from("capstone_questions")
        .select("*")
        .eq("user_id", user.id)
        .in("id", ids);
      if (qErr) throw qErr;
      if (!ownQuestions?.length) throw new Error("Questions not found. Please generate exam prep again.");

      const shuffled = shuffle([...ownQuestions]);

      const { data: exam, error: examErr } = await supabase.from("capstone_exams").insert({
        user_id: user.id, title: "Mock Exam — from your uploaded paper", total_questions: shuffled.length,
        time_limit_seconds: 30 * 60, status: "in_progress",
      }).select().single();
      if (examErr) throw examErr;

      return new Response(JSON.stringify({ exam, questions: shuffled }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── SUBMIT ANSWER ──
    if (action === "submit_answer") {
      const { data: question } = await supabase
        .from("capstone_questions").select("correct_answer, explanation, clause_reference")
        .eq("id", questionId).single();
      if (!question) throw new Error("Question not found");

      // FIX 4 — verify the exam belongs to the current user
      const { data: exam } = await supabase
        .from("capstone_exams").select("user_id")
        .eq("id", examId).single();
      if (!exam || exam.user_id !== user.id) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const isCorrect = userAnswer === question.correct_answer;

      // Idempotent via the (exam_id, question_id) unique constraint — a
      // double-tap updates the existing answer instead of inserting a
      // duplicate that would inflate the exam total and skew the score.
      await supabase
        .from("capstone_exam_answers")
        .upsert(
          { exam_id: examId, question_id: questionId, user_answer: userAnswer, is_correct: isCorrect },
          { onConflict: "exam_id,question_id" },
        );

      return new Response(JSON.stringify({ is_correct: isCorrect, correct_answer: question.correct_answer, explanation: question.explanation, clause_reference: question.clause_reference }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── COMPLETE EXAM ──
    if (action === "complete_exam") {
      const { data: answers } = await supabase.from("capstone_exam_answers").select("is_correct, question_id").eq("exam_id", examId);
      const correct = answers?.filter((a) => a.is_correct).length || 0;
      const total = answers?.length || 0;

      // FIX 5 — ownership check + prevent double-completion
      await supabase.from("capstone_exams").update({
        status: "completed", correct_answers: correct, total_questions: total, completed_at: new Date().toISOString(),
      }).eq("id", examId).eq("user_id", user.id).eq("status", "in_progress");

      const percentage = total > 0 ? Math.round((correct / total) * 100) : 0;
      return new Response(JSON.stringify({ correct, total, percentage, passed: percentage >= 70 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── GENERATE STUDY GUIDE ──
    if (action === "generate_study_guide") {
      const chunks = await getChunksWithRecovery(supabase, standardId, authHeader, 40, topic, sectionFilter);
      if (!chunks?.length) throw new Error("No content found for this section");

      // Include described figure diagrams so study guide can reference them
      const figureChunks = await fetchDescribedFigures(supabase, standardId, 8, sectionFilter);
      const allChunks = [...chunks, ...figureChunks];

      const { data: standard } = await supabase.from("standards").select("title, standard_code").eq("id", standardId).single();

      const sectionLabel = sectionFilter ? ` — Section ${sectionFilter}` : "";
      const focusNote = sectionFilter
        ? `Focus ONLY on Section ${sectionFilter} content provided below.`
        : topic ? `Focus on: ${topic}` : "";
      const figureNote = figureChunks.length > 0
        ? " Where relevant, reference the figures by number (e.g. 'Refer to Figure 8.1') and summarise what they show."
        : "";

      const aiResponse = await callAI({
          model: "claude-sonnet-4-6",
          messages: [
            { role: "system", content: `You are an expert trade educator. Create concise, apprentice-friendly study guides from standard content. Only use information from the provided content.${figureNote}
Structure the guide so it's easy to revise from: start with a 2-3 sentence "What this covers" intro, then short sections with a heading each, then finish with a "Key things to remember" bullet list of the must-know values and rules.
${APPRENTICE_STYLE}` },
            { role: "user", content: `Create a comprehensive study guide for apprentices from this standard. ${focusNote}\n\nStandard: ${standard?.standard_code || standard?.title}${sectionLabel}\n\nContent:\n${allChunks.map((c) => `[${c.clause_number || ""}${c.clause_title ? " - " + c.clause_title : ""}] ${(c.content || "").slice(0, 700)}`).join("\n\n")}` },
          ],
      }, ANTHROPIC_API_KEY, { temperature: 0.1, max_tokens: 3000, usageLogger: { supabaseAdmin: supabase, userId: user.id, kind: "capstone_study_guide" } });

      if (!aiResponse.ok) return await aiError(aiResponse);

      const aiData = await aiResponse.json();
      const content = getText(aiData);
      if (!content) throw new Error("No guide generated");

      const guideTitle = sectionFilter
        ? `${standard?.standard_code || standard?.title} — Section ${sectionFilter}`
        : `${standard?.standard_code || standard?.title} — Study Guide`;

      const { data: guide, error: guideErr } = await supabase.from("capstone_study_guides").insert({
        user_id: user.id, standard_id: standardId,
        title: guideTitle,
        content, topics: topic ? [topic] : sectionFilter ? [`Section ${sectionFilter}`] : [],
      }).select().single();
      if (guideErr) throw guideErr;
      return new Response(JSON.stringify({ guide }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── EXAM PREP: Generate from uploaded exam or listed topics ──
    if (action === "exam_prep") {
      // examPdfText arrives as [PAGE N]-marked text from the client's PDF.js
      // extraction. Strip the markers and check real page coverage rather than
      // raw length — a failed extraction can still produce a >100-char string
      // (e.g. an error note) that says nothing about the actual exam.
      let pdfText = "";
      if (examPdfText && examPdfText.trim().length > 0) {
        const parsed = parseExtractedText(examPdfText);
        if (parsed.pagesWithContent === 0) {
          return new Response(JSON.stringify({
            error: "We couldn't read this PDF — try a clearer digital copy or a different scan.",
          }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        pdfText = parsed.text;
      }

      // FIX 3 — require meaningful grounding input
      const hasStandard = !!standardId;
      const hasTopics = examTopics && examTopics.trim().length > 0;
      const hasPdfText = pdfText.trim().length >= 100;
      if (!hasStandard && !hasTopics && !hasPdfText) {
        return new Response(JSON.stringify({
          error: "Please select a standard or provide exam topics before generating prep materials.",
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      let contextParts: string[] = [];

      if (pdfText.trim().length > 0) {
        contextParts.push(`PREVIOUS EXAM CONTENT:\n${pdfText.slice(0, 15000)}`);
      }

      if (examTopics && examTopics.trim().length > 0) {
        contextParts.push(`EXAM TOPICS/AREAS IDENTIFIED BY THE STUDENT:\n${examTopics}`);
      }

      if (!contextParts.length && !standardId) throw new Error("Please provide exam content or topics");

      let standardContext = "";
      let standardTitle = "General Trade Knowledge";
      if (standardId) {
        // Independent lookups — run concurrently rather than stacking two
        // sequential round trips before the (already slow) AI call starts.
        const [chunks, standardRes] = await Promise.all([
          getChunksWithRecovery(supabase, standardId, authHeader, 40),
          supabase.from("standards").select("title, standard_code").eq("id", standardId).single(),
        ]);
        if (chunks.length > 0) {
          // FIX 7 — cap standard context to prevent prompt overflow
          const rawContext = chunks.map((c) => `[${c.clause_number || ""}${c.clause_title ? " - " + c.clause_title : ""}] ${c.content}`).join("\n\n");
          const cappedContext = rawContext.slice(0, 10000);
          standardContext = `\n\nRELEVANT STANDARD CONTENT:\n${cappedContext}`;
        }
        const { data: standard } = standardRes;
        if (standard) standardTitle = standard.standard_code || standard.title;
      }

      const fullContext = contextParts.join("\n\n") + standardContext;

      const aiResponse = await callAI({
          model: "claude-sonnet-4-6",
          messages: [
            {
              role: "system",
              content: `You are an expert trade educator helping an apprentice prepare for an exam on "${standardTitle}". 
The student has provided either a previous exam paper, a list of expected exam topics, or both.
Your job:
1. Analyze the exam content/topics to identify the key areas being tested
2. Generate a focused study guide covering those areas — one short heading per topic, then bullet points underneath it for the facts/rules/formulas of that topic, finishing each topic with a one-line clause reference. Do NOT write the topic as a paragraph of flowing sentences.
3. Generate 10 practice questions in the style of the exam

Rules:
- If a previous exam is provided, match the question style and difficulty
- Ground all content in the standard where possible, referencing clause numbers
- Be apprentice-friendly: clear language, practical examples
- Focus ONLY on the topics/areas identified
- Keep each question explanation to 1-3 short sentences an apprentice can follow
${APPRENTICE_STYLE}`,
            },
            {
              role: "user",
              content: `Help me prepare for my upcoming exam. Here's what I know about it:\n\n${fullContext}`,
            },
          ],
          tools: [{
            type: "function",
            function: {
              name: "return_exam_prep",
              description: "Return exam prep materials",
              parameters: {
                type: "object",
                properties: {
                  identified_topics: { type: "array", items: { type: "string" }, description: "Key topics identified" },
                  study_guide: { type: "string", description: "Markdown study guide" },
                  questions: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        question: { type: "string" },
                        options: { type: "array", items: { type: "string" }, minItems: 4, maxItems: 4 },
                        correct_answer: { type: "string" },
                        explanation: { type: "string" },
                        clause_reference: { type: "string" },
                        topic: { type: "string" },
                      },
                      required: ["question", "options", "correct_answer", "explanation", "clause_reference", "topic"],
                    },
                  },
                },
                required: ["identified_topics", "study_guide", "questions"],
                additionalProperties: false,
              },
            },
          }],
          tool_choice: { type: "function", function: { name: "return_exam_prep" } },
      }, ANTHROPIC_API_KEY, { temperature: 0.1, max_tokens: 4000, usageLogger: { supabaseAdmin: supabase, userId: user.id, kind: "capstone_exam_prep" } });

      if (!aiResponse.ok) return await aiError(aiResponse);

      const aiData = await aiResponse.json();
      const result = getToolInput(aiData);
      if (!result) throw new Error("No exam prep generated");
      result.questions = normaliseQuestions(result.questions);

      const { data: guide } = await supabase.from("capstone_study_guides").insert({
        user_id: user.id, standard_id: standardId || null,
        title: `Exam Prep — ${result.identified_topics.slice(0, 3).join(", ")}`,
        content: result.study_guide, topics: result.identified_topics,
      }).select().single();

      const qInserts = result.questions.map((q: any) => ({
        user_id: user.id, standard_id: standardId || null, question: q.question, options: q.options,
        correct_answer: q.correct_answer, explanation: q.explanation, clause_reference: q.clause_reference,
        difficulty: "medium", topic: q.topic || null,
      }));
      const { data: savedQuestions } = await supabase.from("capstone_questions").insert(qInserts).select();

      return new Response(JSON.stringify({ topics: result.identified_topics, guide, questions: savedQuestions }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── GENERATE CALCULATION QUESTION (Section C style) ──
    if (action === "generate_calculation") {
      const { data: standard } = await supabase.from("standards").select("title, standard_code").eq("id", standardId).single();
      const trade: TradeType = detectTrade("", standard?.standard_code || standard?.title || null);
      const isElectrical = trade === "electrical";
      const tradeConfig = CALC_TRADE_CONFIG[trade];

      // Independent lookups — run concurrently instead of stacking sequential
      // round trips before the AI call even starts.
      const [primaryChunks, candidates3008Res] = await Promise.all([
        // Fetch calculation-relevant chunks from the selected standard, biased
        // towards this trade's typical calculation topics.
        getChunksWithRecovery(supabase, standardId, authHeader, 25, tradeConfig.topic, sectionFilter),
        // Electrical only: auto-detect AS/NZS 3008 in the user's library for
        // cable data — prefer the user's own most recent 3008 over org-shared
        // copies so the source is deterministic when several are visible.
        // Other trades' sizing tables live in their own selected standard
        // (already covered by primaryChunks above), so skip this lookup.
        isElectrical
          ? supabase
              .from("standards")
              .select("id, user_id")
              .or("standard_code.ilike.%3008%,title.ilike.%3008%")
              .order("created_at", { ascending: false })
              .limit(10)
          : Promise.resolve({ data: null } as { data: { id: string; user_id: string }[] | null }),
      ]);
      const candidates3008 = candidates3008Res.data;
      const as3008 = candidates3008?.find((s) => s.user_id === user.id) || candidates3008?.[0] || null;

      let cableChunks: StandardChunk[] = [];
      if (isElectrical && as3008?.id) {
        cableChunks = await fetchStandardChunks(supabase, as3008.id, 25);
      }

      const fallbackCableData = `Standard cable data (AS/NZS 3008, TPS clipped single circuit at 40°C):
2.5mm²: mV/A.m=14.7, Iz=20A | 4mm²: 9.22, 27A | 6mm²: 6.19, 34A | 10mm²: 3.84, 46A
16mm²: 2.40, 61A | 25mm²: 1.54, 80A | 35mm²: 1.11, 96A | 50mm²: 0.786, 117A
70mm²: 0.571, 143A | 95mm²: 0.422, 174A | 120mm²: 0.336, 200A
Voltage drop limit: 5% of supply voltage (AS/NZS 3000 Clause 3.6)`;

      const primaryLabel = isElectrical ? "AS/NZS 3000 CONTENT" : `${standard?.standard_code || standard?.title || "STANDARD"} CONTENT`;
      const contextParts = [
        primaryChunks.length > 0 ? `${primaryLabel}:\n${primaryChunks.map((c) => `[${c.clause_number || ""}] ${(c.content || "").slice(0, 600)}`).join("\n\n")}` : "",
      ];
      // Only electrical gets the AS/NZS 3008 cable-data block (or its fallback)
      // — other trades must never be handed electrical cable figures.
      if (isElectrical) {
        contextParts.push(cableChunks.length > 0 ? `AS/NZS 3008 CABLE DATA:\n${cableChunks.map((c) => `[${c.clause_number || ""}] ${(c.content || "").slice(0, 600)}`).join("\n\n")}` : fallbackCableData);
      }
      const context = contextParts.filter(Boolean).join("\n\n---\n\n");

      const formulaOrGroundingBlock = isElectrical
        ? `Key formulas:
- Voltage drop: VD(V) = I × mV/A·m × L / 1000; VD% = (VD / V_supply) × 100
- Single-phase V_supply = 230V; three-phase V_supply = 230V phase (use 400V only for line voltage)
- Maximum demand: total load groups × demand factors from AS/NZS 3000
- Cable sizing: Iz (derated) ≥ load current, In ≤ Iz
- Fault loop: Zs = Ze + (R1+R2); If = Vc / Zs. Never stop at the calculated Zs alone — a fault-loop answer is only complete once it's checked against the standard's limit, the same way a voltage-drop answer is checked against 5%.

Question types (pick one):
1. voltage_drop — given cable, current, length → calculate VD% and state compliance
2. maximum_demand — given load schedule → calculate maximum demand per phase
3. cable_sizing — given load, installation conditions → select minimum cable size
4. fault_current — given supply impedance, cable data → calculate the actual Zs (and If), look up the maximum permissible Zs for the stated protective device and disconnection time (AS/NZS 3000 Table 8.1 for circuit breakers, Table 8.2 for fuses — treat this as a standard table value per the given_data rule below, never state it up front), then state both figures side by side and conclude compliant/non-compliant`
        : `Do not use any formula, table value, or standard reference from your own general knowledge — never guess a value. Every formula, lookup value, and clause/table reference in given_data, model_solution and key_answers must come directly from the STANDARD CONTENT provided below, quoting the real clause/table numbers exactly as they appear in it. If the provided content doesn't contain enough information to build a genuine, correctly-sourced calculation, pick a simpler calculation that the content does support rather than guessing.

Typical calculation topics for this trade: ${tradeConfig.hint}.
Pick a calculation_type slug that matches what this specific question actually tests (short, snake_case, e.g. pipe_sizing, duct_sizing, load_calculation) — don't force it into an electrical category.`;

      const aiResponse = await callAI({
        model: "claude-sonnet-4-6",
        messages: [
          {
            role: "system",
            content: `You generate Section C calculation questions for Australian TAFE ${TRADE_LABEL[trade]} capstone exams. Create one realistic, practical calculation scenario.

${formulaOrGroundingBlock}

Use realistic Australian values.

scenario field: 1-2 short, natural sentences setting the job-site scene — who's doing the job, where, and what they're installing. Write it like you're telling a mate what the job is, not a spec sheet. Do NOT list exact figures (currents, lengths, temperatures, cable types, table/column references) in the scenario — every number and technical detail belongs in given_data instead, so nothing is repeated between the two.

given_data field — split into two kinds of line, and never blur them together:
1. Job parameters (give the actual value): the inputs that describe the job — e.g. supply voltage, load/design current, breaker rating, cable/pipe/duct type, installation method, ambient temperature, grouping, route length. State them plainly, e.g. "Design current: 28 A".
2. Standard table values (current-carrying capacity, derating factors, mV/A·m voltage-drop figures, or this trade's equivalent sizing/capacity figures) — this is a lookup exercise, so NEVER state the actual number. Instead point the apprentice at exactly where to find it, using the real table/column numbers from the standard content provided (never invent one), e.g. "Current-carrying capacity: look up AS/NZS 3008.1.1 Table 13, Column 4". Do not add the resulting value in brackets afterwards.

model_solution and key_answers must still use the real table values from the standard content, worked through step by step, so grading is accurate — the apprentice just isn't handed those values up front, they have to look them up like in a real exam.
The model_solution must be numbered steps an apprentice can follow along with on paper: state the formula first, then substitute the numbers, then the result — one line each, always with units — and end with a plain-English sentence stating the final answer and whether it complies.
${APPRENTICE_STYLE}`,
          },
          {
            role: "user",
            content: `Generate one Section C calculation question. Use this standard content where possible:\n\n${context}`,
          },
        ],
        tools: [{
          type: "function",
          function: {
            name: "return_calculation",
            description: "Return a calculation question",
            parameters: {
              type: "object",
              properties: {
                calculation_type: { type: "string", description: "Short snake_case label for what this calculation tests, matched to this specific question, e.g. voltage_drop, pipe_sizing, duct_sizing, load_calculation." },
                scenario: { type: "string" },
                given_data: { type: "array", items: { type: "string" } },
                question_parts: { type: "array", items: { type: "string" } },
                model_solution: { type: "string", description: "Full step-by-step worked solution" },
                total_marks: { type: "number" },
                key_answers: { type: "array", items: { type: "string" }, description: "Final answers for each part" },
              },
              required: ["calculation_type", "scenario", "given_data", "question_parts", "model_solution", "total_marks", "key_answers"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "return_calculation" } },
      }, ANTHROPIC_API_KEY, { temperature: 0.1, max_tokens: 2000, usageLogger: { supabaseAdmin: supabase, userId: user.id, kind: "capstone_generate_calculation" } });

      if (!aiResponse.ok) return await aiError(aiResponse);
      const aiData = await aiResponse.json();
      const question = getToolInput(aiData);
      if (!question) throw new Error("No calculation generated");

      // The question often tells the apprentice to "use Table 42" etc, but
      // that table only exists inside the AS/NZS 3008 PDF — with no link,
      // the apprentice has no way to actually look it up. Pull page numbers
      // for any table mentioned so the client can open the PDF straight to it.
      let tableReferences: { table_number: string; standard_id: string; page_number: number; caption: string | null }[] = [];
      const tableSearchStandardIds = [standardId, as3008?.id].filter(Boolean) as string[];
      if (tableSearchStandardIds.length > 0) {
        const mentionedText = [question.scenario, ...(question.given_data || []), ...(question.question_parts || [])].join("\n");
        const tableNumbers = [...new Set([...mentionedText.matchAll(/\bTable\s+([A-Z]?\d+(?:\.\d+)*)\b/gi)].map((m) => m[1]))];
        if (tableNumbers.length > 0) {
          const { data: tableRows } = await supabase
            .from("standard_tables")
            .select("table_number, standard_id, page_number, caption")
            .in("standard_id", tableSearchStandardIds)
            .in("table_number", tableNumbers);
          if (tableRows) tableReferences = tableRows;
        }
      }

      // Persist so grade_calculation marks against the server's copy of the
      // question and model solution, not client-supplied grading data.
      const { data: saved, error: saveErr } = await supabase
        .from("capstone_practice_questions")
        .insert({ user_id: user.id, standard_id: standardId, kind: "calculation", payload: { ...question, table_references: tableReferences } })
        .select("id").single();
      if (saveErr) throw saveErr;
      return new Response(JSON.stringify({ question: { ...question, table_references: tableReferences, id: saved.id } }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── GRADE CALCULATION ──
    if (action === "grade_calculation") {
      if (!practiceQuestionId) throw new Error("Missing grading data");
      const { data: stored, error: storedErr } = await supabase
        .from("capstone_practice_questions")
        .select("payload")
        .eq("id", practiceQuestionId).eq("kind", "calculation")
        .single();
      if (storedErr || !stored) throw new Error("Question not found. Please generate a new one.");
      const q = stored.payload as { scenario: string; given_data: string[]; question_parts: string[]; model_solution: string; total_marks: number };
      const questionText = `${q.scenario}\n\nGiven:\n${(q.given_data || []).join("\n")}\n\nQuestions:\n${(q.question_parts || []).join("\n")}`;

      const aiResponse = await callAI({
        model: "claude-sonnet-4-6",
        messages: [
          {
            role: "system",
            content: `You are marking a Section C calculation from an Australian trade capstone exam.
Award method marks if the correct formula and approach is used, even with minor arithmetic errors.
Award answer marks only for the correct final value(s).
Feedback rules: 2-4 short sentences in plain Australian English, written directly to the apprentice ("you"). Say specifically what they got right, then exactly where their working went wrong (name the step and the correct value with units). Encouraging but honest — never vague praise.`,
          },
          {
            role: "user",
            content: `Scenario + question:\n${questionText}\n\nModel solution:\n${q.model_solution}\n\nTotal marks: ${q.total_marks || 4}\n\nStudent's working:\n${(userAnswer || "(nothing submitted)").slice(0, 4000)}\n\nGrade this.`,
          },
        ],
        tools: [{
          type: "function",
          function: {
            name: "return_grade",
            description: "Return the grade for a calculation question",
            parameters: {
              type: "object",
              properties: {
                marks_awarded: { type: "number" },
                correct_method: { type: "boolean" },
                correct_answer: { type: "boolean" },
                feedback: { type: "string" },
              },
              required: ["marks_awarded", "correct_method", "correct_answer", "feedback"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "return_grade" } },
      }, ANTHROPIC_API_KEY, { temperature: 0.1, max_tokens: 1000, usageLogger: { supabaseAdmin: supabase, userId: user.id, kind: "capstone_grade_calculation" } });

      if (!aiResponse.ok) return await aiError(aiResponse);
      const aiData = await aiResponse.json();
      const grade = getToolInput(aiData);
      if (!grade) throw new Error("Grading failed");
      return new Response(JSON.stringify(grade), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── SCENARIO WALKTHROUGH ──
    // Reverse of every other Learn mode: the apprentice supplies a real job
    // situation instead of answering an AI-generated question. Not graded —
    // this is a mentoring breakdown, not an exam, so nothing is persisted.
    if (action === "scenario_walkthrough") {
      // Semantic search across the whole standard: a scenario can touch
      // several regulatory topics (isolation, earthing, RCD protection,
      // testing) that the apprentice's own wording rarely names explicitly
      // ("RCD" never appears just because they're wiring a hotplate), so
      // keyword-overlap retrieval misses real clauses too often. Also pulls
      // a few close matches from the apprentice's OTHER uploaded standards,
      // so a gap in the selected standard can be pointed at the right one
      // instead of a flat "not covered".
      const { primaryChunks: chunks, otherChunks } = await fetchScenarioContext(
        supabase, standardId, scenarioText, OPENAI_API_KEY, 80, user.id, sectionFilter
      );
      if (!chunks?.length) throw new Error("No content found for this standard");

      const { data: standard } = await supabase.from("standards").select("title, standard_code").eq("id", standardId).single();
      const primaryLabel = standard?.standard_code || standard?.title || "the standard";
      const trade: TradeType = detectTrade("", standard?.standard_code || standard?.title || null);

      const otherStandardsBlock = otherChunks.length > 0
        ? `\n\nOTHER STANDARDS THIS APPRENTICE HAS UPLOADED (for reference only — they are not currently studying these, so never use them as the source for a decision point that ${primaryLabel} already covers; only mention one if it fills a genuine gap in ${primaryLabel}):\n${otherChunks.map((c) => `[${c.standard_code} ${c.clause_number || ""}] ${(c.content || "").slice(0, 400)}`).join("\n\n")}`
        : "";

      const aiResponse = await callAI({
        model: "claude-sonnet-4-6",
        messages: [
          {
            role: "system",
            content: `You are an on-site mentor helping a ${TRADE_LABEL[trade]} apprentice think through a real job situation they've described, using ${primaryLabel}.

Break the scenario down into decision points. At each point, explain the correct approach and reference the relevant standard. Identify any safety considerations that apply. Walk through the testing or verification steps that would apply after the work is complete. Note any certificates or notifications required.

If the scenario involves something an apprentice should NOT be doing unsupervised (live work, mains work, isolating a switchboard alone, etc.), say so clearly in supervision_warning and explain why — leave supervision_warning as an empty string otherwise.

USING YOUR KNOWLEDGE:
You know ${primaryLabel} well. Use that knowledge to identify all the safety-critical requirements and decision points for this scenario — including ones the apprentice didn't explicitly mention (e.g. isolation switches for a new installation, earthing and bonding checks, testing sequences). Then cite the relevant clause numbers from the STANDARD CONTENT provided below.

For each decision point:
- If you find the relevant clause in STANDARD CONTENT: cite that clause number exactly in standard_reference, leave source_standard empty.
- Else if you find it in the OTHER STANDARDS: cite that clause and set source_standard to that standard's name.
- Else (you know it applies but it's not in any provided content): leave standard_reference empty, mark source_standard as empty, and note in correct_approach that the apprentice should verify this with their supervisor or the full standard.
Never invent or guess clause numbers — only cite ones that literally appear in the provided content.

This app also has built-in calculators. If — and only if — a decision point is something one of these calculators actually solves (e.g. picking a cable size, checking voltage drop, sizing a conduit), set suggested_tool to that tool's exact id from this list; otherwise leave it as an empty string. Never invent an id that isn't in this list:
${TOOL_CATALOG.map((t) => `- ${t.id}: ${t.title} — ${t.hint}`).join("\n")}
${APPRENTICE_STYLE}`,
          },
          {
            role: "user",
            content: `Apprentice's scenario:\n${scenarioText}\n\nSTANDARD CONTENT (${primaryLabel}):\n${chunks.map((c) => `[${c.clause_number || ""}${c.clause_title ? " — " + c.clause_title : ""}] ${(c.content || "").slice(0, 700)}`).join("\n\n")}${otherStandardsBlock}`,
          },
        ],
        tools: [{
          type: "function",
          function: {
            name: "return_walkthrough",
            description: "Return a scenario walkthrough",
            parameters: {
              type: "object",
              properties: {
                decision_points: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      situation: { type: "string", description: "The specific decision or step being addressed" },
                      correct_approach: { type: "string" },
                      standard_reference: { type: "string", description: "Real clause number quoted from the content provided, e.g. '5.3.2.1' — empty string if nothing provided covers this point" },
                      source_standard: { type: "string", description: "Empty if standard_reference is from the primary standard being studied; otherwise the name of the OTHER uploaded standard it came from" },
                      suggested_tool: { type: "string", description: "One of the exact tool ids provided if a built-in calculator solves this decision point, else empty string" },
                    },
                    required: ["situation", "correct_approach", "standard_reference", "source_standard", "suggested_tool"],
                  },
                },
                safety_considerations: { type: "array", items: { type: "string" } },
                testing_steps: { type: "array", items: { type: "string" } },
                certs_required: { type: "array", items: { type: "string" } },
                supervision_warning: { type: "string", description: "Non-empty only if this scenario involves unsupervised work an apprentice shouldn't be doing alone; empty string otherwise" },
              },
              required: ["decision_points", "safety_considerations", "testing_steps", "certs_required", "supervision_warning"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "return_walkthrough" } },
      }, ANTHROPIC_API_KEY, { temperature: 0.1, max_tokens: 2000, usageLogger: { supabaseAdmin: supabase, userId: user.id, kind: "capstone_scenario_walkthrough" } });

      if (!aiResponse.ok) return await aiError(aiResponse);
      const aiData = await aiResponse.json();
      const input = getToolInput(aiData);
      if (!input) throw new Error("No walkthrough generated");

      // Never trust an AI-produced id as a navigation target — clamp to the
      // real catalog and attach the display title server-side so the
      // frontend doesn't need its own copy of tool names to stay in sync.
      const toolById = new Map(TOOL_CATALOG.map((t) => [t.id, t.title]));
      input.decision_points = (input.decision_points || []).map((dp: any) => {
        const title = toolById.get(dp.suggested_tool);
        return title
          ? { ...dp, suggested_tool: dp.suggested_tool, suggested_tool_label: title }
          : { ...dp, suggested_tool: "", suggested_tool_label: "" };
      });

      return new Response(JSON.stringify(input), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── GENERATE SHORT ANSWER QUESTIONS (Section B style) ──
    if (action === "generate_short_answer") {
      const [chunks, figureChunks, standardRes] = await Promise.all([
        getChunksWithRecovery(supabase, standardId, authHeader, 40, topic, sectionFilter),
        fetchDescribedFigures(supabase, standardId, 5, sectionFilter),
        supabase.from("standards").select("title, standard_code").eq("id", standardId).single(),
      ]);
      if (!chunks?.length) throw new Error("No content found for this standard");

      const allChunks = [...chunks, ...figureChunks];
      const { data: standard } = standardRes;
      const count = questionCount || 5;

      const aiResponse = await callAI({
        model: "claude-sonnet-4-6",
        messages: [
          {
            role: "system",
            content: `You are an exam question generator for electrical apprentices studying ${standard?.standard_code || standard?.title}. Generate Section B style short-answer questions exactly like a TAFE capstone exam.
Each question MUST:
- Be answerable in 1–3 sentences from the standard content provided
- Have a specific, verifiable correct answer
- Be worth 2 marks (correct answer + correct clause reference)
Good examples: "What are the three major risks identified in AS/NZS 3000?", "What is the function of the MEN link?", "What are the minimum requirements for aluminium earthing conductors?"
Do NOT generate calculation questions, diagram questions, or questions that cannot be answered from the text.
CRITICAL: Never mention any clause number in the question text itself. Clause numbers belong only in the clause_reference field, not the question.`,
          },
          {
            role: "user",
            content: `Generate ${count} short-answer exam questions from this standard content.${sectionFilter ? ` Focus on Section ${sectionFilter}.` : ""}\n\nStandard: ${standard?.standard_code || standard?.title}\n\nContent:\n${allChunks.map((c) => `[${c.clause_number || ""}${c.clause_title ? " — " + c.clause_title : ""}] ${(c.content || "").slice(0, 700)}`).join("\n\n")}`,
          },
        ],
        tools: [{
          type: "function",
          function: {
            name: "return_questions",
            description: "Return short answer questions",
            parameters: {
              type: "object",
              properties: {
                questions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      question: { type: "string" },
                      model_answer: { type: "string", description: "Correct answer in 1–3 sentences" },
                      clause_reference: { type: "string", description: "Specific clause number e.g. '5.3.2.1'" },
                    },
                    required: ["question", "model_answer", "clause_reference"],
                  },
                },
              },
              required: ["questions"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "return_questions" } },
      }, ANTHROPIC_API_KEY, { temperature: 0.1, max_tokens: 3000, usageLogger: { supabaseAdmin: supabase, userId: user.id, kind: "capstone_generate_short_answer" } });

      if (!aiResponse.ok) return await aiError(aiResponse);

      const aiData = await aiResponse.json();
      const input = getToolInput(aiData);
      if (!input) throw new Error("No questions generated");
      const { questions } = input;
      // Persist so grade_short_answer marks against the server's copy of the
      // model answer and clause reference, not client-supplied grading data.
      const { data: savedRows, error: saveErr } = await supabase
        .from("capstone_practice_questions")
        .insert(questions.map((q: any) => ({ user_id: user.id, standard_id: standardId, kind: "short_answer", payload: q })))
        .select("id, payload");
      if (saveErr) throw saveErr;
      return new Response(JSON.stringify({ questions: (savedRows || []).map((row: any) => ({ ...row.payload, id: row.id, marks: 2 })) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── GRADE SHORT ANSWER ──
    if (action === "grade_short_answer") {
      if (!practiceQuestionId) throw new Error("Missing grading data");
      const { data: stored, error: storedErr } = await supabase
        .from("capstone_practice_questions")
        .select("payload")
        .eq("id", practiceQuestionId).eq("kind", "short_answer")
        .single();
      if (storedErr || !stored) throw new Error("Question not found. Please generate a new one.");
      const q = stored.payload as { question: string; model_answer: string; clause_reference: string };

      const aiResponse = await callAI({
        model: "claude-sonnet-4-6",
        messages: [
          {
            role: "system",
            content: `You are marking a TAFE electrical capstone exam (Section B). Marking rules:
- Award 2 marks: answer is substantially correct AND clause reference matches the correct clause
- Award 1 mark: answer is correct but clause reference is wrong or missing
- Award 0 marks: answer is wrong or insufficient
Be strict but fair. Accept minor wording differences if the meaning is correct.
Feedback rules: 1-3 short sentences in plain Australian English, written directly to the apprentice ("you"). State what was right, what was missing or wrong, and the correct clause number. No jargon without a quick explanation.`,
          },
          {
            role: "user",
            content: `Question: ${q.question}\n\nModel answer: ${q.model_answer}\nCorrect clause: ${q.clause_reference}\n\nStudent's answer: ${(userAnswer || "(no answer provided)").slice(0, 4000)}\nStudent's clause reference: ${(userClauseRef || "(none provided)").slice(0, 100)}\n\nGrade this response.`,
          },
        ],
        tools: [{
          type: "function",
          function: {
            name: "return_grade",
            description: "Return the grade and feedback",
            parameters: {
              type: "object",
              properties: {
                marks_awarded: { type: "number", description: "0, 1, or 2" },
                answer_correct: { type: "boolean" },
                clause_correct: { type: "boolean" },
                feedback: { type: "string", description: "Brief feedback (1–2 sentences) on what was right/wrong" },
              },
              required: ["marks_awarded", "answer_correct", "clause_correct", "feedback"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "return_grade" } },
      }, ANTHROPIC_API_KEY, { temperature: 0.1, max_tokens: 1000, usageLogger: { supabaseAdmin: supabase, userId: user.id, kind: "capstone_grade_short_answer" } });

      if (!aiResponse.ok) return await aiError(aiResponse);

      const aiData = await aiResponse.json();
      const result = getToolInput(aiData);
      if (!result) throw new Error("Grading failed");

      return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (e) {
    console.error("capstone error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
