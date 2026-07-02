// Pure extraction/chunking logic for process-standard.
// No Deno or network dependencies — imported by index.ts (Deno edge function)
// and by the vitest unit tests in src/test/extraction.test.ts.

export interface Section {
  heading: string | null;
  clauseNumber: string | null;
  lines: string[];
  pageNumber: number;
}

export interface Chunk {
  clause_number: string | null;
  clause_title: string | null;
  content: string;
  page_number: number;
  chunk_index: number;
}

// Heading patterns for AU/NZ standards
export const SECTION_HEADING = /^(SECTION\s+\d+|PART\s+\d+|APPENDIX\s+[A-Z])/i;

// Require: clause number + whitespace + capital letter + alpha char
// Relaxed from 2+ spaces to 1+ spaces so AI OCR output (single space) also matches.
// The [A-Z][A-Za-z] guard already prevents unit matches like "3.5 kg/m²" (lowercase k).
export const CLAUSE_PATTERN = /^(\d{1,2}(?:\.\d{1,2}){0,4})\t+([A-Z][A-Za-z].*)|^(\d{1,2}(?:\.\d{1,2}){0,4})\s+([A-Z][A-Za-z].*)/;

// Body text often starts with a quantity + capitalised unit ("30 Amp circuits",
// "1.5 Times the rated current", "0.4 Seconds maximum disconnection time").
// A real clause title never starts with these words, so reject them outright.
const UNIT_WORD_TITLE = /^(?:Amps?|Amperes?|Volts?|Watts?|Ohms?|Seconds|Minutes|Hours|Days|Weeks|Months|Years|Times|Metres|Meters|Millimetres|Millimeters|Degrees|Percent|Litres|Liters|Kilograms|Phases)\b/;

export interface ClauseHeading {
  number: string;
  title: string;
}

// Decide whether a line is a genuine clause heading. Filters the false
// positives that CLAUSE_PATTERN alone lets through:
//  - undotted numbers ("3 Phase supplies require") are only headings when the
//    title is ALL CAPS ("2 SCOPE AND GENERAL"), matching how standards format
//    top-level clauses
//  - dotted numbers followed by a unit word ("1.5 Times the rated current")
//    are measurements in body text, not headings
export function matchClauseHeading(line: string): ClauseHeading | null {
  const m = line.match(CLAUSE_PATTERN);
  if (!m) return null;
  // Groups: [1]=number (tab variant), [2]=title (tab variant), [3]=number (space variant), [4]=title (space variant)
  const number = m[1] || m[3];
  const title = (m[2] || m[4] || "").trim();
  if (UNIT_WORD_TITLE.test(title)) return null;
  if (!number.includes(".") && title !== title.toUpperCase()) return null;
  return { number, title };
}

const TARGET_CHUNK_CHARS = 2000;
const MAX_CHUNK_CHARS = 2500;
export const SCANNED_PAGE_THRESHOLD = 15;

// Detect encoding corruption common in SAI Global / licensed PDFs.
// Symptoms: Ω glyph swallows adjacent digits → "0.5 Ω" becomes "0. "
// and custom fonts drop characters like "AS" from "AS/NZS".
export function hasGoodTextQuality(text: string): boolean {
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
  if (totalDecimals > 4 && truncated / totalDecimals > 0.15) {
    return false;
  }

  return true;
}

// ── Quality scoring ──────────────────────────────────────────────────────────

export function computeQualityScore(text: string, totalPages: number, pagesWithContent: number): number {
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

export function parseExtractedText(rawText: string): { text: string; pages: string[]; totalPages: number; pagesWithContent: number } {
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

// ── Base64 conversion ────────────────────────────────────────────────────────

// Convert in fixed-size slices — spreading a whole multi-MB file into
// String.fromCharCode(...bytes) overflows the call stack on anything over
// ~125KB, which killed AI OCR for every real PDF.
export function convertPdfToBase64(fileBytes: Uint8Array): string {
  const SLICE = 0x8000;
  let binary = "";
  for (let i = 0; i < fileBytes.length; i += SLICE) {
    const slice = fileBytes.subarray(i, i + SLICE);
    binary += String.fromCharCode.apply(null, slice as unknown as number[]);
  }
  return btoa(binary);
}

// ── Sectioning ───────────────────────────────────────────────────────────────

// Splits text into sections, tracking the real page from inline [PAGE N] markers.
// This is accurate (marker-driven) rather than estimating from character offsets,
// which used to drift further off the deeper into a document you got — the cause
// of clauses opening on the wrong PDF page.
export function sortIntoSections(markedText: string): Section[] {
  const lines = markedText.split("\n");
  const sections: Section[] = [];
  let current: Section = { heading: null, clauseNumber: null, lines: [], pageNumber: 1 };
  let currentPage = 1;
  const pageMarker = /^\[PAGE\s+(\d+)\]/i;

  for (const line of lines) {
    // Update the running page from the marker, but never treat it as content
    const pm = line.match(pageMarker);
    if (pm) { currentPage = parseInt(pm[1], 10) || currentPage; continue; }

    const sectionMatch = line.match(SECTION_HEADING);
    const clauseMatch = matchClauseHeading(line);

    if (sectionMatch) {
      if (current.lines.length > 0) sections.push({ ...current });
      current = { heading: line.trim(), clauseNumber: null, lines: [line], pageNumber: currentPage };
    } else if (clauseMatch) {
      if (current.lines.length > 0) sections.push({ ...current });
      current = {
        heading: clauseMatch.title,
        clauseNumber: clauseMatch.number,
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

export function buildBreadcrumb(standardCode: string, version: string, clauseNumber: string | null, clauseTitle: string | null): string {
  const clausePart = clauseNumber
    ? `Clause ${clauseNumber}${clauseTitle ? `: ${clauseTitle}` : ""}`
    : clauseTitle || "";
  return `[${standardCode}${version ? ` ${version}` : ""}]${clausePart ? ` ${clausePart}` : ""}\n\n`;
}

export function getOverlapTail(text: string, approxChars = 200): string {
  if (text.length <= approxChars) return text;
  // Find the last sentence boundary before approxChars from end
  const tail = text.slice(-approxChars);
  const sentenceBreak = tail.search(/(?<=[.!?])\s/);
  return sentenceBreak > -1 ? tail.slice(sentenceBreak).trimStart() : tail;
}

export function chunkSections(sections: Section[], standardCode: string, version: string): Chunk[] {
  const chunks: Chunk[] = [];
  let chunkIndex = 0;

  for (const section of sections) {
    const sectionText = section.lines.join("\n").trim();
    // Drop tiny fragments — but never a real SECTION/PART/APPENDIX heading, even
    // a short one like "SECTION 3 TESTS" (needed for the exam-helper section list).
    const isHeading = section.clauseNumber === null && SECTION_HEADING.test(section.heading || "");
    if (sectionText.length < 20 && !isHeading) continue;

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

// One chunk per unique table, anchored to its CAPTION page. A table number can
// appear two ways:
//   1. As a CAPTION — the line starts with "TABLE 8.1 — ..." (the real table)
//   2. As a REFERENCE — "... shall comply with Table 8.1" inside a sentence
// The old implementation created a chunk for every mention, so "Table 8.1"
// referenced on pages 42 and 55 produced duplicate chunks pointing at the
// wrong pages — the cause of table links opening the wrong PDF page.
export function extractTableChunks(text: string, standardCode: string, version: string): Chunk[] {
  const lines = text.split("\n");
  const pageMarker = /^\[PAGE\s+(\d+)\]/i;
  const label = `[${standardCode}${version ? ` ${version}` : ""}]`;

  // Page for every line, tracked from the [PAGE N] markers
  const linePages: number[] = [];
  let currentPage = 1;
  for (const line of lines) {
    const pm = line.match(pageMarker);
    if (pm) currentPage = parseInt(pm[1], 10) || currentPage;
    linePages.push(currentPage);
  }

  // tableNum -> { title, lineIdx, isCaption }
  const tables = new Map<string, { title: string; lineIdx: number; isCaption: boolean }>();

  // ── Pass 1: caption lines (line STARTS with "TABLE X.X") ──────────────────
  const captionPattern = /^(?:\*{0,2})TABLE\s+(\d+(?:\.\d+)*)\s*(?:—|–|-|:)?\s*(.*)$/i;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, "").trim();
    const match = line.match(captionPattern);
    if (!match) continue;
    const tableNum = match[1].trim();
    let title = (match[2] || "").trim().replace(/[*—–\-:\s]+$/, "");
    // Caption text sometimes runs onto the next line
    if (!title) {
      for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
        const next = lines[j].replace(/\r$/, "").trim();
        if (pageMarker.test(next)) continue;
        if (next && next.length < 120) {
          title = next.replace(/^[—\-–:]+\s*/, "").trim();
          break;
        }
      }
    }
    const existing = tables.get(tableNum);
    if (!existing || (!existing.isCaption)) {
      tables.set(tableNum, { title, lineIdx: i, isCaption: true });
    }
  }

  // ── Pass 2: references ("see Table 8.1") only for tables with no caption ──
  const refPattern = /\bTABLES?\s+(\d+(?:\.\d+)*)/gi;
  for (let i = 0; i < lines.length; i++) {
    let refMatch: RegExpExecArray | null;
    refPattern.lastIndex = 0;
    while ((refMatch = refPattern.exec(lines[i])) !== null) {
      const tableNum = refMatch[1].trim();
      if (!tables.has(tableNum)) {
        tables.set(tableNum, { title: "", lineIdx: i, isCaption: false });
      }
    }
  }

  // ── Build one chunk per unique table, sorted naturally ────────────────────
  const sortedNums = [...tables.keys()].sort((a, b) => {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] ?? 0) - (pb[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  });

  const chunks: Chunk[] = [];
  for (const tableNum of sortedNums) {
    const { title, lineIdx } = tables.get(tableNum)!;

    // Grab up to ~500 chars of following content (the table body), skipping markers
    let surrounding = "";
    let charCount = 0;
    for (let j = lineIdx + 1; j < lines.length && charCount < 500; j++) {
      if (pageMarker.test(lines[j])) continue;
      surrounding += lines[j] + "\n";
      charCount += lines[j].length + 1;
    }

    chunks.push({
      clause_number: `TABLE ${tableNum}`,
      clause_title: title || null,
      content: `${label} Table ${tableNum}${title ? `: ${title}` : ""}\n\n${surrounding.trim()}`,
      page_number: linePages[lineIdx] ?? 1,
      chunk_index: 0, // reassigned after merge
    });
  }

  return chunks;
}

// ── Figure extraction ─────────────────────────────────────────────────────────

export function extractFigureChunks(text: string, standardCode: string, version: string): Chunk[] {
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

  // A figure number can appear two ways in a standard:
  //   1. As a CAPTION — the line starts with "Figure 3.1 — ..." (the real diagram)
  //   2. As a REFERENCE — "see Figure 3.1" or "(Figures 3.3, 3.4 and 3.5)" inside a sentence
  // We want one chunk per unique figure, preferring the caption (it has the best
  // title + page) but still capturing figures that are only ever referenced.

  // figNum -> { caption, lineIdx }  (caption is "" for reference-only figures)
  const figures = new Map<string, { caption: string; lineIdx: number }>();

  // ── Pass 1: caption lines (line STARTS with "Figure X.X") ─────────────────
  // Accepts dash, colon or plain-space separators and optional **markdown**.
  const captionLinePattern = /^(?:\*{0,2})FIGURE\s+(\d+(?:\.\d+)*)\s*(?:—|–|-|:)?\s*(.*)$/i;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, "").trim();
    const match = line.match(captionLinePattern);
    if (!match) continue;
    const figNum = match[1].trim();
    let caption = (match[2] || "").trim().replace(/[*—–\-:\s]+$/, "");
    // If the caption ran onto the next line, pull it in.
    if (!caption) {
      for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
        const next = lines[j].replace(/\r$/, "").trim();
        if (/^\[PAGE\s+\d+\]/i.test(next)) continue;
        if (next && !/^\d+\.\d/.test(next) && next.length < 120) {
          caption = next.replace(/^[—\-–:]+\s*/, "").trim();
          break;
        }
      }
    }
    // Prefer the entry that actually has a caption.
    const existing = figures.get(figNum);
    if (!existing || (!existing.caption && caption)) {
      figures.set(figNum, { caption, lineIdx: i });
    }
  }

  // ── Pass 2: any "Figure X.X" referenced anywhere (incl. lists like
  //    "Figures 3.7, 3.8, 3.9 and 3.13"). Adds figures we didn't see a caption for.
  const refPattern = /\bFIGURES?\s+(\d+(?:\.\d+)*(?:\s*(?:,|and|&)\s*\d+(?:\.\d+)*)*)/gi;
  let refMatch: RegExpExecArray | null;
  while ((refMatch = refPattern.exec(text)) !== null) {
    // Split a possible list ("3.7, 3.8 and 3.13") into individual numbers.
    const nums = refMatch[1].match(/\d+(?:\.\d+)*/g) || [];
    const charPos = refMatch.index;
    let lineIdx = 0;
    for (let j = pageOffsets.length - 1; j >= 0; j--) {
      if (pageOffsets[j] <= charPos) { lineIdx = j; break; }
    }
    for (const figNum of nums) {
      if (!figures.has(figNum)) figures.set(figNum, { caption: "", lineIdx });
    }
  }

  // ── Build one chunk per unique figure, sorted naturally (1.1, 3.1, 3.2 …) ──
  const sortedNums = [...figures.keys()].sort((a, b) => {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] ?? 0) - (pb[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  });

  for (const figNum of sortedNums) {
    const { caption, lineIdx } = figures.get(figNum)!;
    const page = getPage(lineIdx);
    const surrounding = lines.slice(lineIdx + 1, lineIdx + 6).map(l => l.trim()).filter(Boolean).filter(l => !/^\[PAGE\s+\d+\]/i.test(l)).join(" ");
    chunks.push({
      clause_number: `FIGURE ${figNum}`,
      clause_title: caption || null,
      content: `${label} Figure ${figNum}${caption ? ` — ${caption}` : ""}\n\nThis figure appears on page ${page} of the standard. A visual description will be generated shortly.\n\nContext: ${surrounding}`,
      page_number: page,
      chunk_index: 0,
    });
    seenFigures.add(figNum);
  }

  return chunks;
}
