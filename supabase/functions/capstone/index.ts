import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAllowedOrigin } from "../_shared/cors.ts";

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
  options: { temperature?: number; max_tokens?: number } = {},
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
  }
  return res;
}

serve(async (req) => {
  const origin = req.headers.get("Origin") || "";
  const corsHeaders = {
    "Access-Control-Allow-Origin": getAllowedOrigin(origin),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing auth");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");

    const { action, standardId, topic, difficulty, questionCount, examId, questionId, userAnswer, imageBase64, chunkId, examTopics, examPdfText, sectionFilter, userClauseRef, modelAnswer, correctClause, questionText } = await req.json();
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");

    const aiError = async (res: Response): Promise<Response> => {
      const body = await res.json().catch(() => null);
      const msg = body?.error?.message || body?.error || `AI error (${res.status})`;
      console.error(`[capstone] AI error ${res.status}: ${JSON.stringify(body)}`);
      if (res.status === 429) return new Response(JSON.stringify({ error: `Rate limited: ${msg}` }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (res.status === 402) return new Response(JSON.stringify({ error: `AI credits exhausted: ${msg}` }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ error: `AI error: ${msg}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    };

    // ── RATE LIMIT: 20 AI calls per hour per user (applies to AI actions only) ──
    const AI_ACTIONS = ["generate_questions", "analyze_photo", "explain_chunk", "generate_study_guide", "generate_short_answer", "generate_calculation", "grade_calculation", "grade_short_answer", "exam_prep"];
    if (AI_ACTIONS.includes(action)) {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count: usageCount } = await supabase
        .from("capstone_usage")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .gte("created_at", oneHourAgo);

      if ((usageCount || 0) >= 20) {
        return new Response(JSON.stringify({
          error: "Hourly limit reached. You can make 20 AI requests per hour. Please try again later.",
        }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // ── GENERATE QUIZ QUESTIONS ──
    if (action === "generate_questions") {
      const chunks = await getChunksWithRecovery(supabase, standardId, authHeader, 30, topic, sectionFilter);

      if (!chunks?.length) throw new Error("No content found for this standard");

      // Append any described figure chunks so AI can reference diagrams in explanations
      const figureChunks = await fetchDescribedFigures(supabase, standardId, 5, sectionFilter);
      const allChunks = [...chunks, ...figureChunks];

      const { data: standard } = await supabase.from("standards").select("title, standard_code").eq("id", standardId).single();

      const count = questionCount || 5;
      const diff = difficulty || "medium";
      const topicFilter = topic ? `Focus on the topic: ${topic}.` : "";

      const aiResponse = await callAI({
          model: "claude-opus-4-8",
          messages: [
            { role: "system", content: `You are an exam question generator for trade apprentices studying ${standard?.title || "industry standards"}. Generate practical, scenario-based multiple-choice questions ONLY from the provided standard content. Never invent facts. Frame questions as real on-site situations — e.g. "You are wiring a bathroom and...", "A customer asks you to install...", "On a job site you find...". Do NOT ask "What does Clause X.X say?" or "According to Clause X.X..." — test understanding and application, not clause memorisation. CRITICAL: Never mention any clause number in the question text. Clause numbers belong only in the explanation field.` },
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
      }, ANTHROPIC_API_KEY, { temperature: 0.1, max_tokens: 3000 });

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

      try { await supabase.from("capstone_usage").insert({ user_id: user.id }); } catch (_) {}
      return new Response(JSON.stringify({ questions: saved }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── ANALYZE PHOTO OF HANDWRITTEN WORK ──
    if (action === "analyze_photo") {
      if (!imageBase64) throw new Error("No image provided");

      if (imageBase64.length > 5_000_000) {
        return new Response(JSON.stringify({ error: "Image too large. Please use an image under 3.5MB." }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const chunks = await getChunksWithRecovery(supabase, standardId, authHeader, 20);

      if (!chunks?.length) throw new Error("No content found for this standard");

      const { data: standard } = await supabase.from("standards").select("title, standard_code").eq("id", standardId).single();

      const aiResponse = await callAI({
          model: "claude-opus-4-8",
          messages: [
            {
              role: "system",
              content: `You are reviewing handwritten exam work from an Australian electrical apprentice studying ${standard?.standard_code || standard?.title}.

CRITICAL — NEVER GUESS HANDWRITING:
If any word, number, or symbol is not clearly legible, write [unclear] — do NOT guess what it says.
Misreading a number (e.g. reading "2.5" as "25") gives dangerously wrong feedback on a real exam.
Only evaluate content you can clearly and confidently read.

Respond in this exact format:

**What I can read:**
Transcribe the handwritten text word-for-word. Mark anything uncertain as [unclear]. If the image is too blurry, dark, or unclear overall, say so and stop here.

**Feedback:**
Only comment on content you clearly transcribed above — never on [unclear] sections.
Reference specific clause numbers from the standard content provided.
Max 4 bullet points. Be direct and honest about what is correct vs what needs work.`,
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
      }, ANTHROPIC_API_KEY, { temperature: 0.1, max_tokens: 1500 });

      if (!aiResponse.ok) return await aiError(aiResponse);

      const aiData = await aiResponse.json();
      const analysis = getText(aiData);
      if (!analysis) throw new Error("No analysis generated");

      try { await supabase.from("capstone_usage").insert({ user_id: user.id }); } catch (_) {}
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
          model: "claude-opus-4-8",
          messages: [
            {
              role: "system",
              content: `You are a trade educator explaining standards to apprentices in plain language.
Rules:
- Max 5 bullet points
- Use simple, apprentice-friendly language
- Reference the clause number
- Do NOT give step-by-step instructions
- Explain WHAT the clause means and WHY it matters`,
            },
            {
              role: "user",
              content: `Explain this standard clause in apprentice-friendly language:\n\n[${chunk.clause_number || ""}${chunk.clause_title ? " — " + chunk.clause_title : ""}]\n${chunk.content}`,
            },
          ],
      }, ANTHROPIC_API_KEY, { temperature: 0.1, max_tokens: 1000 });

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

      try { await supabase.from("capstone_usage").insert({ user_id: user.id }); } catch (_) {}
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
        const chunks = await getChunksWithRecovery(supabase, standardId, authHeader, 30, undefined, sectionFilter);
        if (!chunks?.length) throw new Error("No content found for this standard. Please ensure it has been fully processed.");
        const figureChunks = await fetchDescribedFigures(supabase, standardId, 5, sectionFilter);
        const allChunks = [...chunks, ...figureChunks];
        const { data: standard } = await supabase.from("standards").select("title, standard_code").eq("id", standardId).single();

        const genResponse = await callAI({
          model: "claude-opus-4-8",
          messages: [
            { role: "system", content: `You are an exam question generator for trade apprentices studying ${standard?.title || "industry standards"}. Generate practical, scenario-based multiple-choice questions ONLY from the provided standard content. Never invent facts. Frame questions as real on-site situations — e.g. "You are wiring a bathroom and...", "A customer asks you to install...", "On a job site you find...". Do NOT ask "What does Clause X.X say?" — test understanding and application, not clause memorisation. CRITICAL: Never mention any clause number in the question text. Clause numbers belong only in the explanation field.` },
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
        }, ANTHROPIC_API_KEY, { max_tokens: 3000 });

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
        try { await supabase.from("capstone_usage").insert({ user_id: user.id }); } catch (_) {}
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

      // Idempotent: a double-tap must update the existing answer, not insert a
      // duplicate row that inflates the exam total and skews the score.
      const { data: existingAns } = await supabase
        .from("capstone_exam_answers")
        .select("id")
        .eq("exam_id", examId)
        .eq("question_id", questionId)
        .limit(1)
        .maybeSingle();

      if (existingAns) {
        await supabase.from("capstone_exam_answers")
          .update({ user_answer: userAnswer, is_correct: isCorrect })
          .eq("id", existingAns.id);
      } else {
        await supabase.from("capstone_exam_answers").insert({
          exam_id: examId, question_id: questionId, user_answer: userAnswer, is_correct: isCorrect,
        });
      }

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
          model: "claude-opus-4-8",
          messages: [
            { role: "system", content: `You are an expert trade educator. Create concise, apprentice-friendly study guides from standard content. Use clear headings, bullet points, and highlight key clause numbers. Only use information from the provided content.${figureNote}` },
            { role: "user", content: `Create a comprehensive study guide for apprentices from this standard. ${focusNote}\n\nStandard: ${standard?.standard_code || standard?.title}${sectionLabel}\n\nContent:\n${allChunks.map((c) => `[${c.clause_number || ""}${c.clause_title ? " - " + c.clause_title : ""}] ${(c.content || "").slice(0, 700)}`).join("\n\n")}` },
          ],
      }, ANTHROPIC_API_KEY, { temperature: 0.1, max_tokens: 3000 });

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

      try { await supabase.from("capstone_usage").insert({ user_id: user.id }); } catch (_) {}
      return new Response(JSON.stringify({ guide }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── EXAM PREP: Generate from uploaded exam or listed topics ──
    if (action === "exam_prep") {
      // FIX 3 — require meaningful grounding input
      const hasStandard = !!standardId;
      const hasTopics = examTopics && examTopics.trim().length > 0;
      const hasPdfText = examPdfText && examPdfText.trim().length >= 100;
      if (!hasStandard && !hasTopics && !hasPdfText) {
        return new Response(JSON.stringify({
          error: "Please select a standard or provide exam topics before generating prep materials.",
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      let contextParts: string[] = [];

      if (examPdfText && examPdfText.trim().length > 0) {
        contextParts.push(`PREVIOUS EXAM CONTENT:\n${examPdfText.slice(0, 15000)}`);
      }

      if (examTopics && examTopics.trim().length > 0) {
        contextParts.push(`EXAM TOPICS/AREAS IDENTIFIED BY THE STUDENT:\n${examTopics}`);
      }

      if (!contextParts.length && !standardId) throw new Error("Please provide exam content or topics");

      let standardContext = "";
      let standardTitle = "General Trade Knowledge";
      if (standardId) {
        const chunks = await getChunksWithRecovery(supabase, standardId, authHeader, 40);
        if (chunks.length > 0) {
          // FIX 7 — cap standard context to prevent prompt overflow
          const rawContext = chunks.map((c) => `[${c.clause_number || ""}${c.clause_title ? " - " + c.clause_title : ""}] ${c.content}`).join("\n\n");
          const cappedContext = rawContext.slice(0, 10000);
          standardContext = `\n\nRELEVANT STANDARD CONTENT:\n${cappedContext}`;
        }
        const { data: standard } = await supabase.from("standards").select("title, standard_code").eq("id", standardId).single();
        if (standard) standardTitle = standard.standard_code || standard.title;
      }

      const fullContext = contextParts.join("\n\n") + standardContext;

      const aiResponse = await callAI({
          model: "claude-opus-4-8",
          messages: [
            {
              role: "system",
              content: `You are an expert trade educator helping an apprentice prepare for an exam on "${standardTitle}". 
The student has provided either a previous exam paper, a list of expected exam topics, or both.
Your job:
1. Analyze the exam content/topics to identify the key areas being tested
2. Generate a focused study guide covering those areas
3. Generate 10 practice questions in the style of the exam

Rules:
- If a previous exam is provided, match the question style and difficulty
- Ground all content in the standard where possible, referencing clause numbers
- Be apprentice-friendly: clear language, practical examples
- Focus ONLY on the topics/areas identified`,
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
      }, ANTHROPIC_API_KEY, { temperature: 0.1, max_tokens: 4000 });

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

      // Fetch demand/installation chunks from primary standard (AS/NZS 3000)
      const primaryChunks = await getChunksWithRecovery(supabase, standardId, authHeader, 25, "maximum demand voltage drop cable", sectionFilter);

      // Auto-detect AS/NZS 3008 in user's library
      const { data: as3008 } = await supabase
        .from("standards")
        .select("id")
        .or("standard_code.ilike.%3008%,title.ilike.%3008%")
        .limit(1)
        .single();

      let cableChunks: StandardChunk[] = [];
      if (as3008?.id) {
        cableChunks = await fetchStandardChunks(supabase, as3008.id, 25);
      }

      const fallbackCableData = `Standard cable data (AS/NZS 3008, TPS clipped single circuit at 40°C):
2.5mm²: mV/A.m=14.7, Iz=20A | 4mm²: 9.22, 27A | 6mm²: 6.19, 34A | 10mm²: 3.84, 46A
16mm²: 2.40, 61A | 25mm²: 1.54, 80A | 35mm²: 1.11, 96A | 50mm²: 0.786, 117A
70mm²: 0.571, 143A | 95mm²: 0.422, 174A | 120mm²: 0.336, 200A
Voltage drop limit: 5% of supply voltage (AS/NZS 3000 Clause 3.6)`;

      const context = [
        primaryChunks.length > 0 ? `AS/NZS 3000 CONTENT:\n${primaryChunks.map((c) => `[${c.clause_number || ""}] ${(c.content || "").slice(0, 600)}`).join("\n\n")}` : "",
        cableChunks.length > 0 ? `AS/NZS 3008 CABLE DATA:\n${cableChunks.map((c) => `[${c.clause_number || ""}] ${(c.content || "").slice(0, 600)}`).join("\n\n")}` : fallbackCableData,
      ].filter(Boolean).join("\n\n---\n\n");

      const aiResponse = await callAI({
        model: "claude-opus-4-8",
        messages: [
          {
            role: "system",
            content: `You generate Section C calculation questions for Australian TAFE electrical capstone exams. Create one realistic, practical calculation scenario.

Key formulas:
- Voltage drop: VD(V) = I × mV/A·m × L / 1000; VD% = (VD / V_supply) × 100
- Single-phase V_supply = 230V; three-phase V_supply = 230V phase (use 400V only for line voltage)
- Maximum demand: total load groups × demand factors from AS/NZS 3000
- Cable sizing: Iz (derated) ≥ load current, In ≤ Iz
- Fault loop: Zs = Ze + (R1+R2); If = Vc / Zs

Question types (pick one):
1. voltage_drop — given cable, current, length → calculate VD% and state compliance
2. maximum_demand — given load schedule → calculate maximum demand per phase
3. cable_sizing — given load, installation conditions → select minimum cable size
4. fault_current — given supply impedance, cable data → calculate fault level

Use realistic Australian values. Show clear step-by-step working in the model solution.`,
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
                calculation_type: { type: "string", enum: ["voltage_drop", "maximum_demand", "cable_sizing", "fault_current"] },
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
      }, ANTHROPIC_API_KEY, { temperature: 0.1, max_tokens: 2000 });

      if (!aiResponse.ok) return await aiError(aiResponse);
      const aiData = await aiResponse.json();
      const question = getToolInput(aiData);
      if (!question) throw new Error("No calculation generated");

      try { await supabase.from("capstone_usage").insert({ user_id: user.id }); } catch (_) {}
      return new Response(JSON.stringify({ question }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── GRADE CALCULATION ──
    if (action === "grade_calculation") {
      if (!questionText || !modelAnswer) throw new Error("Missing grading data");

      const aiResponse = await callAI({
        model: "claude-opus-4-8",
        messages: [
          {
            role: "system",
            content: `You are marking a Section C calculation from an Australian electrical capstone exam.
Award method marks if the correct formula and approach is used, even with minor arithmetic errors.
Award answer marks only for the correct final value(s).
Give specific, helpful feedback.`,
          },
          {
            role: "user",
            content: `Scenario + question:\n${questionText}\n\nModel solution:\n${modelAnswer}\n\nTotal marks: ${correctClause || "4"}\n\nStudent's working:\n${userAnswer || "(nothing submitted)"}\n\nGrade this.`,
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
      }, ANTHROPIC_API_KEY, { temperature: 0.1, max_tokens: 1000 });

      if (!aiResponse.ok) return await aiError(aiResponse);
      const aiData = await aiResponse.json();
      const grade = getToolInput(aiData);
      if (!grade) throw new Error("Grading failed");
      return new Response(JSON.stringify(grade), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── GENERATE SHORT ANSWER QUESTIONS (Section B style) ──
    if (action === "generate_short_answer") {
      const chunks = await getChunksWithRecovery(supabase, standardId, authHeader, 40, topic, sectionFilter);
      if (!chunks?.length) throw new Error("No content found for this standard");

      const figureChunks = await fetchDescribedFigures(supabase, standardId, 5, sectionFilter);
      const allChunks = [...chunks, ...figureChunks];

      const { data: standard } = await supabase.from("standards").select("title, standard_code").eq("id", standardId).single();
      const count = questionCount || 5;

      const aiResponse = await callAI({
        model: "claude-opus-4-8",
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
      }, ANTHROPIC_API_KEY, { temperature: 0.1, max_tokens: 3000 });

      if (!aiResponse.ok) return await aiError(aiResponse);

      const aiData = await aiResponse.json();
      const input = getToolInput(aiData);
      if (!input) throw new Error("No questions generated");
      const { questions } = input;

      try { await supabase.from("capstone_usage").insert({ user_id: user.id }); } catch (_) {}
      return new Response(JSON.stringify({ questions: questions.map((q: any) => ({ ...q, marks: 2 })) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── GRADE SHORT ANSWER ──
    if (action === "grade_short_answer") {
      if (!questionText || !modelAnswer || !correctClause) throw new Error("Missing grading data");

      const aiResponse = await callAI({
        model: "claude-opus-4-8",
        messages: [
          {
            role: "system",
            content: `You are marking a TAFE electrical capstone exam (Section B). Marking rules:
- Award 2 marks: answer is substantially correct AND clause reference matches the correct clause
- Award 1 mark: answer is correct but clause reference is wrong or missing
- Award 0 marks: answer is wrong or insufficient
Be strict but fair. Accept minor wording differences if the meaning is correct. Always give specific feedback on what was right or wrong.`,
          },
          {
            role: "user",
            content: `Question: ${questionText}\n\nModel answer: ${modelAnswer}\nCorrect clause: ${correctClause}\n\nStudent's answer: ${userAnswer || "(no answer provided)"}\nStudent's clause reference: ${userClauseRef || "(none provided)"}\n\nGrade this response.`,
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
      }, ANTHROPIC_API_KEY, { temperature: 0.1, max_tokens: 1000 });

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
