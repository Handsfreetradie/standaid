import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractText } from "https://esm.sh/unpdf@0.12.0";

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGIN") || "http://localhost:8080")
  .split(",").map((o: string) => o.trim());

function getAllowedOrigin(origin: string): string {
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  if (origin.endsWith(".lovable.app") || origin.startsWith("http://localhost")) return origin;
  return ALLOWED_ORIGINS[0];
}

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

// Require: clause number + tab or 2+ spaces + capital letter
// Prevents matching "3.5 kg/m²" (single space + lowercase unit)
const CLAUSE_PATTERN = /^(\d{1,2}(?:\.\d{1,2}){0,4})\t+([A-Z][A-Za-z].*)|^(\d{1,2}(?:\.\d{1,2}){0,4})\s{2,}([A-Z][A-Za-z].*)/;

const TARGET_CHUNK_CHARS = 2000;
const MAX_CHUNK_CHARS = 2500;
const SCANNED_PAGE_THRESHOLD = 50;
const SCANNED_DOC_RATIO = 0.30;
const AI_EXTRACTION_SIZE_LIMIT = 10 * 1024 * 1024;

// ── Quality scoring ──────────────────────────────────────────────────────────

function computeQualityScore(text: string, totalPages: number, pagesWithContent: number): number {
  const pageCoverage = totalPages > 0 ? pagesWithContent / totalPages : 0;
  const clauseMatches = (text.match(/\b\d{1,2}(?:\.\d{1,2}){1,4}\b/g) || []).length;
  const clauseDensity = Math.min(clauseMatches / Math.max(text.length / 500, 1), 1);
  const alphaCount = (text.match(/[a-zA-Z]/g) || []).length;
  const alphaRatio = text.length > 0 ? alphaCount / text.length : 0;

  const score = Math.round(
    (pageCoverage * 40) +
    (clauseDensity * 30) +
    (Math.min(alphaRatio * 1.2, 1) * 30)
  );
  return Math.min(score, 100);
}

// ── PDF extraction ───────────────────────────────────────────────────────────

async function extractTextWithAI(fileBytes: Uint8Array, apiKey: string): Promise<string> {
  if (fileBytes.length > AI_EXTRACTION_SIZE_LIMIT) {
    throw new Error("PDF too large for AI extraction (limit: 10MB)");
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

async function extractTextFromPdf(
  fileBytes: Uint8Array,
  apiKey: string
): Promise<{ text: string; pages: string[]; totalPages: number; pagesWithContent: number }> {
  // Use unpdf to extract text page-by-page
  let pageTexts: string[] = [];
  let unpdfFailed = false;

  try {
    const result = await extractText(fileBytes, { mergePages: false });
    // unpdf returns { text: string[] } when mergePages is false
    pageTexts = Array.isArray(result.text) ? result.text : [result.text as unknown as string];
    console.log(`unpdf extracted ${pageTexts.length} pages`);
  } catch (e) {
    console.error("unpdf extraction failed:", e);
    unpdfFailed = true;
  }

  const totalPages = pageTexts.length || 1;

  if (!unpdfFailed && pageTexts.length > 0) {
    // Assess how many pages have real content
    const scannedPages: number[] = [];
    const contentPages: number[] = [];

    pageTexts.forEach((pageText, idx) => {
      if (pageText.trim().length < SCANNED_PAGE_THRESHOLD) {
        scannedPages.push(idx);
      } else {
        contentPages.push(idx);
      }
    });

    const scannedRatio = scannedPages.length / totalPages;
    console.log(`Pages: ${totalPages} total, ${contentPages.length} with content, ${scannedPages.length} scanned (ratio: ${scannedRatio.toFixed(2)})`);

    if (scannedRatio <= SCANNED_DOC_RATIO) {
      // Mostly digital PDF — use unpdf output directly
      const pages = pageTexts.map((t, i) => (t.trim().length > 0 ? t : ""));
      const fullText = pages
        .map((t, i) => (t.trim().length > 0 ? `\n[PAGE ${i + 1}]\n${t}` : ""))
        .join("")
        .trim();

      console.log(`unpdf result accepted: ${fullText.length} chars, ${contentPages.length}/${totalPages} pages with content`);
      return {
        text: fullText,
        pages,
        totalPages,
        pagesWithContent: contentPages.length,
      };
    }

    console.log(`Scanned document (${Math.round(scannedRatio * 100)}% pages below threshold), falling back to AI OCR`);
  }

  // Fallback: AI OCR for scanned documents or unpdf failure
  if (fileBytes.length > AI_EXTRACTION_SIZE_LIMIT) {
    throw new Error("PDF too large for AI extraction and text extraction failed.");
  }

  console.log("Attempting AI-based OCR extraction...");
  try {
    const aiText = await extractTextWithAI(fileBytes, apiKey);
    console.log(`AI extraction: ${aiText.length} chars`);

    const pageMarkerRegex = /\[PAGE\s+\d+\]/gi;
    const aiPages = aiText.split(pageMarkerRegex).filter(p => p.trim().length > 0);
    const resolvedPages = aiPages.length > 1 ? aiPages : [aiText];

    return {
      text: aiText.replace(pageMarkerRegex, "\n\n").trim(),
      pages: resolvedPages,
      totalPages: resolvedPages.length,
      pagesWithContent: resolvedPages.filter(p => p.trim().length >= SCANNED_PAGE_THRESHOLD).length,
    };
  } catch (aiError) {
    console.error("AI extraction failed:", aiError);

    // Last resort: if unpdf gave us something, use it even if partial
    if (!unpdfFailed && pageTexts.length > 0) {
      const fallbackText = pageTexts.join("\n\n").trim();
      if (fallbackText.length > 50) {
        console.log("Using partial unpdf output as last resort");
        const pagesWithContent = pageTexts.filter(p => p.trim().length >= SCANNED_PAGE_THRESHOLD).length;
        return {
          text: fallbackText,
          pages: pageTexts,
          totalPages,
          pagesWithContent,
        };
      }
    }

    throw new Error("Could not extract text from this PDF.");
  }
}

// ── Sectioning ───────────────────────────────────────────────────────────────

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
      if (current.lines.length > 0) sections.push({ ...current });
      current = { heading: line.trim(), clauseNumber: null, lines: [line], pageNumber: currentPage };
    } else if (clauseMatch) {
      if (current.lines.length > 0) sections.push({ ...current });
      // Groups: [1]=number (tab variant), [2]=title (tab variant), [3]=number (space variant), [4]=title (space variant)
      const clauseNumber = clauseMatch[1] || clauseMatch[3];
      const clauseTitle = (clauseMatch[2] || clauseMatch[4] || "").trim();
      current = {
        heading: clauseTitle,
        clauseNumber,
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

// ── Chunking with overlap and breadcrumb context ─────────────────────────────

function buildBreadcrumb(standardCode: string, version: string, clauseNumber: string | null, clauseTitle: string | null): string {
  const clausePart = clauseNumber
    ? `Clause ${clauseNumber}${clauseTitle ? `: ${clauseTitle}` : ""}`
    : clauseTitle || "";
  return `[${standardCode}${version ? ` ${version}` : ""}]${clausePart ? ` ${clausePart}` : ""}\n\n`;
}

function getOverlapTail(text: string, approxChars = 200): string {
  if (text.length <= approxChars) return text;
  // Find the last sentence boundary before approxChars from end
  const tail = text.slice(-approxChars);
  const sentenceBreak = tail.search(/(?<=[.!?])\s/);
  return sentenceBreak > -1 ? tail.slice(sentenceBreak).trimStart() : tail;
}

function chunkSections(sections: Section[], standardCode: string, version: string): Chunk[] {
  const chunks: Chunk[] = [];
  let chunkIndex = 0;

  for (const section of sections) {
    const sectionText = section.lines.join("\n").trim();
    if (sectionText.length < 20) continue;

    const breadcrumb = buildBreadcrumb(standardCode, version, section.clauseNumber, section.heading);

    if (sectionText.length <= MAX_CHUNK_CHARS) {
      chunks.push({
        clause_number: section.clauseNumber,
        clause_title: section.heading,
        content: breadcrumb + sectionText,
        page_number: section.pageNumber,
        chunk_index: chunkIndex++,
      });
    } else {
      // Split on paragraph boundaries with overlap carry-forward
      const paragraphs = sectionText.split(/\n\s*\n/);
      let buffer = "";
      let prevTail = "";

      for (const para of paragraphs) {
        if (buffer.length + para.length + 2 > TARGET_CHUNK_CHARS && buffer.length > 0) {
          prevTail = getOverlapTail(buffer);
          chunks.push({
            clause_number: section.clauseNumber,
            clause_title: section.heading,
            content: breadcrumb + buffer.trim(),
            page_number: section.pageNumber,
            chunk_index: chunkIndex++,
          });
          // Start next chunk with overlap from previous
          buffer = prevTail ? `[...continued from above]\n${prevTail}\n\n${para}` : para;
        } else {
          buffer += (buffer ? "\n\n" : "") + para;
        }
      }

      if (buffer.trim().length > 20) {
        chunks.push({
          clause_number: section.clauseNumber,
          clause_title: section.heading,
          content: breadcrumb + buffer.trim(),
          page_number: section.pageNumber,
          chunk_index: chunkIndex++,
        });
      }
    }
  }

  // Fallback if nothing was detected
  if (chunks.length === 0) {
    const fullText = sections.map(s => s.lines.join("\n")).join("\n");
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

// ── Batched embeddings with retry ────────────────────────────────────────────

async function generateEmbeddingsBatch(texts: string[], apiKey: string): Promise<(number[] | null)[]> {
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: texts.map(t => t.slice(0, 8000)),
        }),
      });
      if (response.status === 429) {
        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
        continue;
      }
      if (!response.ok) throw new Error(`Embedding API error: ${response.status}`);
      const data = await response.json();
      return data.data.map((d: any) => d.embedding);
    } catch (e) {
      if (attempt === MAX_RETRIES - 1) {
        return texts.map(() => null);
      }
      await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
    }
  }
  return texts.map(() => null);
}

// ── Main handler ─────────────────────────────────────────────────────────────

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

    // Mark job as processing
    await supabaseUser.from("processing_jobs")
      .update({ status: "processing", started_at: new Date().toISOString() })
      .eq("standard_id", standard_id)
      .eq("status", "pending");

    await supabaseUser.from("standards").update({ extraction_status: "processing" }).eq("id", standard_id);

    const { data: fileData, error: downloadError } = await supabaseUser.storage.from("standards").download(standard.file_path!);
    if (downloadError || !fileData) {
      await supabaseUser.from("standards").update({ extraction_status: "failed" }).eq("id", standard_id);
      await supabaseUser.from("processing_jobs")
        .update({ status: "failed", error_message: "Failed to download file", completed_at: new Date().toISOString() })
        .eq("standard_id", standard_id);
      return new Response(JSON.stringify({ error: "Failed to download file" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      await supabaseUser.from("standards").update({ extraction_status: "failed" }).eq("id", standard_id);
      await supabaseUser.from("processing_jobs")
        .update({ status: "failed", error_message: "Service unavailable", completed_at: new Date().toISOString() })
        .eq("standard_id", standard_id);
      return new Response(JSON.stringify({ error: "Service unavailable" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const fileBytes = new Uint8Array(await fileData.arrayBuffer());
    let extracted: { text: string; pages: string[]; totalPages: number; pagesWithContent: number };
    try {
      extracted = await extractTextFromPdf(fileBytes, LOVABLE_API_KEY);
    } catch (e) {
      console.error("Text extraction failed:", e);
      await supabaseUser.from("standards").update({ extraction_status: "failed" }).eq("id", standard_id);
      await supabaseUser.from("processing_jobs")
        .update({ status: "failed", error_message: String(e), completed_at: new Date().toISOString() })
        .eq("standard_id", standard_id);
      return new Response(JSON.stringify({ error: "We had trouble reading this PDF. Try a higher quality scan or a digital version." }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const qualityScore = computeQualityScore(extracted.text, extracted.totalPages, extracted.pagesWithContent);
    console.log(`Quality score: ${qualityScore} (${extracted.pagesWithContent}/${extracted.totalPages} pages with content)`);

    if (qualityScore < 40 && extracted.text.length < 100) {
      await supabaseUser.from("standards").update({ extraction_status: "failed", extraction_quality_score: qualityScore }).eq("id", standard_id);
      await supabaseUser.from("processing_jobs")
        .update({ status: "failed", error_message: "Text quality too low", completed_at: new Date().toISOString() })
        .eq("standard_id", standard_id);
      return new Response(JSON.stringify({ error: "Text quality too low. Try a digital PDF instead of a scan." }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const standardCode = standard.standard_code || "Unknown";
    const version = standard.version || "";

    const sections = sortIntoSections(extracted.text, extracted.pages);
    const allChunks = chunkSections(sections, standardCode, version);
    const totalChunks = allChunks.length;

    const { data: profile } = await supabaseUser.from("profiles").select("subscription_tier").eq("user_id", userId).single();
    const tier = profile?.subscription_tier || "free";
    const isPartial = tier === "free";
    const indexLimit = isPartial ? Math.max(1, Math.ceil(totalChunks * 0.25)) : totalChunks;

    const EMBED_BATCH_SIZE = 20;
    const DB_BATCH_SIZE = 10;
    let indexedCount = 0;

    // Pre-compute embeddings in batches of 20
    const embeddingMap = new Map<number, number[] | null>();

    const chunksToEmbed = allChunks.filter(c => c.chunk_index < indexLimit);
    for (let i = 0; i < chunksToEmbed.length; i += EMBED_BATCH_SIZE) {
      const batch = chunksToEmbed.slice(i, i + EMBED_BATCH_SIZE);
      const embeddings = await generateEmbeddingsBatch(batch.map(c => c.content), LOVABLE_API_KEY);
      batch.forEach((chunk, idx) => {
        embeddingMap.set(chunk.chunk_index, embeddings[idx]);
      });
    }

    // Insert into DB in batches of 10
    for (let i = 0; i < allChunks.length; i += DB_BATCH_SIZE) {
      const batch = allChunks.slice(i, i + DB_BATCH_SIZE);

      const chunkRecords = batch.map(chunk => {
        const shouldIndex = chunk.chunk_index < indexLimit;
        const embedding = shouldIndex ? (embeddingMap.get(chunk.chunk_index) ?? null) : null;
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

    await supabaseUser.from("processing_jobs")
      .update({ status: "complete", completed_at: new Date().toISOString() })
      .eq("standard_id", standard_id);

    return new Response(JSON.stringify({ status: "complete", total_chunks: totalChunks, indexed_chunks: indexedCount, quality_score: qualityScore, is_partial: isPartial }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Processing error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
