import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildSystemPrompt, type TradeType } from "./system-prompt.ts";
import { detectTrade } from "./trade-detection.ts";
import { validateResponse } from "./validation.ts";
import { getAllowedOrigin } from "../_shared/cors.ts";
import { expandQuery } from "./synonyms.ts";

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

    const { question, conversation_history } = await req.json();
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

    // Build a retrieval query that includes recent conversation context.
    // When the user sends a short follow-up ("its on a 16amp type c"), the
    // previous question provides the topic needed for a useful vector search.
    const history: Array<{ role: string; content: string }> = Array.isArray(conversation_history)
      ? conversation_history.slice(-6)
      : [];
    const lastUserMessages = history
      .filter((m) => m.role === "user")
      .slice(-2)
      .map((m) => m.content)
      .join(" ");
    const retrievalQuery = lastUserMessages
      ? `${lastUserMessages} ${question}`
      : question;

    // Expand tradie terms to standards terminology before searching
    const { keywords, expandedText, matchedPhrases } = expandQuery(retrievalQuery);
    const hasExpansion = expandedText !== question;

    // Detect explicit clause numbers in the question (e.g. "5.6.3.2", "A3.1")
    const clauseNumberMatches = question.match(/\b[A-Za-z]?\d+(?:\.\d+){1,4}\b/g) || [];

    // Run all searches in parallel:
    // - embed original query
    // - embed expanded query (if tradie terms were found)
    // - load all chunks for keyword search
    // - direct clause number lookup
    const [embResponse, expandedEmbResponse, allChunksResult, clauseResult] = await Promise.all([
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
      supabase
        .from("standard_chunks")
        .select("id, standard_id, content, clause_number, clause_title, page_number, chunk_index")
        .eq("user_id", userId)
        .limit(2000),
      clauseNumberMatches.length > 0
        ? supabase
            .from("standard_chunks")
            .select("id, standard_id, content, clause_number, clause_title, page_number, chunk_index")
            .eq("user_id", userId)
            .in("clause_number", clauseNumberMatches)
            .limit(20)
        : Promise.resolve({ data: [] }),
    ]);

    // Vector search 1 — original query
    let vectorChunks1: any[] = [];
    if (embResponse.ok) {
      const embData = await embResponse.json();
      const queryEmbedding = embData.data[0].embedding;
      const { data, error: matchError } = await supabase.rpc("match_chunks", {
        query_embedding: queryEmbedding,
        match_user_id: userId,
        match_threshold: 0.20,
        match_count: 20,
      });
      if (!matchError && data?.length) vectorChunks1 = data;
    }

    // Vector search 2 — expanded query (runs after emb fetch completes, still fast)
    let vectorChunks2: any[] = [];
    if (hasExpansion && expandedEmbResponse?.ok) {
      const embData2 = await expandedEmbResponse.json();
      const expandedEmbedding = embData2.data[0].embedding;
      const { data, error: matchError2 } = await supabase.rpc("match_chunks", {
        query_embedding: expandedEmbedding,
        match_user_id: userId,
        match_threshold: 0.20,
        match_count: 20,
      });
      if (!matchError2 && data?.length) vectorChunks2 = data;
    }

    // Merge both vector searches (deduplicated, original query results first)
    const seenVectorIds = new Set<string>();
    const vectorChunks: any[] = [];
    for (const c of [...vectorChunks1, ...vectorChunks2]) {
      if (!seenVectorIds.has(c.id)) {
        seenVectorIds.add(c.id);
        vectorChunks.push(c);
      }
    }

    // Keyword search — using expanded keywords (covers tradie terms + standard terms)
    let keywordChunks: any[] = [];
    if (allChunksResult.data?.length) {
      const scored = allChunksResult.data.map((chunk: any) => {
        const lower = chunk.content.toLowerCase();
        const score = keywords.reduce((acc: number, kw: string) => acc + (lower.includes(kw) ? 1 : 0), 0);
        return { ...chunk, similarity: score / keywords.length };
      });
      scored.sort((a: any, b: any) => b.similarity - a.similarity);
      keywordChunks = scored.filter((s: any) => s.similarity > 0).slice(0, 15);
    }

    // Direct clause number hits — highest priority
    const clauseChunks: any[] = (clauseResult.data || []).map((c: any) => ({ ...c, similarity: 1.0 }));

    // Merge: clause number hits → vector results → keyword results
    const seenIds = new Set(clauseChunks.map((c: any) => c.id));
    const uniqueVector = vectorChunks.filter((c: any) => !seenIds.has(c.id));
    uniqueVector.forEach((c: any) => seenIds.add(c.id));
    const uniqueKeyword = keywordChunks.filter((c: any) => !seenIds.has(c.id));
    const matchedChunks = [...clauseChunks, ...uniqueVector, ...uniqueKeyword].slice(0, 25);
    const topSimilarity = matchedChunks[0]?.similarity || 0;

    // Get standard details for context
    const standardIds = [...new Set(matchedChunks.map((c: any) => c.standard_id))];
    const standards = standardIds.length > 0
      ? (await supabase.from("standards").select("id, standard_code, version, title").in("id", standardIds)).data
      : [];

    const standardMap = new Map(standards?.map((s: any) => [s.id, s]) || []);

    // Detect trade from query + most-represented standard
    const standardCounts = new Map<string, number>();
    for (const chunk of matchedChunks) {
      const std = standardMap.get(chunk.standard_id);
      if (std?.standard_code) {
        standardCounts.set(std.standard_code, (standardCounts.get(std.standard_code) || 0) + 1);
      }
    }
    const topStandardName = standardCounts.size > 0
      ? [...standardCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
      : null;

    const trade: TradeType = detectTrade(question, topStandardName);

    // Build context chunks string for system prompt
    const contextChunks = matchedChunks.length > 0
      ? matchedChunks.map((chunk: any, i: number) => {
          const std = standardMap.get(chunk.standard_id);
          return `[Source ${i + 1} — ${std?.standard_code || "Unknown"} ${std?.version || ""} Clause ${chunk.clause_number || "N/A"} (Page ${chunk.page_number || "N/A"})]
${chunk.content}`;
        }).join("\n\n")
      : "No relevant clauses found in uploaded standards.";

    // Build dynamic system prompt (includes matched tradie phrases for context)
    const systemPrompt = buildSystemPrompt(trade, contextChunks, matchedPhrases);

    // Pre-generate the query log ID so feedback can reference it without a blocking DB write
    const queryId = crypto.randomUUID();

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
        max_tokens: 1200,
        messages: [
          { role: "system", content: systemPrompt },
          ...history,
          { role: "user", content: question },
        ],
      }),
    });

    if (!aiResponse.ok) {
      const errBody = await aiResponse.json().catch(() => null);
      const errMsg = errBody?.error?.message || errBody?.error || `AI error ${aiResponse.status}`;
      console.error(`[query] OpenAI error ${aiResponse.status}: ${JSON.stringify(errBody)}`);
      return new Response(JSON.stringify({ error: errMsg }), {
        status: aiResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResponse.json();
    const rawContent = aiData.choices?.[0]?.message?.content || "";

    // Parse AI response as JSON.
    // Handle cases where the model outputs prose before/after the JSON object.
    let parsedResponse: any;
    try {
      const cleaned = rawContent.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      parsedResponse = JSON.parse(cleaned);
    } catch {
      // Find the first { and try parsing from there
      const jsonStart = rawContent.indexOf("{");
      if (jsonStart !== -1) {
        try {
          parsedResponse = JSON.parse(rawContent.slice(jsonStart));
        } catch {
          // Strip any trailing JSON blob and use remaining prose as the answer
          const stripped = rawContent.replace(/\{[\s\S]*\}$/, "").trim();
          parsedResponse = {
            answer: stripped || rawContent,
            citations: [],
            safety_critical: false,
            confidence: "low",
            answer_found: true,
          };
        }
      } else {
        parsedResponse = {
          answer: rawContent,
          citations: [],
          safety_critical: false,
          confidence: "low",
          answer_found: true,
        };
      }
    }

    // Look up image URLs for figures/tables.
    // We extract figure/table numbers from three places so we never miss one:
    //   1. The AI's figures_referenced / tables_referenced JSON fields
    //   2. The original question (e.g. "show me figure 2.4")
    //   3. The answer text (e.g. "Figure 2.4 shows...")
    const combinedText = `${question} ${parsedResponse.answer || ""}`;
    const figNumsFromText = [...combinedText.matchAll(/\bfigure[s]?\s+(\d+\.\d+(?:\.\d+)?)\b/gi)]
      .map((m) => m[1]);
    const tblNumsFromText = [...combinedText.matchAll(/\btable[s]?\s+(\d+\.\d+(?:\.\d+)?)\b/gi)]
      .map((m) => m[1]);

    const aiFigures: any[] = parsedResponse.figures_referenced || [];
    const aiTables: any[] = parsedResponse.tables_referenced || [];

    // Merge AI-declared refs with text-extracted numbers (deduplicated)
    const seenFigNums = new Set(aiFigures.map((f: any) => f.figure_number));
    for (const n of figNumsFromText) {
      if (!seenFigNums.has(n)) { aiFigures.push({ figure_number: n }); seenFigNums.add(n); }
    }
    const seenTblNums = new Set(aiTables.map((t: any) => t.table_number));
    for (const n of tblNumsFromText) {
      if (!seenTblNums.has(n)) { aiTables.push({ table_number: n }); seenTblNums.add(n); }
    }

    const figNums = aiFigures.map((f: any) => f.figure_number).filter(Boolean);
    const tblNums = aiTables.map((t: any) => t.table_number).filter(Boolean);

    if (figNums.length > 0 || tblNums.length > 0) {
      const [figRows, tblRows] = await Promise.all([
        figNums.length > 0
          ? supabase
              .from("standard_figures")
              .select("figure_number, image_url, caption, page_number")
              .eq("user_id", userId)
              .in("figure_number", figNums)
          : Promise.resolve({ data: [] }),
        tblNums.length > 0
          ? supabase
              .from("standard_tables")
              .select("table_number, image_url, caption, page_number")
              .eq("user_id", userId)
              .in("table_number", tblNums)
          : Promise.resolve({ data: [] }),
      ]);

      const figMap = new Map((figRows.data || []).map((r: any) => [r.figure_number, r]));
      const tblMap = new Map((tblRows.data || []).map((r: any) => [r.table_number, r]));

      parsedResponse.figures_referenced = aiFigures
        .map((f: any) => {
          const row = figMap.get(f.figure_number);
          return row ? { ...f, image_url: row.image_url, caption: f.caption || row.caption, page_number: row.page_number } : f;
        })
        .filter((f: any) => f.image_url);

      parsedResponse.tables_referenced = aiTables
        .map((t: any) => {
          const row = tblMap.get(t.table_number);
          return row ? { ...t, image_url: row.image_url, caption: t.caption || row.caption, page_number: row.page_number } : t;
        })
        .filter((t: any) => t.image_url);
    } else {
      parsedResponse.figures_referenced = [];
      parsedResponse.tables_referenced = [];
    }

    // Validate the answer text — catches hallucinated citations, missing safety warnings, low grounding
    const validation = validateResponse({
      response: parsedResponse.answer || "",
      chunks: matchedChunks,
      query: question,
      trade,
    });

    // Apply cleaned answer back (hallucinated citations stripped, safety warnings injected)
    parsedResponse.answer = validation.cleanedResponse;

    // Strip citations whose relevant_text doesn't appear in any retrieved chunk
    if (parsedResponse.citations?.length && matchedChunks.length > 0) {
      const allChunkText = matchedChunks.map((c: any) => c.content.toLowerCase()).join(" ");
      parsedResponse.citations = parsedResponse.citations.filter((c: any) => {
        if (!c.relevant_text || c.relevant_text.trim().length < 10) return false;
        const words = c.relevant_text.toLowerCase().split(/\W+/).filter((w: string) => w.length > 3);
        if (words.length === 0) return false;
        const matches = words.filter((w: string) => allChunkText.includes(w)).length;
        return matches / words.length >= 0.6;
      });
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

    // Build response
    const responsePayload = JSON.stringify({
      ...parsedResponse,
      low_confidence: isLowConfidence,
      queries_remaining: tier === "free" ? 5 - todayCount - 1 : null,
      queryId,
      confidence_score: validation.confidenceScore,
      needs_review: validation.needsReview,
    });

    // All DB logging is non-blocking — runs after response is returned
    (async () => {
      await supabase.from("query_log").insert({
        id: queryId,
        user_id: userId,
        query_text: question,
        trade,
        retrieved_chunk_ids: matchedChunks.map((c: any) => c.id).filter(Boolean),
        retrieved_chunk_count: matchedChunks.length,
        model_used: "gpt-4o-mini",
        response_text: parsedResponse.answer,
        confidence_score: validation.confidenceScore,
        validation_issues: validation.issues,
        needs_review: validation.needsReview,
      });

      const { data: queryRecord } = await supabase.from("queries").insert({
        user_id: userId,
        question,
        response: parsedResponse.answer,
        citations: parsedResponse.citations,
        confidence_score: topSimilarity,
        safety_flagged: parsedResponse.safety_critical || false,
        subscription_tier_at_time: tier,
      }).select().single();

      if (queryRecord && parsedResponse.citations?.length > 0) {
        const citationRecords = parsedResponse.citations.map((c: any) => {
          const matchedStandard = standards?.find((s: any) => s.standard_code === c.standard_code);
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
    })().catch(console.error);

    return new Response(responsePayload, {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (e) {
    console.error("Query error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
