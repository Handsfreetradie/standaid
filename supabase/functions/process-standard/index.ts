import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractText } from "https://esm.sh/unpdf@0.12.0";

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGIN") || "http://localhost:8080")
  .split(",").map((o: string) => o.trim());

function getAllowedOrigin(origin: string): string {
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  if (origin.endsWith(".lovable.app") || origin.endsWith(".lovableproject.com") || origin.startsWith("http://localhost")) return origin;
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

// Require: clause number + whitespace + capital letter + alpha char
// Relaxed from 2+ spaces to 1+ spaces so AI OCR output (single space) also matches.
// The [A-Z][A-Za-z] guard already prevents unit matches like "3.5 kg/m²" (lowercase k).
const CLAUSE_PATTERN = /^(\d{1,2}(?:\.\d{1,2}){0,4})\t+([A-Z][A-Za-z].*)|^(\d{1,2}(?:\.\d{1,2}){0,4})\s+([A-Z][A-Za-z].*)/;

const TARGET_CHUNK_CHARS = 2000;
const MAX_CHUNK_CHARS = 2500;
const SCANNED_PAGE_THRESHOLD = 15;
const SCANNED_DOC_RATIO = 0.85;
const AI_EXTRACTION_SIZE_LIMIT = 10 * 1024 * 1024;

// Mark jobs as failed if processing exceeds this — must be under Supabase's 150s limit.
const PROCESSING_TIMEOUT_MS = 110_000;

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

// ── Client-provided text parsing ─────────────────────────────────────────────

function parseExtractedText(rawText: string): { text: string; pages: string[]; totalPages: number; pagesWithContent: number } {
  // Split on [PAGE N] markers inserted by client-side PDF.js extraction
  const pageRegex = /\[PAGE \d+\]\n?([\s\S]*?)(?=\n?\[PAGE \d+\]|$)/g;
  const pages: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pageRegex.exec(rawText)) !== null) {
    pages.push(match[1] || "");
  }

  const finalPages = pages.length > 0 ? pages : [rawText];
  const cleanText = rawText.replace(/\[PAGE \d+\]/g, "").trim();
  const pagesWithContent = finalPages.filter(p => p.trim().length >= SCANNED_PAGE_THRESHOLD).length;

  return {
    text: cleanText,
    pages: finalPages,
    totalPages: finalPages.length,
    pagesWithContent,
  };
}

// ── PDF extraction ───────────────────────────────────────────────────────────

async function extractTextWithAI(fileBytes: Uint8Array, openaiApiKey: string): Promise<string> {
  const authHeader = { "Authorization": `Bearer ${openaiApiKey}` };

  // Step 1: Upload the PDF to the OpenAI Files API
  const formData = new FormData();
  formData.append("file", new Blob([fileBytes as BlobPart], { type: "application/pdf" }), "document.pdf");
  formData.append("purpose", "user_data");

  const uploadResponse = await fetch("https://api.openai.com/v1/files", {
    method: "POST",
    headers: authHeader,
    body: formData,
  });

  if (!uploadResponse.ok) {
    const errText = await uploadResponse.text();
    console.error("OpenAI file upload error:", uploadResponse.status, errText);
    throw new Error(`AI extraction failed: file upload returned ${uploadResponse.status}`);
  }

  const uploadData = await uploadResponse.json();
  const fileId: string = uploadData.id;
  console.log(`Uploaded PDF to OpenAI Files API, file_id: ${fileId}`);

  let extractedText: string;

  try {
    // Step 2: Call Chat Completions with the file_id reference
    const extractionPrompt = `This is a technical standards document that has been uploaded by a licensed tradesperson for compliance reference purposes. Transcribe all technical content from this document including:
- All clause numbers and headings (e.g. 1.1, 1.1.1, 2.3.4)
- All technical requirements, specifications, and values
- All tables as readable text
- All notes and informative sections
- Insert page markers like [PAGE 2], [PAGE 3] between pages
- Format clause headings as: "1.1 Title" (number, space, title)
Transcribe completely and accurately. Do not summarise or skip any technical content.`;

    const completionResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { ...authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "file",
                file: { file_id: fileId },
              },
              {
                type: "text",
                text: extractionPrompt,
              },
            ],
          },
        ],
        max_tokens: 64000,
      }),
    });

    if (!completionResponse.ok) {
      const errText = await completionResponse.text();
      console.error("AI extraction error:", completionResponse.status, errText);
      throw new Error(`AI extraction failed: ${completionResponse.status}`);
    }

    const data = await completionResponse.json();
    extractedText = data.choices?.[0]?.message?.content;
    if (!extractedText || extractedText.length < 50) {
      throw new Error("AI extraction returned insufficient text");
    }
  } finally {
    // Step 3: Clean up — delete the uploaded file regardless of success or failure
    try {
      await fetch(`https://api.openai.com/v1/files/${fileId}`, {
        method: "DELETE",
        headers: authHeader,
      });
      console.log(`Deleted OpenAI file: ${fileId}`);
    } catch (cleanupErr) {
      console.warn(`Failed to delete OpenAI file ${fileId}:`, cleanupErr);
    }
  }

  return extractedText;
}

async function extractTextFromPdf(
  fileBytes: Uint8Array,
  openaiApiKey: string
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

  // If unpdf gave us something useful, prefer it over Gemini to avoid quota issues
  if (!unpdfFailed && pageTexts.length > 0) {
    const fallbackText = pageTexts.join("\n\n").trim();
    if (fallbackText.length > 50) {
      console.log(`Using unpdf output (${fallbackText.length} chars) — skipping AI OCR`);
      const pagesWithContent = pageTexts.filter(p => p.trim().length >= SCANNED_PAGE_THRESHOLD).length;
      return {
        text: fallbackText,
        pages: pageTexts,
        totalPages,
        pagesWithContent,
      };
    }
  }

  // Only try Gemini AI OCR if unpdf returned nothing at all (truly unreadable PDF)
  if (fileBytes.length > AI_EXTRACTION_SIZE_LIMIT) {
    throw new Error("PDF too large for AI extraction and text extraction failed.");
  }

  console.log("Attempting AI-based OCR extraction (unpdf returned nothing)...");
  try {
    const aiText = await extractTextWithAI(fileBytes, openaiApiKey);
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
      const response = await fetch("https://api.openai.com/v1/embeddings", {
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
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Admin client bypasses RLS — used for all DB writes so they survive JWT expiry
  // and can always mark jobs as failed on timeout/error.
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let standard_id: string | null = null;
  let timeoutHandle: number | null = null;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const body = await req.json();
    standard_id = body.standard_id;
    const clientExtractedText: string | null = body.extracted_text || null;
    if (!standard_id) {
      return new Response(JSON.stringify({ error: "standard_id is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Support two call patterns:
    // 1. Internal call from upload-standard: uses service role key + passes user_id in body
    // 2. Direct user call: uses user JWT for auth
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const isInternalCall = authHeader === `Bearer ${serviceRoleKey}`;

    let userId: string;
    if (isInternalCall) {
      // Trusted internal call — user_id comes from the request body
      if (!body.user_id) {
        return new Response(JSON.stringify({ error: "user_id required for internal calls" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      userId = body.user_id;
    } else {
      // Direct user call — verify JWT
      const token = authHeader.replace("Bearer ", "");
      const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
      if (userError || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
      }
      userId = user.id;
    }

    const { data: standard, error: standardError } = await supabaseAdmin
      .from("standards").select("*").eq("id", standard_id).eq("user_id", userId).single();
    if (standardError || !standard) {
      return new Response(JSON.stringify({ error: "Standard not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Set up timeout — fires at 110s so we can clean up before Supabase kills the function at 150s
    timeoutHandle = setTimeout(async () => {
      console.error(`Processing timeout for standard ${standard_id}`);
      await supabaseAdmin.from("processing_jobs")
        .update({ status: "failed", error_message: "Processing timed out. Try a smaller or simpler PDF.", completed_at: new Date().toISOString() })
        .eq("standard_id", standard_id!)
        .eq("status", "processing");
      await supabaseAdmin.from("standards")
        .update({ extraction_status: "failed" })
        .eq("id", standard_id!);
    }, PROCESSING_TIMEOUT_MS) as unknown as number;

    // Mark job as processing
    await supabaseAdmin.from("processing_jobs")
      .update({ status: "processing", started_at: new Date().toISOString() })
      .eq("standard_id", standard_id)
      .eq("status", "pending");

    await supabaseAdmin.from("standards").update({ extraction_status: "processing" }).eq("id", standard_id);

    const t0 = Date.now();

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      clearTimeout(timeoutHandle);
      await supabaseAdmin.from("standards").update({ extraction_status: "failed" }).eq("id", standard_id);
      await supabaseAdmin.from("processing_jobs")
        .update({ status: "failed", error_message: "Service unavailable", completed_at: new Date().toISOString() })
        .eq("standard_id", standard_id);
      return new Response(JSON.stringify({ error: "Service unavailable" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let extracted: { text: string; pages: string[]; totalPages: number; pagesWithContent: number };

    if (clientExtractedText && clientExtractedText.length > 100) {
      // Use pre-extracted text from the browser — bypasses server-side DRM decryption issues
      console.log(`[${standard_id}] Using client-extracted text: ${clientExtractedText.length} chars`);
      extracted = parseExtractedText(clientExtractedText);
      console.log(`[${standard_id}] Parsed: ${extracted.totalPages} pages, ${extracted.pagesWithContent} with content`);
    } else {
      // Fall back to server-side extraction (unpdf → AI OCR)
      console.log(`[${standard_id}] Starting download (no client text provided)`);
      const { data: fileData, error: downloadError } = await supabaseAdmin.storage.from("standards").download(standard.file_path!);
      if (downloadError || !fileData) {
        clearTimeout(timeoutHandle);
        await supabaseAdmin.from("standards").update({ extraction_status: "failed" }).eq("id", standard_id);
        await supabaseAdmin.from("processing_jobs")
          .update({ status: "failed", error_message: "Failed to download file", completed_at: new Date().toISOString() })
          .eq("standard_id", standard_id);
        return new Response(JSON.stringify({ error: "Failed to download file" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      console.log(`[${standard_id}] Download done: ${Date.now() - t0}ms`);

      const fileBytes = new Uint8Array(await fileData.arrayBuffer());
      console.log(`[${standard_id}] File size: ${fileBytes.length} bytes, starting extraction`);
      try {
        extracted = await extractTextFromPdf(fileBytes, OPENAI_API_KEY);
      } catch (e) {
        console.error("Text extraction failed:", e);
        clearTimeout(timeoutHandle);
        await supabaseAdmin.from("standards").update({ extraction_status: "failed" }).eq("id", standard_id);
        await supabaseAdmin.from("processing_jobs")
          .update({ status: "failed", error_message: String(e), completed_at: new Date().toISOString() })
          .eq("standard_id", standard_id);
        return new Response(JSON.stringify({ error: "We had trouble reading this PDF. Try a higher quality scan or a digital version." }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }
    console.log(`[${standard_id}] Extraction done: ${Date.now() - t0}ms, ${extracted.text.length} chars`);

    const qualityScore = computeQualityScore(extracted.text, extracted.totalPages, extracted.pagesWithContent);
    console.log(`Quality score: ${qualityScore} (${extracted.pagesWithContent}/${extracted.totalPages} pages with content)`);

    if (qualityScore < 40 && extracted.text.length < 100) {
      clearTimeout(timeoutHandle);
      await supabaseAdmin.from("standards").update({ extraction_status: "failed", extraction_quality_score: qualityScore }).eq("id", standard_id);
      await supabaseAdmin.from("processing_jobs")
        .update({ status: "failed", error_message: "Text quality too low", completed_at: new Date().toISOString() })
        .eq("standard_id", standard_id);
      return new Response(JSON.stringify({ error: "Text quality too low. Try a digital PDF instead of a scan." }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const standardCode = standard.standard_code || "Unknown";
    const version = standard.version || "";

    const sections = sortIntoSections(extracted.text, extracted.pages);
    const allChunks = chunkSections(sections, standardCode, version);
    const totalChunks = allChunks.length;
    console.log(`[${standard_id}] Chunking done: ${Date.now() - t0}ms, ${totalChunks} chunks`);

    const { data: profile } = await supabaseAdmin.from("profiles").select("subscription_tier").eq("user_id", userId).single();
    const tier = profile?.subscription_tier || "free";
    const isPartial = tier === "free";
    const indexLimit = isPartial ? Math.max(1, Math.ceil(totalChunks * 0.25)) : totalChunks;

    const EMBED_BATCH_SIZE = 50;
    const PARALLEL_EMBED = 3;
    const DB_BATCH_SIZE = 100;
    let indexedCount = 0;

    // Pre-compute embeddings — parallel batches of 50, 3 at a time
    const embeddingMap = new Map<number, number[] | null>();

    const chunksToEmbed = allChunks.filter(c => c.chunk_index < indexLimit);
    console.log(`[${standard_id}] Embedding ${chunksToEmbed.length} chunks (indexLimit: ${indexLimit})`);
    const embedBatches: typeof chunksToEmbed[] = [];
    for (let i = 0; i < chunksToEmbed.length; i += EMBED_BATCH_SIZE) {
      embedBatches.push(chunksToEmbed.slice(i, i + EMBED_BATCH_SIZE));
    }
    for (let i = 0; i < embedBatches.length; i += PARALLEL_EMBED) {
      const group = embedBatches.slice(i, i + PARALLEL_EMBED);
      const results = await Promise.all(
        group.map(batch => generateEmbeddingsBatch(batch.map(c => c.content), OPENAI_API_KEY))
      );
      group.forEach((batch, gi) => {
        batch.forEach((chunk, idx) => {
          embeddingMap.set(chunk.chunk_index, results[gi][idx]);
        });
      });
      console.log(`[${standard_id}] Embed group ${Math.floor(i / PARALLEL_EMBED) + 1} done: ${Date.now() - t0}ms`);
    }
    console.log(`[${standard_id}] All embeddings done: ${Date.now() - t0}ms`);

    // Insert into DB in batches of 100
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

      const { error: chunkError } = await supabaseAdmin.from("standard_chunks").insert(chunkRecords);
      if (chunkError) console.error(`Chunk insert error (batch ${i / DB_BATCH_SIZE}):`, chunkError);
      else console.log(`[${standard_id}] DB insert batch ${Math.floor(i / DB_BATCH_SIZE) + 1} done: ${Date.now() - t0}ms`);
    }

    console.log(`[${standard_id}] All inserts done: ${Date.now() - t0}ms`);
    clearTimeout(timeoutHandle);

    await supabaseAdmin.from("standards").update({
      extraction_status: "complete",
      extraction_quality_score: qualityScore,
      is_partial: isPartial,
      total_chunks: totalChunks,
      indexed_chunks: indexedCount,
    }).eq("id", standard_id);

    await supabaseAdmin.from("processing_jobs")
      .update({ status: "complete", completed_at: new Date().toISOString() })
      .eq("standard_id", standard_id);

    return new Response(JSON.stringify({ status: "complete", total_chunks: totalChunks, indexed_chunks: indexedCount, quality_score: qualityScore, is_partial: isPartial }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Processing error:", e);
    if (timeoutHandle !== null) clearTimeout(timeoutHandle);
    if (standard_id) {
      await supabaseAdmin.from("processing_jobs")
        .update({ status: "failed", error_message: e instanceof Error ? e.message : "Unknown error", completed_at: new Date().toISOString() })
        .eq("standard_id", standard_id)
        .in("status", ["pending", "processing"]);
      await supabaseAdmin.from("standards")
        .update({ extraction_status: "failed" })
        .eq("id", standard_id);
    }
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
