import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
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

    const { action, standardId, topic, difficulty, questionCount, examId, questionId, userAnswer, imageBase64, chunkId } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    // ── GENERATE QUIZ QUESTIONS ──
    if (action === "generate_questions") {
      const { data: chunks, error: chunkErr } = await supabase
        .from("standard_chunks")
        .select("content, clause_number, clause_title")
        .eq("standard_id", standardId)
        .eq("is_indexed", true)
        .limit(30);

      if (chunkErr) throw chunkErr;
      if (!chunks?.length) throw new Error("No indexed content found for this standard");

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

      return new Response(JSON.stringify({ questions: saved }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── ANALYZE PHOTO OF HANDWRITTEN WORK ──
    if (action === "analyze_photo") {
      if (!imageBase64) throw new Error("No image provided");

      const { data: chunks } = await supabase
        .from("standard_chunks")
        .select("content, clause_number, clause_title")
        .eq("standard_id", standardId)
        .eq("is_indexed", true)
        .limit(20);

      if (!chunks?.length) throw new Error("No indexed content found for this standard");

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
      await supabase.from("queries").insert({
        user_id: user.id,
        question: cacheKey,
        response: explanation,
        confidence_score: 1.0,
        safety_flagged: false,
      }).catch(() => {});

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
      const { data: chunks } = await supabase
        .from("standard_chunks").select("content, clause_number, clause_title")
        .eq("standard_id", standardId).eq("is_indexed", true).limit(40);
      if (!chunks?.length) throw new Error("No indexed content found");

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

      return new Response(JSON.stringify({ guide }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (e) {
    console.error("capstone error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
