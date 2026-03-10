import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Clause pattern regex for AU/NZ standards: 1, 1.1, 1.1.1, etc.
const CLAUSE_PATTERN = /^(\d+(?:\.\d+)*)\s+(.*)$/;
const CLAUSE_HEADER_PATTERN = /^(\d+(?:\.\d+)*)\s/m;

interface Chunk {
  clause_number: string | null;
  clause_title: string | null;
  content: string;
  page_number: number;
  chunk_index: number;
}

function extractClausesFromText(text: string, pages: string[]): Chunk[] {
  const chunks: Chunk[] = [];
  let chunkIndex = 0;

  // Split text into lines and identify clause boundaries
  const lines = text.split("\n");
  let currentClause: string | null = null;
  let currentTitle: string | null = null;
  let currentContent: string[] = [];
  let currentPage = 1;

  // Build a page offset map
  let charCount = 0;
  const pageOffsets: number[] = [];
  for (const page of pages) {
    pageOffsets.push(charCount);
    charCount += page.length;
  }

  let totalChars = 0;

  for (const line of lines) {
    totalChars += line.length + 1;

    // Determine current page
    for (let p = pageOffsets.length - 1; p >= 0; p--) {
      if (totalChars >= pageOffsets[p]) {
        currentPage = p + 1;
        break;
      }
    }

    const match = line.match(CLAUSE_PATTERN);
    if (match) {
      // Save previous chunk
      if (currentContent.length > 0) {
        const content = currentContent.join("\n").trim();
        if (content.length > 20) {
          chunks.push({
            clause_number: currentClause,
            clause_title: currentTitle,
            content,
            page_number: currentPage,
            chunk_index: chunkIndex++,
          });
        }
      }

      currentClause = match[1];
      currentTitle = match[2].trim();
      currentContent = [line];
    } else {
      currentContent.push(line);
    }

    // Split large chunks (target 300-600 tokens ≈ 1200-2400 chars)
    const currentText = currentContent.join("\n");
    if (currentText.length > 2400) {
      chunks.push({
        clause_number: currentClause,
        clause_title: currentTitle,
        content: currentText.trim(),
        page_number: currentPage,
        chunk_index: chunkIndex++,
      });
      currentContent = [];
    }
  }

  // Don't forget the last chunk
  if (currentContent.length > 0) {
    const content = currentContent.join("\n").trim();
    if (content.length > 20) {
      chunks.push({
        clause_number: currentClause,
        clause_title: currentTitle,
        content,
        page_number: currentPage,
        chunk_index: chunkIndex++,
      });
    }
  }

  // If no clauses were detected, fall back to paragraph-based chunking
  if (chunks.length === 0) {
    const paragraphs = text.split(/\n\s*\n/);
    let buffer = "";
    for (const para of paragraphs) {
      buffer += para + "\n\n";
      if (buffer.length > 1500) {
        chunks.push({
          clause_number: null,
          clause_title: null,
          content: buffer.trim(),
          page_number: 1,
          chunk_index: chunkIndex++,
        });
        buffer = "";
      }
    }
    if (buffer.trim().length > 20) {
      chunks.push({
        clause_number: null,
        clause_title: null,
        content: buffer.trim(),
        page_number: 1,
        chunk_index: chunkIndex++,
      });
    }
  }

  return chunks;
}

async function generateEmbedding(text: string, apiKey: string): Promise<number[]> {
  const response = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: text.slice(0, 8000), // Limit input size
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Embedding API error: ${response.status} ${errText}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

async function extractTextFromPdf(fileBytes: Uint8Array): Promise<{ text: string; pages: string[] }> {
  // Use AI to extract text from PDF via the Lovable AI Gateway with vision
  // For now, we'll use a simpler approach - extract raw text
  // In production, you'd use a PDF parsing library
  
  // Attempt basic text extraction by looking for text streams in PDF
  const decoder = new TextDecoder("latin1");
  const rawText = decoder.decode(fileBytes);
  
  // Extract text between BT and ET markers (PDF text objects)
  const textParts: string[] = [];
  const pages: string[] = [];
  
  // Simple PDF text extraction - look for text content
  const textRegex = /\(([^)]*)\)/g;
  let match;
  const allText: string[] = [];
  
  while ((match = textRegex.exec(rawText)) !== null) {
    const text = match[1]
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\\(/g, "(")
      .replace(/\\\)/g, ")")
      .replace(/\\\\/g, "\\");
    
    if (text.trim().length > 0 && !/^[<>{}[\]]+$/.test(text)) {
      allText.push(text);
    }
  }

  // Also try to find text in Tj and TJ operators
  const tjRegex = /\[([^\]]*)\]\s*TJ/g;
  while ((match = tjRegex.exec(rawText)) !== null) {
    const content = match[1];
    const innerTextRegex = /\(([^)]*)\)/g;
    let innerMatch;
    while ((innerMatch = innerTextRegex.exec(content)) !== null) {
      if (innerMatch[1].trim().length > 0) {
        allText.push(innerMatch[1]);
      }
    }
  }

  const fullText = allText.join(" ").replace(/\s+/g, " ").trim();
  pages.push(fullText); // Treat as single page for basic extraction

  return { text: fullText, pages };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    // Use service role for admin operations
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify user
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabaseUser.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
    const userId = claimsData.claims.sub as string;

    const { standard_id } = await req.json();
    if (!standard_id) {
      return new Response(JSON.stringify({ error: "standard_id is required" }), { 
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    // Get standard record
    const { data: standard, error: standardError } = await supabaseAdmin
      .from("standards")
      .select("*")
      .eq("id", standard_id)
      .eq("user_id", userId)
      .single();

    if (standardError || !standard) {
      return new Response(JSON.stringify({ error: "Standard not found" }), { 
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    // Update status to processing
    await supabaseAdmin
      .from("standards")
      .update({ extraction_status: "processing" })
      .eq("id", standard_id);

    // Download the PDF from storage
    const { data: fileData, error: downloadError } = await supabaseAdmin.storage
      .from("standards")
      .download(standard.file_path!);

    if (downloadError || !fileData) {
      await supabaseAdmin
        .from("standards")
        .update({ extraction_status: "failed" })
        .eq("id", standard_id);
      return new Response(JSON.stringify({ error: "Failed to download file" }), { 
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    // Extract text from PDF
    const fileBytes = new Uint8Array(await fileData.arrayBuffer());
    let extracted: { text: string; pages: string[] };
    
    try {
      extracted = await extractTextFromPdf(fileBytes);
    } catch (e) {
      console.error("Text extraction failed:", e);
      await supabaseAdmin
        .from("standards")
        .update({ extraction_status: "failed" })
        .eq("id", standard_id);
      return new Response(JSON.stringify({ 
        error: "We had trouble reading this PDF. Try a higher quality scan or a digital version of the document." 
      }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Calculate extraction quality
    const qualityScore = extracted.text.length > 500 ? 85 : extracted.text.length > 100 ? 50 : 10;

    if (qualityScore < 30) {
      await supabaseAdmin
        .from("standards")
        .update({ extraction_status: "failed", extraction_quality_score: qualityScore })
        .eq("id", standard_id);
      return new Response(JSON.stringify({ 
        error: "We had trouble reading this PDF. The text quality is too low. Try a higher quality scan or a digital version." 
      }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Chunk the text
    const allChunks = extractClausesFromText(extracted.text, extracted.pages);
    const totalChunks = allChunks.length;

    // Get user's subscription tier
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("subscription_tier")
      .eq("user_id", userId)
      .single();

    const tier = profile?.subscription_tier || "free";
    const isPartial = tier === "free";
    
    // For free tier, only index first 25%
    const indexLimit = isPartial ? Math.ceil(totalChunks * 0.25) : totalChunks;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      await supabaseAdmin
        .from("standards")
        .update({ extraction_status: "failed" })
        .eq("id", standard_id);
      return new Response(JSON.stringify({ error: "API key not configured" }), { 
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    // Process chunks in batches
    const BATCH_SIZE = 10;
    let indexedCount = 0;

    for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
      const batch = allChunks.slice(i, i + BATCH_SIZE);
      
      const chunkRecords = [];
      
      for (const chunk of batch) {
        const shouldIndex = chunk.chunk_index < indexLimit;
        let embedding = null;

        if (shouldIndex) {
          try {
            const embeddingVector = await generateEmbedding(chunk.content, LOVABLE_API_KEY);
            embedding = JSON.stringify(embeddingVector);
            indexedCount++;
          } catch (e) {
            console.error(`Embedding failed for chunk ${chunk.chunk_index}:`, e);
            // Continue without embedding
          }
        }

        chunkRecords.push({
          standard_id,
          user_id: userId,
          clause_number: chunk.clause_number,
          clause_title: chunk.clause_title,
          content: chunk.content,
          page_number: chunk.page_number,
          chunk_index: chunk.chunk_index,
          embedding,
          is_indexed: shouldIndex && embedding !== null,
        });
      }

      // Insert batch
      const { error: chunkError } = await supabaseAdmin
        .from("standard_chunks")
        .insert(chunkRecords);

      if (chunkError) {
        console.error("Chunk insert error:", chunkError);
      }

      // Small delay between batches to avoid rate limiting
      if (i + BATCH_SIZE < allChunks.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Update standard with final status
    await supabaseAdmin
      .from("standards")
      .update({
        extraction_status: "complete",
        extraction_quality_score: qualityScore,
        is_partial: isPartial,
        total_chunks: totalChunks,
        indexed_chunks: indexedCount,
      })
      .eq("id", standard_id);

    return new Response(JSON.stringify({ 
      status: "complete",
      total_chunks: totalChunks,
      indexed_chunks: indexedCount,
      quality_score: qualityScore,
      is_partial: isPartial,
    }), { 
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  } catch (e) {
    console.error("Processing error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { 
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }
});
