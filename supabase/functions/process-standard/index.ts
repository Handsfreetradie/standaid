import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface Section {
  heading: string | null;
  clauseNumber: string | null;
  lines: string[];
  pageNumber: number;
}

interface Chunk {
  clause_number: string | null;
  clause_title: string | null;
  content: string;
  page_number: number;
  chunk_index: number;
}

// Heading patterns for AU/NZ standards
const SECTION_HEADING = /^(SECTION\s+\d+|PART\s+\d+|APPENDIX\s+[A-Z])/i;
const CLAUSE_PATTERN = /^(\d+(?:\.\d+)*)\s+(.*)$/;

// Target ~500 tokens ≈ ~2000 chars
const TARGET_CHUNK_CHARS = 2000;
const MAX_CHUNK_CHARS = 2500;

function sortIntoSections(text: string, pages: string[]): Section[] {
  const lines = text.split("\n");
  const sections: Section[] = [];
  let current: Section = { heading: null, clauseNumber: null, lines: [], pageNumber: 1 };

  // Build page offset map
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
    let currentPage = 1;
    for (let p = pageOffsets.length - 1; p >= 0; p--) {
      if (totalChars >= pageOffsets[p]) {
        currentPage = p + 1;
        break;
      }
    }

    const sectionMatch = line.match(SECTION_HEADING);
    const clauseMatch = line.match(CLAUSE_PATTERN);

    if (sectionMatch) {
      // Save previous section
      if (current.lines.length > 0) sections.push({ ...current });
      current = { heading: line.trim(), clauseNumber: null, lines: [line], pageNumber: currentPage };
    } else if (clauseMatch) {
      // New clause within a section — start sub-section
      if (current.lines.length > 0) sections.push({ ...current });
      current = {
        heading: clauseMatch[2].trim(),
        clauseNumber: clauseMatch[1],
        lines: [line],
        pageNumber: currentPage,
      };
    } else {
      current.lines.push(line);
    }
  }

  if (current.lines.length > 0) sections.push(current);
  return sections;
}

function chunkSections(sections: Section[]): Chunk[] {
  const chunks: Chunk[] = [];
  let chunkIndex = 0;

  for (const section of sections) {
    const sectionText = section.lines.join("\n").trim();
    if (sectionText.length < 20) continue;

    if (sectionText.length <= MAX_CHUNK_CHARS) {
      // Fits in one chunk — keep together
      chunks.push({
        clause_number: section.clauseNumber,
        clause_title: section.heading,
        content: sectionText,
        page_number: section.pageNumber,
        chunk_index: chunkIndex++,
      });
    } else {
      // Split on paragraph boundaries, preserving content exactly
      const paragraphs = sectionText.split(/\n\s*\n/);
      let buffer = "";

      for (const para of paragraphs) {
        if (buffer.length + para.length + 2 > TARGET_CHUNK_CHARS && buffer.length > 0) {
          chunks.push({
            clause_number: section.clauseNumber,
            clause_title: section.heading,
            content: buffer.trim(),
            page_number: section.pageNumber,
            chunk_index: chunkIndex++,
          });
          buffer = "";
        }
        buffer += (buffer ? "\n\n" : "") + para;
      }

      if (buffer.trim().length > 20) {
        chunks.push({
          clause_number: section.clauseNumber,
          clause_title: section.heading,
          content: buffer.trim(),
          page_number: section.pageNumber,
          chunk_index: chunkIndex++,
        });
      }
    }
  }

  // Fallback if nothing was detected
  if (chunks.length === 0) {
    const fullText = sections.map((s) => s.lines.join("\n")).join("\n");
    const paragraphs = fullText.split(/\n\s*\n/);
    let buffer = "";
    for (const para of paragraphs) {
      buffer += para + "\n\n";
      if (buffer.length > TARGET_CHUNK_CHARS) {
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
      chunks.push({ clause_number: null, clause_title: null, content: buffer.trim(), page_number: 1, chunk_index: chunkIndex++ });
    }
  }

  return chunks;
}

async function generateEmbedding(text: string, apiKey: string): Promise<number[]> {
  const response = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text.slice(0, 8000) }),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Embedding API error: ${response.status} ${errText}`);
  }
  const data = await response.json();
  return data.data[0].embedding;
}

// Basic regex-based extraction (fallback)
function extractTextBasic(fileBytes: Uint8Array): string {
  const decoder = new TextDecoder("latin1");
  const rawText = decoder.decode(fileBytes);

  const allText: string[] = [];
  const textRegex = /\(([^)]*)\)/g;
  let match;
  while ((match = textRegex.exec(rawText)) !== null) {
    const text = match[1]
      .replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t")
      .replace(/\\\(/g, "(").replace(/\\\)/g, ")").replace(/\\\\/g, "\\");
    if (text.trim().length > 0 && !/^[<>{}[\]]+$/.test(text)) allText.push(text);
  }

  const tjRegex = /\[([^\]]*)\]\s*TJ/g;
  while ((match = tjRegex.exec(rawText)) !== null) {
    const innerTextRegex = /\(([^)]*)\)/g;
    let innerMatch;
    while ((innerMatch = innerTextRegex.exec(match[1])) !== null) {
      if (innerMatch[1].trim().length > 0) allText.push(innerMatch[1]);
    }
  }

  return allText.join(" ").replace(/\s+/g, " ").trim();
}

// AI-based PDF text extraction using Gemini vision
async function extractTextWithAI(fileBytes: Uint8Array, apiKey: string): Promise<string> {
  const binaryStr = Array.from(fileBytes).map(b => String.fromCharCode(b)).join("");
  const base64 = btoa(binaryStr);

  // Cap at ~4MB base64 to stay within edge function limits
  const pdfBase64 = base64.length > 4 * 1024 * 1024 ? base64.slice(0, 4 * 1024 * 1024) : base64;

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "system",
          content: `You are a precise document text extractor. Extract ALL text from this PDF document EXACTLY as written.
Rules:
- Preserve ALL section headings, clause numbers (e.g., 1.1, 1.1.1), and structure
- Keep paragraph breaks as double newlines
- Keep tables as readable text
- Do NOT summarize, paraphrase, or add any content
- Do NOT add commentary or explanations
- Extract text VERBATIM — every word must match the original
- Include page markers like [PAGE 2], [PAGE 3] etc. between pages if detectable
- For scanned/image-based pages, use OCR to extract text accurately`,
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract ALL text from this PDF document verbatim. Preserve all headings, clause numbers, tables, and structure exactly as they appear." },
            { type: "image_url", image_url: { url: `data:application/pdf;base64,${pdfBase64}` } },
          ],
        },
      ],
      max_tokens: 16000,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("AI extraction error:", response.status, errText);
    throw new Error(`AI extraction failed: ${response.status}`);
  }

  const data = await response.json();
  const extractedText = data.choices?.[0]?.message?.content;
  if (!extractedText || extractedText.length < 50) {
    throw new Error("AI extraction returned insufficient text");
  }
  return extractedText;
}

async function extractTextFromPdf(fileBytes: Uint8Array, apiKey: string): Promise<{ text: string; pages: string[] }> {
  // Step 1: Try basic extraction first (fast, free)
  const basicText = extractTextBasic(fileBytes);
  console.log(`Basic extraction: ${basicText.length} chars`);

  if (basicText.length > 500) {
    const alphaCount = (basicText.match(/[a-zA-Z0-9]/g) || []).length;
    const alphaRatio = alphaCount / basicText.length;
    if (alphaRatio > 0.5) {
      console.log("Basic extraction quality sufficient");
      return { text: basicText, pages: [basicText] };
    }
  }

  // Step 2: Fall back to AI-based OCR
  console.log("Using AI-based OCR extraction...");
  try {
    const aiText = await extractTextWithAI(fileBytes, apiKey);
    console.log(`AI extraction: ${aiText.length} chars`);

    const pageMarkerRegex = /\[PAGE\s+\d+\]/gi;
    const pages = aiText.split(pageMarkerRegex).filter((p) => p.trim().length > 0);

    return {
      text: aiText.replace(pageMarkerRegex, "\n\n").trim(),
      pages: pages.length > 1 ? pages : [aiText],
    };
  } catch (aiError) {
    console.error("AI extraction failed, falling back to basic:", aiError);
    if (basicText.length > 50) {
      return { text: basicText, pages: [basicText] };
    }
    throw new Error("Could not extract text from this PDF. Try a digital (text-selectable) version.");
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const supabaseUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabaseUser.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
    const userId = claimsData.claims.sub as string;

    const { standard_id } = await req.json();
    if (!standard_id) {
      return new Response(JSON.stringify({ error: "standard_id is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: standard, error: standardError } = await supabaseAdmin
      .from("standards").select("*").eq("id", standard_id).eq("user_id", userId).single();
    if (standardError || !standard) {
      return new Response(JSON.stringify({ error: "Standard not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await supabaseAdmin.from("standards").update({ extraction_status: "processing" }).eq("id", standard_id);

    const { data: fileData, error: downloadError } = await supabaseAdmin.storage.from("standards").download(standard.file_path!);
    if (downloadError || !fileData) {
      await supabaseAdmin.from("standards").update({ extraction_status: "failed" }).eq("id", standard_id);
      return new Response(JSON.stringify({ error: "Failed to download file" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const fileBytes = new Uint8Array(await fileData.arrayBuffer());
    let extracted: { text: string; pages: string[] };
    try {
      extracted = await extractTextFromPdf(fileBytes);
    } catch (e) {
      console.error("Text extraction failed:", e);
      await supabaseAdmin.from("standards").update({ extraction_status: "failed" }).eq("id", standard_id);
      return new Response(JSON.stringify({ error: "We had trouble reading this PDF. Try a higher quality scan or a digital version." }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const qualityScore = extracted.text.length > 500 ? 85 : extracted.text.length > 100 ? 50 : 10;
    if (qualityScore < 30) {
      await supabaseAdmin.from("standards").update({ extraction_status: "failed", extraction_quality_score: qualityScore }).eq("id", standard_id);
      return new Response(JSON.stringify({ error: "Text quality too low. Try a higher quality scan." }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Step 1: Sort into sections by headings
    const sections = sortIntoSections(extracted.text, extracted.pages);
    // Step 2: Chunk each section into ~500 token pieces
    const allChunks = chunkSections(sections);
    const totalChunks = allChunks.length;

    const { data: profile } = await supabaseAdmin.from("profiles").select("subscription_tier").eq("user_id", userId).single();
    const tier = profile?.subscription_tier || "free";
    const isPartial = tier === "free";
    const indexLimit = isPartial ? Math.ceil(totalChunks * 0.25) : totalChunks;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      await supabaseAdmin.from("standards").update({ extraction_status: "failed" }).eq("id", standard_id);
      return new Response(JSON.stringify({ error: "API key not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

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

      const { error: chunkError } = await supabaseAdmin.from("standard_chunks").insert(chunkRecords);
      if (chunkError) console.error("Chunk insert error:", chunkError);

      if (i + BATCH_SIZE < allChunks.length) await new Promise((r) => setTimeout(r, 500));
    }

    await supabaseAdmin.from("standards").update({
      extraction_status: "complete",
      extraction_quality_score: qualityScore,
      is_partial: isPartial,
      total_chunks: totalChunks,
      indexed_chunks: indexedCount,
    }).eq("id", standard_id);

    return new Response(JSON.stringify({ status: "complete", total_chunks: totalChunks, indexed_chunks: indexedCount, quality_score: qualityScore, is_partial: isPartial }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Processing error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
