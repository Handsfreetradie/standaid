import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractText } from "https://esm.sh/unpdf@0.12.0";
import { getAllowedOrigin } from "../_shared/cors.ts";

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

// Detect encoding corruption common in SAI Global / licensed PDFs.
// Symptoms: Ω glyph swallows adjacent digits → "0.5 Ω" becomes "0. "
// and custom fonts drop characters like "AS" from "AS/NZS".
function hasGoodTextQuality(text: string): boolean {
  if (text.length < 300) return false;

  const digits = (text.match(/\d/g) || []).length;
  const letters = (text.match(/[a-zA-Z]/g) || []).length;
  if (letters === 0) return false;

  // Technical standards should have at least 3% digit density vs letters
  if (digits / letters < 0.03) return false;

  // Count truncated decimals: digit followed by period then whitespace/end-of-line
  // e.g. "0. " or "3.\n" — these indicate a digit was swallowed by a glyph
  const truncated = (text.match(/\d\.(?:\s|$)/gm) || []).length;
  const normal = (text.match(/\d\.\d/g) || []).length;
  const totalDecimals = truncated + normal;

  // If >15% of decimal-point sequences look truncated, fall back to batched AI OCR.
  // The batched AI approach now processes pages in groups of 15 so there's no
  // truncation — it's safe to use for any document size.
  if (totalDecimals > 4 && truncated / totalDecimals > 0.15) {
    console.log(`Text quality check FAILED: ${truncated}/${totalDecimals} decimal sequences appear truncated`);
    return false;
  }

  return true;
}

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

const PAGES_PER_AI_BATCH = 15; // pages per gpt-4o call — stays well within 8k token output limit

function convertPdfToBase64(fileBytes: Uint8Array): string {
  const binary = String.fromCharCode(...fileBytes);
  return btoa(binary);
}

// Batched page-by-page AI OCR — sends PAGES_PER_AI_BATCH pages at a time so
// long documents are never truncated. Reads the PDF visually so special characters
// like Ω are transcribed correctly rather than corrupted by font encoding.
async function extractTextWithAI(fileBytes: Uint8Array, anthropicApiKey: string, totalPages = 0): Promise<string> {
  const base64Pdf = convertPdfToBase64(fileBytes);

  const batchCount = totalPages > 0
    ? Math.ceil(totalPages / PAGES_PER_AI_BATCH)
    : 1; // unknown page count — try single call first

  const batchPrompt = (start: number, end: number) =>
    `This is an Australian/New Zealand technical Standards document. ` +
    `Transcribe ONLY pages ${start} to ${end} completely and accurately. ` +
    `Include every clause number, heading, value, table, note, and figure caption exactly as written. ` +
    `Format: clause headings as "X.X HEADING TITLE" on their own line. ` +
    `Figure captions as "Figure X.X — Caption text" on their own line. ` +
    `Insert [PAGE N] at the start of each page. ` +
    `Do NOT summarise, paraphrase, or skip any content. ` +
    `Pay special attention to numerical values and units (e.g. 0.5 Ω, 1 MΩ, 500 V).`;

  let fullText = "";

  for (let batch = 0; batch < batchCount; batch++) {
    const startPage = batch * PAGES_PER_AI_BATCH + 1;
    const endPage = totalPages > 0
      ? Math.min((batch + 1) * PAGES_PER_AI_BATCH, totalPages)
      : 9999; // open-ended for unknown page count

    const prompt = totalPages > 0
      ? batchPrompt(startPage, endPage)
      : `This is an Australian/New Zealand technical Standards document. Transcribe ALL content completely and accurately. Include every clause number, heading, value, table, note, and figure caption exactly as written. Format clause headings as "X.X HEADING" on their own line. Insert [PAGE N] markers between pages. Do NOT summarise or skip anything. Pay special attention to numerical values and units (e.g. 0.5 Ω, 1 MΩ, 500 V).`;

    console.log(`AI OCR batch ${batch + 1}/${batchCount}: pages ${startPage}–${endPage}`);

    const completionResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": anthropicApiKey, "Content-Type": "application/json", "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-opus-4-8",
        max_tokens: 8000,
        messages: [{
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64Pdf } },
            { type: "text", text: prompt },
          ],
        }],
      }),
    });

    if (!completionResponse.ok) {
      const errText = await completionResponse.text();
      console.error(`AI OCR batch ${batch + 1} failed:`, completionResponse.status, errText);
      if (batch === 0) throw new Error(`AI extraction failed: ${completionResponse.status}`);
      break; // partial extraction is better than nothing
    }

    const data = await completionResponse.json();
    const batchText: string = data.content?.[0]?.text || "";
    if (batchText.length < 50) {
      console.warn(`AI OCR batch ${batch + 1} returned very little text — stopping`);
      break;
    }

    fullText += (batch > 0 ? "\n\n" : "") + batchText;
    console.log(`Batch ${batch + 1} extracted: ${batchText.length} chars`);
  }

  if (fullText.length < 50) throw new Error("AI extraction returned insufficient text");
  console.log(`Total AI OCR extraction: ${fullText.length} chars across ${batchCount} batch(es)`);
  return fullText;
}


async function extractTextFromPdf(
  fileBytes: Uint8Array,
  anthropicApiKey: string
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
      // Mostly digital PDF — check text quality before accepting unpdf output
      const pages = pageTexts.map((t, i) => (t.trim().length > 0 ? t : ""));
      const fullText = pages
        .map((t, i) => (t.trim().length > 0 ? `\n[PAGE ${i + 1}]\n${t}` : ""))
        .join("")
        .trim();

      if (hasGoodTextQuality(fullText)) {
        console.log(`unpdf result accepted: ${fullText.length} chars, ${contentPages.length}/${totalPages} pages with content`);
        return {
          text: fullText,
          pages,
          totalPages,
          pagesWithContent: contentPages.length,
        };
      }

      console.log(`unpdf text quality check failed (likely SAI Global font encoding issue) — falling back to AI OCR`);
    } else {
      console.log(`Scanned document (${Math.round(scannedRatio * 100)}% pages below threshold), falling back to AI OCR`);
    }
  }

  // Only try AI OCR if unpdf failed or produced corrupted text
  if (fileBytes.length > AI_EXTRACTION_SIZE_LIMIT) {
    throw new Error("PDF too large for AI extraction and text extraction failed.");
  }

  // Use batched page-by-page AI OCR so long documents aren't truncated.
  // Pass the known page count from unpdf so we can batch correctly.
  const knownPageCount = pageTexts.length > 0 ? pageTexts.length : 0;
  console.log(`Attempting batched AI OCR (${knownPageCount > 0 ? knownPageCount + " pages" : "unknown length"})...`);
  try {
    const aiText = await extractTextWithAI(fileBytes, anthropicApiKey, knownPageCount);
    console.log(`Batched AI OCR complete: ${aiText.length} chars`);

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
    console.error("Batched AI OCR failed:", aiError);
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

// ── Table extraction ─────────────────────────────────────────────────────────

function extractTableChunks(text: string, standardCode: string, version: string): Chunk[] {
  const chunks: Chunk[] = [];
  const lines = text.split("\n");
  const tablePattern = /TABLE\s+(\d+(?:\.\d+)*)(.*)?/i;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(tablePattern);
    if (!match) continue;

    const tableNumber = match[1].trim();
    const title = (match[2] || "").replace(/^[\s—\-:]+/, "").trim();

    // Grab up to ~500 chars of surrounding content (next lines)
    let surrounding = "";
    let charCount = 0;
    for (let j = i + 1; j < lines.length && charCount < 500; j++) {
      surrounding += lines[j] + "\n";
      charCount += lines[j].length + 1;
    }

    const label = `[${standardCode}${version ? ` ${version}` : ""}]`;
    const content = `${label} Table ${tableNumber}${title ? `: ${title}` : ""}\n\n${surrounding.trim()}`;

    chunks.push({
      clause_number: `TABLE ${tableNumber}`,
      clause_title: title || null,
      content,
      page_number: 1,
      chunk_index: 0, // will be reassigned after merge
    });
  }

  return chunks;
}

// ── Figure extraction ─────────────────────────────────────────────────────────

function extractFigureChunks(text: string, standardCode: string, version: string): Chunk[] {
  const chunks: Chunk[] = [];
  const seenFigures = new Set<string>();
  const label = `[${standardCode}${version ? ` ${version}` : ""}]`;
  const lines = text.split("\n");

  // Build page map from [PAGE N] markers
  const pageMarkerRegex = /\[PAGE\s+(\d+)\]/gi;
  const pageMap: { charPos: number; page: number }[] = [];
  let pm: RegExpExecArray | null;
  while ((pm = pageMarkerRegex.exec(text)) !== null) {
    pageMap.push({ charPos: pm.index, page: parseInt(pm[1], 10) });
  }
  const pageOffsets: number[] = [];
  let off = 0;
  for (const line of lines) { pageOffsets.push(off); off += line.length + 1; }
  function getPage(lineIdx: number): number {
    const charPos = pageOffsets[lineIdx] || 0;
    let page = 1;
    for (const entry of pageMap) { if (entry.charPos <= charPos) page = entry.page; else break; }
    return page;
  }

  // ── Pass 1: Find figures with captions on their own line ──────────────────
  // e.g. "Figure 3.1 — Resistance test of main earthing conductor"
  // e.g. "FIGURE 1 CAPTION TEXT" (Claude format — no dash)
  // e.g. "**Figure 3.1 — Caption**" (AI OCR markdown)
  const captionLinePattern = /^(?:\*{0,2})FIGURE\s+(\d+(?:\.\d+)*)\s*(?:—|–|-|:)?\s*(.*)$/i;

  // Debug: log all lines that contain "figure" to diagnose format issues
  const figureLineMatches: string[] = [];
  lines.forEach((line, idx) => {
    if (/figure/i.test(line)) {
      figureLineMatches.push(`Line ${idx}: "${line.substring(0, 100)}"`);
    }
  });
  if (figureLineMatches.length > 0) {
    console.log(`[${label}] DEBUG: Lines containing 'figure':\n${figureLineMatches.join('\n')}`);
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, "").trim();
    const match = line.match(captionLinePattern);
    if (!match) continue;
    const figNum = match[1].trim();
    if (seenFigures.has(figNum)) continue;
    let caption = (match[2] || "").trim().replace(/\*+$/, "");
    // If no caption on this line, try the next non-empty line
    if (!caption) {
      for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
        const next = lines[j].replace(/\r$/, "").trim();
        if (next && !/^\d+\.\d/.test(next) && next.length < 120) {
          caption = next.replace(/^[—\-–:]+\s*/, "").trim();
          break;
        }
      }
    }
    seenFigures.add(figNum);
    const surrounding = lines.slice(i + 1, i + 6).map(l => l.trim()).filter(Boolean).join(" ");
    chunks.push({
      clause_number: `FIGURE ${figNum}`,
      clause_title: caption || null,
      content: `${label} Figure ${figNum}${caption ? ` — ${caption}` : ""}\n\nThis figure appears on page ${getPage(i)} of the standard. A visual description will be generated shortly.\n\nContext: ${surrounding}`,
      page_number: getPage(i),
      chunk_index: 0,
    });
  }

  // ── Pass 2: Find figures referenced anywhere in the text ─────────────────
  // e.g. "(a) Figure 3.3 for testing..." or "see Figure 3.21"
  // Creates placeholder chunks for figures not found with a caption in Pass 1.
  const refPattern = /\bFIGURE\s+(\d+(?:\.\d+)*)\b/gi;
  const pass2Before = seenFigures.size;
  let refMatch: RegExpExecArray | null;
  while ((refMatch = refPattern.exec(text)) !== null) {
    const figNum = refMatch[1].trim();
    if (seenFigures.has(figNum)) continue;
    seenFigures.add(figNum);
    // Find which line this reference is on for page number
    const charPos = refMatch.index;
    let lineIdx = 0;
    for (let j = pageOffsets.length - 1; j >= 0; j--) {
      if (pageOffsets[j] <= charPos) { lineIdx = j; break; }
    }
    const context = text.slice(Math.max(0, charPos - 100), charPos + 200).replace(/\s+/g, " ").trim();
    chunks.push({
      clause_number: `FIGURE ${figNum}`,
      clause_title: null,
      content: `${label} Figure ${figNum}\n\nThis figure is referenced in the standard. A visual description will be generated shortly.\n\nContext: ${context}`,
      page_number: getPage(lineIdx),
      chunk_index: 0,
    });
  }

  console.log(`[${label}] Figure extraction summary: Pass 1 found ${pass2Before}, Pass 2 found ${seenFigures.size - pass2Before}, total ${seenFigures.size}`);

  return chunks;
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
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    serviceRoleKey
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
    console.log(`[DIAG] standard_id=${standard_id} client_text_length=${clientExtractedText?.length ?? 0}`);
    if (!standard_id) {
      return new Response(JSON.stringify({ error: "standard_id is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Support two call patterns:
    // 1. Internal call from upload-standard: uses service role key + passes user_id in body
    // 2. Direct user call: uses user JWT for auth
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

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
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
        extracted = await extractTextFromPdf(fileBytes, ANTHROPIC_API_KEY);
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
    const clauseChunks = chunkSections(sections, standardCode, version);
    const tableChunks = extractTableChunks(extracted.text, standardCode, version);
    const figureChunks = extractFigureChunks(extracted.text, standardCode, version);
    console.log(`[${standard_id}] Found ${tableChunks.length} table chunks, ${figureChunks.length} figure chunks`);

    // Merge and re-assign chunk_index globally
    const allChunks: Chunk[] = [...clauseChunks, ...tableChunks, ...figureChunks].map((chunk, idx) => ({
      ...chunk,
      chunk_index: idx,
    }));
    const totalChunks = allChunks.length;
    console.log(`[${standard_id}] Chunking done: ${Date.now() - t0}ms, ${totalChunks} chunks`);

    const { data: profile } = await supabaseAdmin.from("profiles").select("subscription_tier").eq("user_id", userId).single();
    const tier = profile?.subscription_tier || "pro";
    const isPartial = tier === "free";

    const DB_BATCH_SIZE = 100;

    // Delete stale chunks from previous extractions before inserting fresh ones
    const { error: deleteError } = await supabaseAdmin
      .from("standard_chunks")
      .delete()
      .eq("standard_id", standard_id);
    if (deleteError) console.error(`Failed to delete old chunks for ${standard_id}:`, deleteError);
    else console.log(`[${standard_id}] Deleted old chunks`);

    // Insert all chunks as text-only — embeddings are generated by embed-chunks separately
    for (let i = 0; i < allChunks.length; i += DB_BATCH_SIZE) {
      const batch = allChunks.slice(i, i + DB_BATCH_SIZE);
      const chunkRecords = batch.map(chunk => ({
        standard_id,
        user_id: userId,
        clause_number: chunk.clause_number,
        clause_title: chunk.clause_title,
        content: chunk.content,
        page_number: chunk.page_number,
        chunk_index: chunk.chunk_index,
        embedding: null,
        is_indexed: false,
      }));
      const { error: chunkError } = await supabaseAdmin.from("standard_chunks").insert(chunkRecords);
      if (chunkError) console.error(`Chunk insert error (batch ${i / DB_BATCH_SIZE}):`, chunkError);
      else console.log(`[${standard_id}] DB insert batch ${Math.floor(i / DB_BATCH_SIZE) + 1} done: ${Date.now() - t0}ms`);
    }

    console.log(`[${standard_id}] All chunks stored (text-only): ${Date.now() - t0}ms`);
    clearTimeout(timeoutHandle);

    // Update standard with chunk count — stays "processing" until embed-chunks finishes
    await supabaseAdmin.from("standards").update({
      extraction_quality_score: qualityScore,
      is_partial: isPartial,
      total_chunks: totalChunks,
      indexed_chunks: 0,
    }).eq("id", standard_id);

    // Hand off embedding to embed-chunks (runs in its own 150s window)
    const embedUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/embed-chunks`;
    fetch(embedUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({ standard_id, user_id: userId }),
    }).catch(e => console.error("Failed to trigger embed-chunks:", e));

    // Fire-and-forget: describe-figures generates AI descriptions for figure chunks
    if (figureChunks.length > 0) {
      const describeUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/describe-figures`;
      fetch(describeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
        body: JSON.stringify({ standard_id, user_id: userId }),
      }).catch(e => console.error("Failed to trigger describe-figures:", e));
    }

    return new Response(JSON.stringify({ status: "processing", total_chunks: totalChunks, quality_score: qualityScore, is_partial: isPartial }), {
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
