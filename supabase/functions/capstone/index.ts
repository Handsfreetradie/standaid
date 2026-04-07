import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGIN") || "http://localhost:8080")
  .split(",").map((o: string) => o.trim());

type StandardChunk = {
  content: string;
  clause_number: string | null;
  clause_title: string | null;
};

async function fetchStandardChunks(
  supabase: any,
  standardId: string,
  limit: number,
): Promise<StandardChunk[]> {
  let { data: chunks, error: indexedError } = await supabase
    .from("standard_chunks")
    .select("content, clause_number, clause_title")
    .eq("standard_id", standardId)
    .eq("is_indexed", true)
    .order("chunk_index", { ascending: true })
    .limit(limit);

  if (indexedError) throw indexedError;

  if (!chunks?.length) {
    const { data: fallbackChunks, error: fallbackError } = await supabase
      .from("standard_chunks")
      .select("content, clause_number, clause_title")
      .eq("standard_id", standardId)
      .order("chunk_index", { ascending: true })
      .limit(limit);

    if (fallbackError) throw fallbackError;
    chunks = fallbackChunks;
  }

  return chunks || [];
}

async function getChunksWithRecovery(
  supabase: any,
  standardId: string,
  authHeader: string,
  limit: number,
): Promise<StandardChunk[]> {
  let chunks = await fetchStandardChunks(supabase, standardId, limit);
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

  chunks = await fetchStandardChunks(supabase, standardId, limit);
  return chunks;
}

serve(async (req) => {
  const origin = req.headers.get("Origin") || "";
  const corsHeaders = {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
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

    const { action, standardId, topic, difficulty, questionCount, examId, questionId, userAnswer, imageBase64, chunkId, examTopics, examPdfText } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    // ── RATE LIMIT: 20 AI calls per hour per user (applies to AI actions only) ──
    const AI_ACTIONS = ["generate_questions", "analyze_photo", "explain_chunk", "generate_study_guide"];
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
      const chunks = await getChunksWithRecovery(supabase, standardId, authHeader, 30);

      if (!chunks?.length) throw new Error("No content found for this standard");

      const { data: standard } = await supabase.from("standards").select("title, standard_code").eq("id", standardId).single();

      const count = questionCount || 5;
      const diff = difficulty || "medium";
      const topicFilter = topic ? `Focus on the topic: ${topic}.` : "";

      const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: `You are an exam question generator for trade apprentices studying ${standard?.title || "industry standards"}. Generate multiple-choice questions ONLY from the provided standard content. Never invent facts. Each question must reference specific clauses.` },
            { role: "user", content: `Generate ${count} ${diff}-difficulty multiple-choice questions from this standard content. ${topicFilter}\n\nStandard: ${standard?.standard_code || standard?.title}\n\nContent:\n${chunks.map((c) => `[${c.clause_number || ""}] ${c.content}`).join("\n\n")}` },
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
        }),
      });

      if (!aiResponse.ok) {
        const status = aiResponse.status;
        if (status === 429) return new Response(JSON.stringify({ error: "Rate limited. Please try again shortly." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        throw new Error("AI generation failed");
      }

      const aiData = await aiResponse.json();
      const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
      if (!toolCall) throw new Error("No questions generated");
      const { questions } = JSON.parse(toolCall.function.arguments);

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

      const chunks = await getChunksWithRecovery(supabase, standardId, authHeader, 20);

      if (!chunks?.length) throw new Error("No content found for this standard");

      const { data: standard } = await supabase.from("standards").select("title, standard_code").eq("id", standardId).single();

      const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content: `You are a trade educator reviewing an apprentice's handwritten work against ${standard?.standard_code || standard?.title}. 
Rules:
- Give CONCISE hints only (max 3-5 bullet points)
- Do NOT give full answers unless explicitly asked
- Reference specific clause numbers from the standard
- If the handwriting is unclear, say so honestly
- Focus on what needs correction or improvement
- Be encouraging but accurate`,
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `Review this apprentice's handwritten work against the standard. Give max 5 concise hints about what's correct and what needs improvement.\n\nRelevant standard content:\n${chunks.map((c) => `[${c.clause_number || ""}] ${c.content}`).join("\n\n")}`,
                },
                {
                  type: "image_url",
                  image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
                },
              ],
            },
          ],
        }),
      });

      if (!aiResponse.ok) {
        const status = aiResponse.status;
        if (status === 429) return new Response(JSON.stringify({ error: "Rate limited." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        throw new Error("AI analysis failed");
      }

      const aiData = await aiResponse.json();
      const analysis = aiData.choices?.[0]?.message?.content;
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

      const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-lite",
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
        }),
      });

      if (!aiResponse.ok) {
        const status = aiResponse.status;
        if (status === 429) return new Response(JSON.stringify({ error: "Rate limited." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        throw new Error("AI explanation failed");
      }

      const aiData = await aiResponse.json();
      const explanation = aiData.choices?.[0]?.message?.content;
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

      let { data: questions } = await supabase
        .from("capstone_questions").select("*")
        .eq("user_id", user.id).eq("standard_id", standardId).limit(count);

      if (!questions?.length) {
        return new Response(JSON.stringify({ error: "No questions available. Generate practice questions first." }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const shuffled = questions.sort(() => Math.random() - 0.5).slice(0, count);

      const { data: exam, error: examErr } = await supabase.from("capstone_exams").insert({
        user_id: user.id, title: "Practice Exam", total_questions: shuffled.length,
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

      const isCorrect = userAnswer === question.correct_answer;

      await supabase.from("capstone_exam_answers").insert({
        exam_id: examId, question_id: questionId, user_answer: userAnswer, is_correct: isCorrect,
      });

      return new Response(JSON.stringify({ is_correct: isCorrect, correct_answer: question.correct_answer, explanation: question.explanation, clause_reference: question.clause_reference }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── COMPLETE EXAM ──
    if (action === "complete_exam") {
      const { data: answers } = await supabase.from("capstone_exam_answers").select("is_correct, question_id").eq("exam_id", examId);
      const correct = answers?.filter((a) => a.is_correct).length || 0;
      const total = answers?.length || 0;

      await supabase.from("capstone_exams").update({
        status: "completed", correct_answers: correct, total_questions: total, completed_at: new Date().toISOString(),
      }).eq("id", examId);

      const percentage = total > 0 ? Math.round((correct / total) * 100) : 0;
      return new Response(JSON.stringify({ correct, total, percentage, passed: percentage >= 70 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── GENERATE STUDY GUIDE ──
    if (action === "generate_study_guide") {
      const chunks = await getChunksWithRecovery(supabase, standardId, authHeader, 40);
      if (!chunks?.length) throw new Error("No content found");

      const { data: standard } = await supabase.from("standards").select("title, standard_code").eq("id", standardId).single();

      const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: "You are an expert trade educator. Create concise, apprentice-friendly study guides from standard content. Use clear headings, bullet points, and highlight key clause numbers. Only use information from the provided content." },
            { role: "user", content: `Create a comprehensive study guide for apprentices from this standard.${topic ? ` Focus on: ${topic}` : ""}\n\nStandard: ${standard?.standard_code || standard?.title}\n\nContent:\n${chunks.map((c) => `[${c.clause_number || ""}${c.clause_title ? " - " + c.clause_title : ""}] ${c.content}`).join("\n\n")}` },
          ],
        }),
      });

      if (!aiResponse.ok) {
        if (aiResponse.status === 429) return new Response(JSON.stringify({ error: "Rate limited." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (aiResponse.status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        throw new Error("AI generation failed");
      }

      const aiData = await aiResponse.json();
      const content = aiData.choices?.[0]?.message?.content;
      if (!content) throw new Error("No guide generated");

      const { data: guide, error: guideErr } = await supabase.from("capstone_study_guides").insert({
        user_id: user.id, standard_id: standardId,
        title: `${standard?.standard_code || standard?.title} — Study Guide`,
        content, topics: topic ? [topic] : [],
      }).select().single();
      if (guideErr) throw guideErr;

      try { await supabase.from("capstone_usage").insert({ user_id: user.id }); } catch (_) {}
      return new Response(JSON.stringify({ guide }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── EXAM PREP: Generate from uploaded exam or listed topics ──
    if (action === "exam_prep") {
      let contextParts: string[] = [];

      if (examPdfText && examPdfText.trim().length > 0) {
        contextParts.push(`PREVIOUS EXAM CONTENT:\n${examPdfText.slice(0, 15000)}`);
      }

      if (examTopics && examTopics.trim().length > 0) {
        contextParts.push(`EXAM TOPICS/AREAS IDENTIFIED BY THE STUDENT:\n${examTopics}`);
      }

      if (!contextParts.length) throw new Error("Please provide exam content or topics");

      let standardContext = "";
      let standardTitle = "General Trade Knowledge";
      if (standardId) {
        const chunks = await getChunksWithRecovery(supabase, standardId, authHeader, 40);
        if (chunks.length > 0) {
          standardContext = `\n\nRELEVANT STANDARD CONTENT:\n${chunks.map((c) => `[${c.clause_number || ""}${c.clause_title ? " - " + c.clause_title : ""}] ${c.content}`).join("\n\n")}`;
        }
        const { data: standard } = await supabase.from("standards").select("title, standard_code").eq("id", standardId).single();
        if (standard) standardTitle = standard.standard_code || standard.title;
      }

      const fullContext = contextParts.join("\n\n") + standardContext;

      const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
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
        }),
      });

      if (!aiResponse.ok) {
        const status = aiResponse.status;
        if (status === 429) return new Response(JSON.stringify({ error: "Rate limited." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        throw new Error("AI generation failed");
      }

      const aiData = await aiResponse.json();
      const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
      if (!toolCall) throw new Error("No exam prep generated");
      const result = JSON.parse(toolCall.function.arguments);

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

    throw new Error(`Unknown action: ${action}`);
  } catch (e) {
    console.error("capstone error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
