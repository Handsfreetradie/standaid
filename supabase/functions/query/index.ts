import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGIN") || "http://localhost:8080")
  .split(",").map((o: string) => o.trim());

function getAllowedOrigin(origin: string): string {
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  if (origin.endsWith(".lovable.app") || origin.endsWith(".lovableproject.com") || origin.startsWith("http://localhost")) return origin;
  return ALLOWED_ORIGINS[0];
}

const SYSTEM_PROMPT = `You are StandAId — an AI assistant built for Australian tradies. You're like a smart, experienced mate who knows their stuff: knowledgeable about Australian Standards (AS/NZS), the NCC, electrical, plumbing, gas, and construction regulations, but also just easy to talk to.

Your personality:
- Warm, natural, and conversational — like Claude or ChatGPT, not a robot
- Direct and practical — tradies don't want waffle
- Confident but honest when you're not sure about something
- Happy to chat, help the user figure out what they need, or answer compliance questions
- Use plain Australian English. Occasional casual language is fine ("no worries", "good question", "yeah")

You have two sources of knowledge:
1. SOURCE CLAUSES — specific text from the user's uploaded standards (highest priority for compliance questions)
2. Your broad training knowledge about Australian trade regulations, standards, and general tradie topics

For compliance questions: prioritise SOURCE CLAUSES, supplement with general knowledge, and be clear about which is which.
For general conversation, questions about the app, or anything non-compliance: just respond naturally and helpfully.

Use markdown in the answer field: **bold** for key terms, bullet points for lists, short paragraphs. Keep it readable on mobile.

Your response must always follow this exact JSON structure:
{
  "answer": "your response here — markdown supported",
  "citations": [
    {
      "clause_number": "exact clause number from source text",
      "standard_code": "e.g. AS/NZS 3000",
      "standard_version": "e.g. 2018",
      "page_number": 42,
      "relevant_text": "brief quote from the clause"
    }
  ],
  "safety_critical": true or false,
  "safety_message": "if safety_critical is true, include a clear on-site safety warning here, otherwise omit",
  "accuracy_score": 8,
  "accuracy_reason": "one sentence explaining the score — skip if it's casual conversation",
  "answer_found": true or false,
  "follow_up_questions": ["relevant question 1", "relevant question 2"]
}

RULES:
1. For casual conversation (greetings, thanks, general chat): respond naturally. Set accuracy_score to 10, citations to [], safety_critical to false, answer_found to true. follow_up_questions should offer 1-2 ways you can help them.
2. For compliance questions: never invent or guess clause numbers. Only use clause numbers that appear verbatim in the SOURCE CLAUSES.
3. Set safety_critical to true any time the answer involves live electrical work, gas, structural elements, or anything where a mistake could cause injury or death.
4. accuracy_score is an integer 1–10:
   - 9-10: directly backed by uploaded clause text
   - 7-8: mostly clauses, minor gaps from general knowledge
   - 5-6: primarily general knowledge, limited clause support
   - 3-4: general knowledge only, no matching clauses
   - 1-2: low confidence
5. Always include 2 follow_up_questions relevant to what was just discussed.
6. Always respond with valid JSON only. No text outside the JSON.`;

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

    const { question } = await req.json();
    if (!question || typeof question !== "string" || question.trim().length === 0) {
      return new Response(JSON.stringify({ error: "Question is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    if (question.length > 2000) {
      return new Response(JSON.stringify({ error: "Question must be 2,000 characters or less" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get user profile for tier and query limits
    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", userId)
      .single();

    const tier = profile?.subscription_tier || "free";

    // Count today's queries for this user (UTC)
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);

    const { count } = await supabase
      .from("queries")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", startOfToday.toISOString());

    const todayCount = count ?? 0;

    if (tier === "free" && todayCount >= 5) {
      return new Response(JSON.stringify({ error: "You've reached your daily limit of 5 queries. Upgrade to Pro for unlimited queries." }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "Service unavailable" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Try vector search first, fallback to keyword matching
    let matchedChunks: any[] = [];
    let topSimilarity = 0;
    let usedFallback = false;

    // Generate query embedding
    const embResponse = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: question,
      }),
    });

    if (embResponse.ok) {
      const embData = await embResponse.json();
      const queryEmbedding = embData.data[0].embedding;

      const { data: vectorChunks, error: matchError } = await supabase
        .rpc("match_chunks", {
          query_embedding: queryEmbedding,
          match_user_id: userId,
          match_threshold: 0.30,
          match_count: 20,
        });

      if (!matchError && vectorChunks?.length) {
        matchedChunks = vectorChunks;
        topSimilarity = matchedChunks[0]?.similarity || 0;
      }
    }

    // Fallback: keyword-based search on unindexed chunks
    if (matchedChunks.length === 0) {
      usedFallback = true;
      const keywords = question.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2);

      // Get all chunks for this user
      const { data: allChunks } = await supabase
        .from("standard_chunks")
        .select("id, standard_id, content, clause_number, clause_title, page_number, chunk_index")
        .eq("user_id", userId)
        .limit(1000);

      if (allChunks?.length) {
        const scored = allChunks.map((chunk: any) => {
          const lower = chunk.content.toLowerCase();
          const score = keywords.reduce((acc: number, kw: string) => acc + (lower.includes(kw) ? 1 : 0), 0);
          return { ...chunk, similarity: score / keywords.length };
        });
        scored.sort((a: any, b: any) => b.similarity - a.similarity);
        matchedChunks = scored.filter((s: any) => s.similarity > 0).slice(0, 12);
        topSimilarity = matchedChunks[0]?.similarity || 0;
      }
    }

    // Always proceed to AI — it handles both compliance questions and casual conversation

    // Get standard details for context
    const standardIds = [...new Set(matchedChunks.map((c: any) => c.standard_id))];
    const standards = standardIds.length > 0
      ? (await supabase.from("standards").select("id, standard_code, version, title").in("id", standardIds)).data
      : [];

    const standardMap = new Map(standards?.map((s: any) => [s.id, s]) || []);

    // Build source clauses context
    const sourceContext = matchedChunks.length > 0
      ? matchedChunks.map((chunk: any) => {
          const std = standardMap.get(chunk.standard_id);
          return `[${std?.standard_code || "Unknown"} ${std?.version || ""} - Clause ${chunk.clause_number || "N/A"} (Page ${chunk.page_number || "N/A"}, Similarity: ${chunk.similarity?.toFixed(3)})]
${chunk.content}`;
        }).join("\n\n---\n\n")
      : "No relevant clauses found in uploaded standards.";

    // Confidence assessment
    const isLowConfidence = topSimilarity < 0.80;

    // Call OpenAI for response generation
    const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.1,
        max_tokens: 4000,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `SOURCE CLAUSES:\n${sourceContext}\n\nUSER QUESTION:\n${question}` },
        ],
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI API error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const rawContent = aiData.choices?.[0]?.message?.content || "";

    // Parse AI response as JSON
    let parsedResponse: any;
    try {
      // Strip markdown code fences if present
      const cleaned = rawContent.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      parsedResponse = JSON.parse(cleaned);
    } catch {
      // If AI didn't return valid JSON, wrap it
      parsedResponse = {
        answer: rawContent,
        citations: [],
        safety_critical: false,
        confidence: "low",
        answer_found: true,
      };
    }

    // Validate citations — only keep ones that exist in retrieved chunks
    const validClauseNumbers = new Set(matchedChunks.map((c: any) => c.clause_number).filter(Boolean));
    if (parsedResponse.citations) {
      parsedResponse.citations = parsedResponse.citations.filter((c: any) => 
        validClauseNumbers.has(c.clause_number)
      );
    }

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

    // Store query and citations
    const { data: queryRecord } = await supabase
      .from("queries")
      .insert({
        user_id: userId,
        question,
        response: parsedResponse.answer,
        citations: parsedResponse.citations,
        confidence_score: topSimilarity,
        safety_flagged: parsedResponse.safety_critical || false,
        subscription_tier_at_time: tier,
      })
      .select()
      .single();

    // Store individual citations
    if (queryRecord && parsedResponse.citations?.length > 0) {
      const citationRecords = parsedResponse.citations.map((c: any) => {
        const matchedStandard = standards?.find((s: any) => 
          s.standard_code === c.standard_code
        );
        return {
          query_id: queryRecord.id,
          standard_id: matchedStandard?.id || standardIds[0],
          clause_number: c.clause_number,
          standard_code: c.standard_code,
          version: c.standard_version,
          page_number: c.page_number,
          confidence_score: topSimilarity,
          chunk_content: c.relevant_text,
        };
      });

      await supabase.from("citations").insert(citationRecords);
    }

    return new Response(JSON.stringify({
      ...parsedResponse,
      query_id: queryRecord?.id,
      low_confidence: isLowConfidence,
      queries_remaining: tier === "free" ? 5 - todayCount - 1 : null,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  } catch (e) {
    console.error("Query error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { 
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }
});
