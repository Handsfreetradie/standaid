import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildSystemPrompt, type TradeType } from "./system-prompt.ts";
import { detectTrade } from "./trade-detection.ts";
import { validateResponse } from "./validation.ts";
import { getAllowedOrigin } from "../_shared/cors.ts";
import { expandQuery } from "./synonyms.ts";

const SEPARATOR = "---METADATA---";
const SEP_LEN = SEPARATOR.length;

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

    // Phase 1: profile + rate limit check in parallel (fast DB queries)
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);

    const [profileResult, countResult] = await Promise.all([
      supabase.from("profiles").select("*").eq("user_id", userId).single(),
      supabase.from("queries").select("*", { count: "exact", head: true })
        .eq("user_id", userId).gte("created_at", startOfToday.toISOString()),
    ]);

    const profile = profileResult.data;
    const tier = profile?.subscription_tier || "pro";
    const todayCount = countResult.count ?? 0;

    if (tier === "free" && todayCount >= 5) {
      return new Response(JSON.stringify({ error: "You've reached your daily limit of 5 queries. Upgrade to Pro for unlimited queries." }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build retrieval query with conversation context
    const history: Array<{ role: string; content: string }> = Array.isArray(conversation_history)
      ? conversation_history.slice(-6)
      : [];
    const lastUserMessages = history
      .filter((m) => m.role === "user")
      .slice(-2)
      .map((m) => m.content)
      .join(" ");
    const retrievalQuery = lastUserMessages ? `${lastUserMessages} ${effectiveQuestion}` : effectiveQuestion;

    // Expand tradie terms to standards terminology
    const { keywords, expandedText, matchedPhrases } = expandQuery(retrievalQuery);
    const hasExpansion = expandedText !== effectiveQuestion;

    // Detect explicit clause numbers
    const clauseNumberMatches = effectiveQuestion.match(/\b[A-Za-z]?\d+(?:\.\d+){1,4}\b/g) || [];

    // Server-side keyword search: top 5 keywords via ilike (much faster than loading 2000 chunks)
    const topKeywords = keywords.slice(0, 5).filter((kw: string) => kw.length > 2);
    const ilikeParts = topKeywords.length > 0
      ? topKeywords.map((kw: string) => `content.ilike.%${kw}%`).join(",")
      : null;

    // Phase 2: all expensive operations in parallel
    const [embResponse, expandedEmbResponse, keywordChunksResult, clauseResult] = await Promise.all([
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
      ilikeParts
        ? supabase
            .from("standard_chunks")
            .select("id, standard_id, content, clause_number, clause_title, page_number, chunk_index")
            .eq("user_id", userId)
            .or(ilikeParts)
            .limit(15)
        : Promise.resolve({ data: [] }),
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

    // Vector search 2 — expanded query
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

    // Merge vector results (deduplicated)
    const seenVectorIds = new Set<string>();
    const vectorChunks: any[] = [];
    for (const c of [...vectorChunks1, ...vectorChunks2]) {
      if (!seenVectorIds.has(c.id)) {
        seenVectorIds.add(c.id);
        vectorChunks.push(c);
      }
    }

    const keywordChunks: any[] = (keywordChunksResult.data || []).map((c: any) => ({ ...c, similarity: 0.5 }));
    const clauseChunks: any[] = (clauseResult.data || []).map((c: any) => ({ ...c, similarity: 1.0 }));

    // Merge: clause hits → vector → keyword
    const seenIds = new Set(clauseChunks.map((c: any) => c.id));
    const uniqueVector = vectorChunks.filter((c: any) => !seenIds.has(c.id));
    uniqueVector.forEach((c: any) => seenIds.add(c.id));
    const uniqueKeyword = keywordChunks.filter((c: any) => !seenIds.has(c.id));
    const matchedChunks = [...clauseChunks, ...uniqueVector, ...uniqueKeyword].slice(0, 25);
    const topSimilarity = matchedChunks[0]?.similarity || 0;

    // Get standard details
    const standardIds = [...new Set(matchedChunks.map((c: any) => c.standard_id))];
    const standards = standardIds.length > 0
      ? (await supabase.from("standards").select("id, standard_code, version, title").in("id", standardIds)).data
      : [];
    const standardMap = new Map(standards?.map((s: any) => [s.id, s]) || []);

    // Detect trade
    const standardCounts = new Map<string, number>();
    for (const chunk of matchedChunks) {
      const std = standardMap.get(chunk.standard_id);
      if (std?.standard_code) standardCounts.set(std.standard_code, (standardCounts.get(std.standard_code) || 0) + 1);
    }
    const topStandardName = standardCounts.size > 0
      ? [...standardCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
      : null;
    const trade: TradeType = detectTrade(effectiveQuestion, topStandardName);

    // Build context string
    const contextChunks = matchedChunks.length > 0
      ? matchedChunks.map((chunk: any, i: number) => {
          const std = standardMap.get(chunk.standard_id);
          return `[Source ${i + 1} — ${std?.standard_code || "Unknown"} ${std?.version || ""} Clause ${chunk.clause_number || "N/A"} (Page ${chunk.page_number || "N/A"})]
${chunk.content}`;
        }).join("\n\n")
      : null;

    // No-chunks fallback — refuse to fabricate, tell user to check their uploads
    if (contextChunks === null) {
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
        queries_remaining: tier === "free" ? 5 - todayCount : null,
      };
      return new Response(
        `data: ${JSON.stringify(noChunksPayload)}\n\n`,
        { headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } }
      );
    }

    const systemPrompt = buildSystemPrompt(trade, contextChunks, matchedPhrases);
    const queryId = crypto.randomUUID();
    const isLowConfidence = topSimilarity < 0.80;

    // Build user message content — include image if uploaded
    const lastUserContent: any = hasImage
      ? [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image_base64 } },
          { type: "text", text: effectiveQuestion },
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
          model: "claude-opus-4-8",
          max_tokens: 2000,
          stream: true,
          messages: [
            { role: "user", content: systemPrompt },
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
                const sepIdx = accumulated.indexOf(SEPARATOR);
                if (sepIdx !== -1) {
                  // Separator found — send any buffered answer text before it
                  const unsent = accumulated.slice(lastSentIdx, sepIdx);
                  if (unsent.trim()) {
                    await writer.write(encoder.encode(`data: ${JSON.stringify({ token: unsent })}\n\n`));
                  }
                  pastSeparator = true;
                } else {
                  // Send up to (length - SEP_LEN) to avoid splitting the separator across chunks
                  const safeEnd = Math.max(lastSentIdx, accumulated.length - SEP_LEN);
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
        const sepIdx = accumulated.indexOf(SEPARATOR);
        let answerText: string;
        let metadataRaw: string;

        if (sepIdx !== -1) {
          answerText = accumulated.slice(0, sepIdx).trim();
          metadataRaw = accumulated.slice(sepIdx + SEP_LEN).trim();
        } else {
          // Fallback: try old JSON format
          const cleaned = accumulated.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          const jsonStart = cleaned.indexOf("{");
          if (jsonStart !== -1) {
            try {
              const old = JSON.parse(cleaned.slice(jsonStart));
              answerText = old.answer || accumulated;
              metadataRaw = JSON.stringify(old);
            } catch {
              answerText = accumulated;
              metadataRaw = "{}";
            }
          } else {
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

        const parsedResponse: any = {
          answer: answerText,
          citations: parsedMetadata.citations || [],
          figures_referenced: parsedMetadata.figures_referenced || [],
          tables_referenced: parsedMetadata.tables_referenced || [],
          safety_critical: parsedMetadata.safety_critical || false,
          safety_message: parsedMetadata.safety_message,
          confidence: parsedMetadata.confidence || "medium",
          answer_found: parsedMetadata.answer_found !== false,
          clarification_question: parsedMetadata.clarification_question || null,
        };

        // Figure/table lookup — regex supports whole numbers (e.g. "Table 50") and "fig" abbreviation/typos
        const questionFigNums = [...effectiveQuestion.matchAll(/\bfig(?:ure)?s?\s+(\d+(?:\.\d+)*)\b/gi)].map((m) => m[1]);
        const questionTblNums = [...effectiveQuestion.matchAll(/\btable[s]?\s+(\d+(?:\.\d+)*)\b/gi)].map((m) => m[1]);
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
        const answerFigRefs = [...answerText2.matchAll(/\bfigure\s+(\d+(?:\.\d+)*)\b/gi)].map((m) => m[1]);
        for (const n of answerFigRefs) {
          if (!seenFigNums.has(n)) { aiFigures.push({ figure_number: n }); seenFigNums.add(n); }
        }
        const answerTblRefs = [...answerText2.matchAll(/\btable\s+(\d+(?:\.\d+)*)\b/gi)].map((m) => m[1]);
        for (const n of answerTblRefs) {
          if (!seenTblNums.has(n)) { aiTables.push({ table_number: n }); seenTblNums.add(n); }
        }

        const figNums = aiFigures.map((f: any) => f.figure_number).filter(Boolean);
        const tblNums = aiTables.map((t: any) => t.table_number).filter(Boolean);

        if (figNums.length > 0 || tblNums.length > 0) {
          const [figRows, tblRows] = await Promise.all([
            figNums.length > 0
              ? supabase.from("standard_figures").select("figure_number, image_url, caption, page_number, standard_id")
                  .eq("user_id", userId).in("figure_number", figNums)
              : Promise.resolve({ data: [] }),
            tblNums.length > 0
              ? supabase.from("standard_tables").select("table_number, image_url, caption, page_number, standard_id")
                  .eq("user_id", userId).in("table_number", tblNums)
              : Promise.resolve({ data: [] }),
          ]);
          const figMap = new Map((figRows.data || []).map((r: any) => [r.figure_number, r]));
          const tblMap = new Map((tblRows.data || []).map((r: any) => [r.table_number, r]));

          // For refs without an image, find the page from matched chunks so we can open the PDF
          const findPageInChunks = (label: string, num: string) => {
            const pat = new RegExp(`\\b${label}\\s+${num.replace(/\./g, "\\.")}\\b`, "i");
            const hit = matchedChunks.find((c: any) =>
              pat.test(c.content) || (c.clause_number || "").toUpperCase() === `${label.toUpperCase()} ${num}`
            );
            return hit ? { page_number: hit.page_number, standard_id: hit.standard_id } : null;
          };

          parsedResponse.figures_referenced = aiFigures.map((f: any) => {
            const row = figMap.get(f.figure_number);
            if (row?.image_url) return { ...f, image_url: row.image_url, caption: f.caption || row.caption, page_number: row.page_number, standard_id: row.standard_id };
            const pi = findPageInChunks("Figure", f.figure_number);
            return pi ? { ...f, page_number: pi.page_number, standard_id: pi.standard_id } : null;
          }).filter(Boolean);

          parsedResponse.tables_referenced = aiTables.map((t: any) => {
            const row = tblMap.get(t.table_number);
            if (row?.image_url) return { ...t, image_url: row.image_url, caption: t.caption || row.caption, page_number: row.page_number, standard_id: row.standard_id };
            const pi = findPageInChunks("Table", t.table_number);
            return pi ? { ...t, page_number: pi.page_number, standard_id: pi.standard_id } : null;
          }).filter(Boolean);
        } else {
          parsedResponse.figures_referenced = [];
          parsedResponse.tables_referenced = [];
        }

        // Validate answer
        const validation = validateResponse({
          response: parsedResponse.answer || "",
          chunks: matchedChunks,
          query: effectiveQuestion,
          trade,
        });
        parsedResponse.answer = validation.cleanedResponse;

        // Strip hallucinated citations
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

        // Attach the real standard_id + page to each citation from the matched
        // chunks. standard_code is often null/mismatched, so the ID is the only
        // reliable key for the PDF viewer to open the right document and page.
        if (parsedResponse.citations?.length) {
          for (const c of parsedResponse.citations) {
            const want = (c.clause_number || "").toString().trim();
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

        // Fallback: scan answer text for "Clause X.X.X" mentions and auto-cite
        // from matched chunks. Handles cases where Claude mentions the clause
        // in prose but omits it from the metadata JSON (common when the answer
        // spans multiple sub-clauses or includes a correction).
        if (matchedChunks.length > 0) {
          const citedNums = new Set(
            parsedResponse.citations.map((c: any) => (c.clause_number || "").toString().trim())
          );
          const answerClauseRefs = [
            ...(parsedResponse.answer || "").matchAll(/\bclause\s+(\d+(?:\.\d+){1,4})\b/gi)
          ].map((m) => m[1]);
          for (const ref of answerClauseRefs) {
            if (citedNums.has(ref)) continue;
            const hit =
              matchedChunks.find((mc: any) => (mc.clause_number || "").toString().trim() === ref) ||
              matchedChunks.find((mc: any) => (mc.clause_number || "").toString().trim().startsWith(ref + ".")) ||
              matchedChunks.find((mc: any) => ref.startsWith(((mc.clause_number || "").toString().trim()) + "."));
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

        // Send done event with full metadata
        const donePayload = {
          done: true,
          ...parsedResponse,
          low_confidence: isLowConfidence,
          queries_remaining: tier === "free" ? 5 - todayCount - 1 : null,
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
            model_used: "gpt-4o-mini",
            response_text: parsedResponse.answer,
            confidence_score: validation.confidenceScore,
            validation_issues: validation.issues,
            needs_review: validation.needsReview,
          });
          const { data: queryRecord } = await supabase.from("queries").insert({
            user_id: userId,
            question: effectiveQuestion,
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
