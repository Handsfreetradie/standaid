import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are a trade compliance assistant for the StandardsAI app.
You answer questions using ONLY the clause text provided below.
You must NEVER use outside knowledge, training data, memory, or assumptions to answer compliance questions.

Your response must follow this exact JSON structure:
{
  "answer": "plain English answer here",
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
  "safety_message": "if safety_critical is true, include warning here",
  "confidence": "high or medium or low",
  "answer_found": true or false
}

STRICT RULES:
1. If the SOURCE CLAUSES below do not contain enough information to answer the question, set answer_found to false and say: "I cannot find a clear answer in your uploaded standards. Please refer to the relevant standard directly."
2. Never invent, estimate, or guess clause numbers. Only use clause numbers that appear verbatim in the source text below.
3. Never paraphrase a clause number — copy it exactly as written.
4. If you are not certain, say so clearly in the answer field.
5. Set safety_critical to true any time the question involves live electrical work, gas, structural elements, or any work where an error could cause injury or death.
6. Always respond with valid JSON only. No markdown, no extra text.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
    const userId = claimsData.claims.sub as string;

    const { question } = await req.json();
    if (!question || typeof question !== "string" || question.trim().length === 0) {
      return new Response(JSON.stringify({ error: "Question is required" }), { 
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    // Get user profile for tier and query limits
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("user_id", userId)
      .single();

    const tier = profile?.subscription_tier || "free";

    // Check daily query limit for free tier
    if (tier === "free") {
      const resetAt = new Date(profile?.daily_query_reset_at || 0);
      const now = new Date();
      
      // Reset counter if it's a new day
      if (now.toDateString() !== resetAt.toDateString()) {
        await supabaseAdmin
          .from("profiles")
          .update({ daily_query_count: 0, daily_query_reset_at: now.toISOString() })
          .eq("user_id", userId);
      } else if ((profile?.daily_query_count || 0) >= 5) {
        return new Response(JSON.stringify({ 
          error: "Daily query limit reached",
          upgrade_required: true,
          message: "You've used all 5 free queries today. Upgrade to Pro for unlimited queries.",
          queries_used: 5,
          queries_limit: 5,
        }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "API key not configured" }), { 
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    // Try vector search first, fallback to keyword matching
    let matchedChunks: any[] = [];
    let topSimilarity = 0;
    let usedFallback = false;

    // Generate query embedding
    const embResponse = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
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

      const { data: vectorChunks, error: matchError } = await supabaseAdmin
        .rpc("match_chunks", {
          query_embedding: JSON.stringify(queryEmbedding),
          match_user_id: userId,
          match_threshold: 0.72,
          match_count: 8,
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
      const { data: allChunks } = await supabaseAdmin
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
        matchedChunks = scored.filter((s: any) => s.similarity > 0).slice(0, 8);
        topSimilarity = matchedChunks[0]?.similarity || 0;
      }
    }

    // If no relevant chunks found, skip AI
    if (matchedChunks.length === 0) {
      await supabaseAdmin.from("queries").insert({
        user_id: userId,
        question,
        response: "I couldn't find relevant information in your uploaded standards for this question. Please check your standards library or consult the relevant standard directly.",
        confidence_score: 0,
        safety_flagged: false,
        subscription_tier_at_time: tier,
      });

      if (tier === "free") {
        await supabaseAdmin
          .from("profiles")
          .update({ daily_query_count: (profile?.daily_query_count || 0) + 1 })
          .eq("user_id", userId);
      }

      return new Response(JSON.stringify({
        answer: "I couldn't find relevant information in your uploaded standards for this question. Please check your standards library or consult the relevant standard directly.",
        citations: [],
        safety_critical: false,
        confidence: "low",
        answer_found: false,
        queries_remaining: tier === "free" ? 5 - (profile?.daily_query_count || 0) - 1 : null,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Get standard details for context
    const standardIds = [...new Set(matchedChunks.map((c: any) => c.standard_id))];
    const { data: standards } = await supabaseAdmin
      .from("standards")
      .select("id, standard_code, version, title")
      .in("id", standardIds);

    const standardMap = new Map(standards?.map((s: any) => [s.id, s]) || []);

    // Build source clauses context
    const sourceContext = matchedChunks.map((chunk: any) => {
      const std = standardMap.get(chunk.standard_id);
      return `[${std?.standard_code || "Unknown"} ${std?.version || ""} - Clause ${chunk.clause_number || "N/A"} (Page ${chunk.page_number || "N/A"}, Similarity: ${chunk.similarity?.toFixed(3)})]
${chunk.content}`;
    }).join("\n\n---\n\n");

    // Confidence assessment
    const isLowConfidence = topSimilarity < 0.80;

    // Call AI for response generation
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `SOURCE CLAUSES:\n${sourceContext}\n\nUSER QUESTION:\n${question}` },
        ],
        temperature: 0.1,
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
    const { data: queryRecord } = await supabaseAdmin
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

      await supabaseAdmin.from("citations").insert(citationRecords);
    }

    // Increment query count for free tier
    if (tier === "free") {
      await supabaseAdmin
        .from("profiles")
        .update({ daily_query_count: (profile?.daily_query_count || 0) + 1 })
        .eq("user_id", userId);
    }

    return new Response(JSON.stringify({
      ...parsedResponse,
      query_id: queryRecord?.id,
      low_confidence: isLowConfidence,
      queries_remaining: tier === "free" ? 5 - (profile?.daily_query_count || 0) - 1 : null,
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
