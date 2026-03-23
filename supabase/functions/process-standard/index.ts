import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGIN") || "http://localhost:8080")
  .split(",").map((o: string) => o.trim());

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

// Basic regex-based extraction
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

// Clean extracted text: remove PDF operator noise before quality check
function cleanExtractedText(text: string): string {
  return text
    .replace(/\b(BT|ET|Tj|TJ|Tf|Td|Tm|cm|re|f|W|n|q|Q|rg|RG|gs|Do|CS|cs|SC|sc)\b/g, " ")
    .replace(/\b\d+\.\d+\s+\d+\.\d+\s+\d+\.\d+\s+(rg|RG)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// AI-based PDF text extraction using Gemini vision (only for small/scanned PDFs)
async function extractTextWithAI(fileBytes: Uint8Array, apiKey: string): Promise<string> {
  // Hard cap: refuse AI extraction for files > 3MB to avoid OOM
  if (fileBytes.length > 3 * 1024 * 1024) {
    throw new Error("PDF too large for AI extraction");
  }

  const binaryStr = Array.from(fileBytes).map(b => String.fromCharCode(b)).join("");
  const base64 = btoa(binaryStr);

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
- Extract text VERBATIM
- Include page markers like [PAGE 2], [PAGE 3] etc. between pages`,
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract ALL text from this PDF document verbatim." },
            { type: "image_url", image_url: { url: `data:application/pdf;base64,${base64}` } },
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
  const basicText = extractTextBasic(fileBytes);
  console.log(`Basic extraction: ${basicText.length} chars`);

  if (basicText.length > 200) {
    // Clean PDF operators before quality check
    const cleaned = cleanExtractedText(basicText);
    const alphaCount = (cleaned.match(/[a-zA-Z0-9]/g) || []).length;
    const alphaRatio = cleaned.length > 0 ? alphaCount / cleaned.length : 0;
    console.log(`Cleaned text: ${cleaned.length} chars, alpha ratio: ${alphaRatio.toFixed(2)}`);

    if (alphaRatio > 0.8 && cleaned.length > 500 && /section|clause|standard|rule/i.test(cleaned)) {
      console.log("Basic extraction quality sufficient, skipping AI OCR");
      return { text: cleaned, pages: [cleaned] };
    }
    console.log(`Basic extraction quality insufficient (ratio: ${alphaRatio.toFixed(2)}, length: ${cleaned.length}), falling back to AI OCR`);
  }

  // Only use AI for small PDFs (< 3MB) to avoid OOM
  console.log("Attempting AI-based OCR extraction...");
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
    throw new Error("Could not extract text from this PDF.");
  }
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
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabaseUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
    const userId = user.id;

    const { standard_id } = await req.json();
    if (!standard_id) {
      return new Response(JSON.stringify({ error: "standard_id is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: standard, error: standardError } = await supabaseUser
      .from("standards").select("*").eq("id", standard_id).eq("user_id", userId).single();
    if (standardError || !standard) {
      return new Response(JSON.stringify({ error: "Standard not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await supabaseUser.from("standards").update({ extraction_status: "processing" }).eq("id", standard_id);

    const { data: fileData, error: downloadError } = await supabaseUser.storage.from("standards").download(standard.file_path!);
    if (downloadError || !fileData) {
      await supabaseUser.from("standards").update({ extraction_status: "failed" }).eq("id", standard_id);
      return new Response(JSON.stringify({ error: "Failed to download file" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      await supabaseUser.from("standards").update({ extraction_status: "failed" }).eq("id", standard_id);
      return new Response(JSON.stringify({ error: "Service unavailable" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const fileBytes = new Uint8Array(await fileData.arrayBuffer());
    let extracted: { text: string; pages: string[] };
    try {
      extracted = await extractTextFromPdf(fileBytes, LOVABLE_API_KEY);
    } catch (e) {
      console.error("Text extraction failed:", e);
      await supabaseUser.from("standards").update({ extraction_status: "failed" }).eq("id", standard_id);
      return new Response(JSON.stringify({ error: "We had trouble reading this PDF. Try a higher quality scan or a digital version." }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const qualityScore = extracted.text.length > 2000 ? 95 : extracted.text.length > 500 ? 80 : 50;
    if (qualityScore < 40 && extracted.text.length < 100) {
      await supabaseUser.from("standards").update({ extraction_status: "failed", extraction_quality_score: qualityScore }).eq("id", standard_id);
      return new Response(JSON.stringify({ error: "Text quality too low. Try a digital PDF instead of a scan." }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Step 1: Sort into sections by headings
    const sections = sortIntoSections(extracted.text, extracted.pages);
    // Step 2: Chunk each section into ~500 token pieces
    const allChunks = chunkSections(sections);
    const totalChunks = allChunks.length;

    const { data: profile } = await supabaseUser.from("profiles").select("subscription_tier").eq("user_id", userId).single();
    const tier = profile?.subscription_tier || "free";
    const isPartial = tier === "free";
    const indexLimit = isPartial ? Math.max(1, Math.ceil(totalChunks * 0.25)) : totalChunks;




    const BATCH_SIZE = 10;
    let indexedCount = 0;

    for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
      const batch = allChunks.slice(i, i + BATCH_SIZE);

      // Generate embeddings in parallel within each batch
      const embeddingResults = await Promise.all(
        batch.map(async (chunk) => {
          if (chunk.chunk_index >= indexLimit) return null;
          try {
            return await generateEmbedding(chunk.content, LOVABLE_API_KEY);
          } catch (e) {
            console.error(`Embedding failed for chunk ${chunk.chunk_index}:`, e);
            return null;
          }
        })
      );

      const chunkRecords = batch.map((chunk, idx) => {
        const embedding = embeddingResults[idx];
        const shouldIndex = chunk.chunk_index < indexLimit;
        if (shouldIndex && embedding) indexedCount++;
        return {
          standard_id,
          user_id: userId,
          clause_number: chunk.clause_number,
          clause_title: chunk.clause_title,
          content: chunk.content,
          page_number: chunk.page_number,
          chunk_index: chunk.chunk_index,
          embedding: embedding ? JSON.stringify(embedding) : null,
          is_indexed: shouldIndex && embedding !== null,
        };
      });

      const { error: chunkError } = await supabaseUser.from("standard_chunks").insert(chunkRecords);
      if (chunkError) console.error("Chunk insert error:", chunkError);
    }

    await supabaseUser.from("standards").update({
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
