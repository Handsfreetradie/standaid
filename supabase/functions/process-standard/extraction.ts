// Pure extraction/chunking logic for process-standard.
// No Deno or network dependencies — imported by index.ts (Deno edge function)
// and by the vitest unit tests in src/test/extraction.test.ts.

// Bump this whenever chunking/extraction/tagging logic changes in a way that
// would meaningfully change existing chunks (e.g. sectioning rules, table/
// figure detection, normativity tagging). standards.pipeline_version is
// stamped with this value when chunks are (re)built, so stale standards
// (pipeline_version < PIPELINE_VERSION) can be found and reprocessed via
// reprocess-standard without requiring users to re-upload.
export const PIPELINE_VERSION = 1;

export interface Section {
  heading: string | null;
  clauseNumber: string | null;
  lines: string[];
  pageNumber: number;
  // Appendix context from the sectioner: appendices are tagged normative or
  // informative by their "(Normative)"/"(Informative)" marker, which changes
  // whether their content is a requirement or guidance.
  inAppendix: boolean;
  appendixNormative: boolean | null;
}

export type ChunkType = "clause" | "table" | "figure" | "note" | "definition" | "appendix" | "map";

export interface Chunk {
  clause_number: string | null;
  clause_title: string | null;
  content: string;
  page_number: number;
  chunk_index: number;
  chunk_type: ChunkType;
  // true = mandatory ("shall"), false = guidance (should/NOTE/informative),
  // null = neither signal present
  is_normative: boolean | null;
}

// Normativity of ordinary clause text: "shall" is mandatory language anywhere
// in the clause; "should" or an uppercase NOTE with no "shall" is guidance
// only. Lowercase "note" is excluded — prose like "note that" isn't a NOTE.
export function tagClauseNormativity(text: string): boolean | null {
  if (/\bshall\b/i.test(text)) return true;
  if (/\bshould\b/i.test(text) || /\bNOTES?\b/.test(text)) return false;
  return null;
}

// Heading patterns for AU/NZ standards AND the NCC (National Construction
// Code). Standards Australia uses "SECTION 2", "PART 3", "APPENDIX C".
// The NCC adds lettered sections ("SECTION C FIRE RESISTANCE" — requires an
// uppercase title after the letter so prose like "Section C of..." doesn't
// open a false section), lettered parts ("Part C3", "Part 3.7") and volumes.
export const SECTION_HEADING = /^(SECTION\s+\d+|PART\s+[A-J]?\d+(?:\.\d+)*|APPENDIX\s+[A-Z]|VOLUME\s+(?:ONE|TWO|THREE|\d)\s*$)/i;

// NCC lettered sections ("SECTION C FIRE RESISTANCE"). Deliberately
// case-SENSITIVE: the uppercase title requirement is the guard that stops
// prose like "Section C of the code..." opening a false section — under /i
// the guard matched lowercase words and was useless.
export const NCC_SECTION_HEADING = /^SECTION\s+[A-J]\s+[A-Z]{2,}/;

// Amendment 1/2 print a margin "*" beside every changed clause, and extraction
// places it at line start ("* 2.9.2 Type") — the ^-anchored heading patterns
// never fired on those lines, so ~7% of AS/NZS 3000:2018's clauses silently
// merged into the previous clause's chunk. Stripped once here, before
// matching, rather than reworked into every pattern. A single mark only:
// "**TABLE"-style markdown bold is caption territory, not an amendment mark.
const AMENDMENT_MARK = /^\*(?!\*)\s*/;

export function isSectionHeading(line: string): boolean {
  const l = line.replace(AMENDMENT_MARK, "");
  return SECTION_HEADING.test(l) || NCC_SECTION_HEADING.test(l);
}

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
// Table-of-contents entries look exactly like clause headings but end in a
// dotted leader + page number ("8.3 TESTING ....... 419"). Treating them as
// headings creates hundreds of junk chunks that shadow the real clause in
// exact clause-number lookups.
const TOC_LEADER = /\.{4,}\s*\d*\s*$/;

// Natural sort for table/figure numbers, including appendix forms like
// "C1" or "B2.1": letterless numbers first, then by letter, then numerically.
export function compareRefNumbers(a: string, b: string): number {
  const pa = a.match(/^([A-Z]?)(\d+(?:\.\d+)*)$/i);
  const pb = b.match(/^([A-Z]?)(\d+(?:\.\d+)*)$/i);
  if (!pa || !pb) return a.localeCompare(b);
  const letterCmp = pa[1].toUpperCase().localeCompare(pb[1].toUpperCase());
  if (letterCmp !== 0) return letterCmp;
  const na = pa[2].split(".").map(Number);
  const nb = pb[2].split(".").map(Number);
  for (let i = 0; i < Math.max(na.length, nb.length); i++) {
    const d = (na[i] ?? 0) - (nb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

// Appendix clause headings are letter-prefixed ("B1 SCOPE", "C2.1 Maximum
// demand calculation"). Only matched while inside an APPENDIX section —
// applying it globally would turn body-text cross-references ("B1 sets out
// the requirements...") into headings.
export const APPENDIX_CLAUSE_PATTERN = /^([A-Z]\d{1,2}(?:\.\d{1,2}){0,4})[\t ]+([A-Z][A-Za-z].*)/;

// NCC 2022 clause codes: letter-digit-letter-digit ("C3D5 Fire-resistance of
// building elements", "H1P1 Structure", "F2V2"). The middle letter is the
// provision type: D deemed-to-satisfy, P performance, V verification,
// G governing, O objective, F functional. Distinctive enough to match
// globally without false positives in AS/NZS text.
export const NCC_CLAUSE_PATTERN = /^([A-J]\d{1,2}[DGPVOF]\d{1,2})[\t ]+([A-Z][A-Za-z].*)/;

// NCC 2019-era performance/objective clauses: "P2.3.1 Fire protection",
// "O2.1", "V2.1.2". Requires a capitalised title like the other patterns.
export const NCC_LEGACY_CLAUSE_PATTERN = /^([POV]\d{1,2}(?:\.\d{1,2}){1,3})[\t ]+([A-Z][A-Za-z].*)/;

function validateHeading(number: string, title: string, allowMixedCase = false): ClauseHeading | null {
  if (UNIT_WORD_TITLE.test(title)) return null;
  if (TOC_LEADER.test(title)) return null;
  if (!allowMixedCase && !number.includes(".") && title !== title.toUpperCase()) return null;
  return { number, title };
}

export function matchClauseHeading(line: string, inAppendix = false): ClauseHeading | null {
  line = line.replace(AMENDMENT_MARK, "");
  const m = line.match(CLAUSE_PATTERN);
  if (m) {
    // Groups: [1]=number (tab variant), [2]=title (tab variant), [3]=number (space variant), [4]=title (space variant)
    return validateHeading(m[1] || m[3], (m[2] || m[4] || "").trim());
  }
  const ncc = line.match(NCC_CLAUSE_PATTERN) || line.match(NCC_LEGACY_CLAUSE_PATTERN);
  if (ncc) return validateHeading(ncc[1], ncc[2].trim(), true);
  if (inAppendix) {
    const am = line.match(APPENDIX_CLAUSE_PATTERN);
    if (am) return validateHeading(am[1], am[2].trim());
  }
  return null;
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

  // Count truncated decimals: a digit whose fraction was swallowed by a bad
  // glyph sits mid-sentence with a lowercase word or unit following ("0. ohms",
  // "0. m"). Requiring the lowercase/unit continuation stops legitimate list
  // markers ("1. The building...") and sentence-final numbers ("Class 1.")
  // from counting — the NCC has hundreds of those and was failing the gate.
  const truncated = (text.match(/\d\.\s+(?=[a-zΩ°µ])/g) || []).length;
  const normal = (text.match(/\d\.\d/g) || []).length;
  const totalDecimals = truncated + normal;

  // If >15% of decimal-point sequences look truncated, fall back to batched AI OCR.
  if (totalDecimals > 4 && truncated / totalDecimals > 0.15) {
    return false;
  }

  // Fused-token detection: text assembled without spaces (bad line
  // reconstruction) glues digits to words ("0.5Where the installation") and
  // words to each other ("theInstallation"). Clean standards text has almost
  // none of these; corrupted extractions have them in nearly every line.
  const fusedDigitWord = (text.match(/\d[A-Z][a-z]/g) || []).length;
  const fusedWords = (text.match(/[a-z]{2}[A-Z][a-z]{2}/g) || []).length;
  const wordCount = (text.match(/\S+/g) || []).length;
  if (wordCount > 100 && (fusedDigitWord + fusedWords) / wordCount > 0.01) {
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

// ── Page-furniture stripping ─────────────────────────────────────────────────

// Licensed PDFs stamp near-identical boilerplate on every page — SAI Global
// licence lines, "COPYRIGHT", the running "AS/NZS 3000:2018" header with a
// page number. Without stripping, those lines land inside every chunk
// (~150KB of noise across a full standard, baked into the embeddings).
// Detection is generic, not hardcoded: any line whose normalised form appears
// on a large fraction of content pages is furniture, whatever the standard or
// licensee. Short documents are left alone — too few pages to tell furniture
// from legitimately repeated content.
const FURNITURE_PAGE_FRACTION = 0.3;
const FURNITURE_MIN_PAGES = 20;
// Some licences only stamp their boilerplate on a document's front matter
// (title/licence/copyright/preface pages) rather than every page — AS3017:2007's
// personal-licence line appears on ~10 of its 57 pages (all in the first dozen)
// and never reaches the whole-document 30% bar, since the bulk of a real
// standard is technical content that doesn't repeat it. A second pass checks
// repetition within just the leading pages so a front-matter-only watermark
// still gets caught, without lowering the document-wide bar (which would risk
// stripping legitimately-repeated technical text, e.g. recurring NOTE wording).
const FRONT_MATTER_WINDOW_PAGES = 20;
const FRONT_MATTER_PAGE_FRACTION = 0.4;

export function stripRepeatedPageFurniture(markedText: string): string {
  const pageMarker = /^\[PAGE\s+\d+\]/i;
  const captionLine = /^\*{0,2}(?:TABLE|FIGURE)S?\s+[A-Z]?\d/i;
  // Collapse whitespace, drop a leading/trailing bare page number so
  // "3 AS/NZS 3000:2018" and "AS/NZS 3000:2018 417" count as the same header,
  // and drop trailing full stops — licence stamps appear with and without one,
  // and counted separately each variant can fall under the page threshold.
  const normalise = (line: string) =>
    line.trim().replace(/\s+/g, " ").replace(/^\d{1,4} /, "").replace(/ \d{1,4}$/, "").replace(/\.+$/, "");

  const lines = markedText.split("\n");

  // Pass 1: count how many DISTINCT pages each normalised line appears on,
  // both document-wide and within just the front-matter window.
  const pageCounts = new Map<string, number>();
  const frontMatterCounts = new Map<string, number>();
  let pagesWithContent = 0;
  let currentPageLines: Set<string> | null = null;
  const flushPage = () => {
    if (currentPageLines && currentPageLines.size > 0) {
      pagesWithContent++;
      const inFrontMatter = pagesWithContent <= FRONT_MATTER_WINDOW_PAGES;
      for (const key of currentPageLines) {
        pageCounts.set(key, (pageCounts.get(key) || 0) + 1);
        if (inFrontMatter) frontMatterCounts.set(key, (frontMatterCounts.get(key) || 0) + 1);
      }
    }
  };
  for (const line of lines) {
    if (pageMarker.test(line)) { flushPage(); currentPageLines = new Set(); continue; }
    const key = normalise(line);
    if (key && currentPageLines) currentPageLines.add(key);
  }
  flushPage();

  if (pagesWithContent < FURNITURE_MIN_PAGES) return markedText;

  // Pass 2: drop furniture lines, keeping markers and anything structural —
  // headings and captions are what sectioning and table/figure extraction
  // anchor on, so they survive no matter how often they repeat. Structure is
  // judged on the NORMALISED form: the running header "3 AS/NZS 3000:2018"
  // parses as an undotted ALL-CAPS clause heading on the raw line, but with
  // its page number stripped it's plain text and drops like any furniture.
  const threshold = Math.ceil(pagesWithContent * FURNITURE_PAGE_FRACTION);
  const frontMatterPages = Math.min(pagesWithContent, FRONT_MATTER_WINDOW_PAGES);
  const frontMatterThreshold = Math.ceil(frontMatterPages * FRONT_MATTER_PAGE_FRACTION);
  return lines.filter((line) => {
    if (pageMarker.test(line)) return true;
    const key = normalise(line);
    if (!key) return true;
    const isFurniture =
      (pageCounts.get(key) || 0) >= threshold ||
      (frontMatterCounts.get(key) || 0) >= frontMatterThreshold;
    if (!isFurniture) return true;
    return isSectionHeading(key) || matchClauseHeading(key, true) !== null || captionLine.test(key);
  }).join("\n");
}

// ── Sectioning ───────────────────────────────────────────────────────────────

// Splits text into sections, tracking the real page from inline [PAGE N] markers.
// This is accurate (marker-driven) rather than estimating from character offsets,
// which used to drift further off the deeper into a document you got — the cause
// of clauses opening on the wrong PDF page.
export function sortIntoSections(markedText: string): Section[] {
  const lines = markedText.split("\n");
  const sections: Section[] = [];
  let current: Section = { heading: null, clauseNumber: null, lines: [], pageNumber: 1, inAppendix: false, appendixNormative: null };
  let currentPage = 1;
  let inAppendix = false;
  // Whether the current appendix is "(Normative)" or "(Informative)" — the
  // marker sits on or just under the APPENDIX heading, before any lettered
  // clause, so clause sections created later inherit the resolved value.
  let appendixNormative: boolean | null = null;
  const pageMarker = /^\[PAGE\s+(\d+)\]/i;
  const appendixStatusMarker = /^\(?\s*(INFORMATIVE|NORMATIVE)\s*\)?$/i;

  for (const line of lines) {
    // Update the running page from the marker, but never treat it as content
    const pm = line.match(pageMarker);
    if (pm) { currentPage = parseInt(pm[1], 10) || currentPage; continue; }

    // ToC lines ("SECTION 2 ........ 45") must never open a section
    const sectionMatch = TOC_LEADER.test(line) ? null : (isSectionHeading(line) ? line : null);
    const clauseMatch = matchClauseHeading(line, inAppendix);

    if (sectionMatch !== null) {
      if (current.lines.length > 0) sections.push({ ...current });
      // Track appendix context so letter-prefixed clauses (B1, C2.1) are
      // detected there — appendices used to collapse into one giant
      // unlabelled section, hiding e.g. maximum-demand rules from retrieval.
      inAppendix = /^APPENDIX/i.test(line.trim().replace(AMENDMENT_MARK, ""));
      // "(Informative)" sometimes rides on the heading line itself. Checked
      // informative-first: \b keeps "normative" from matching inside it, but
      // the order makes the intent explicit.
      appendixNormative = inAppendix
        ? (/\bINFORMATIVE\b/i.test(line) ? false : /\bNORMATIVE\b/i.test(line) ? true : null)
        : null;
      current = { heading: line.trim(), clauseNumber: null, lines: [line], pageNumber: currentPage, inAppendix, appendixNormative };
    } else if (clauseMatch) {
      if (current.lines.length > 0) sections.push({ ...current });
      current = {
        heading: clauseMatch.title,
        clauseNumber: clauseMatch.number,
        lines: [line],
        pageNumber: currentPage,
        inAppendix,
        appendixNormative,
      };
    } else {
      // Standalone "(Normative)"/"(Informative)" line under the APPENDIX
      // heading — only honoured while still inside the heading section, so
      // body text deeper in the appendix can't flip the status.
      if (inAppendix && appendixNormative === null && current.clauseNumber === null && appendixStatusMarker.test(line.trim())) {
        appendixNormative = !/\bINFORMATIVE\b/i.test(line);
        current.appendixNormative = appendixNormative;
      }
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

// Hard size enforcement. Client-extracted text has no blank lines, so the
// paragraph split (\n\s*\n) used to be a no-op there — a 15,000-char clause
// became ONE chunk, and only its first 8,000 chars were ever embedded
// (embed-chunks slices the input). Everything past that was silently
// unsearchable. Oversized "paragraphs" are re-split on line boundaries,
// then sentences, then hard-cut as a last resort.
export function splitOversized(text: string, maxChars = MAX_CHUNK_CHARS): string[] {
  if (text.length <= maxChars) return [text];
  const pieces: string[] = [];
  let buffer = "";
  const units = text.split("\n").flatMap((line) =>
    line.length > maxChars ? line.split(/(?<=[.!?])\s+/) : [line]
  );
  for (const unit of units) {
    if (buffer.length + unit.length + 1 > TARGET_CHUNK_CHARS && buffer.length > 0) {
      pieces.push(buffer);
      buffer = unit;
    } else {
      buffer += (buffer ? "\n" : "") + unit;
    }
    // A single unbreakable unit longer than the cap gets hard-cut
    while (buffer.length > maxChars) {
      pieces.push(buffer.slice(0, TARGET_CHUNK_CHARS));
      buffer = buffer.slice(TARGET_CHUNK_CHARS);
    }
  }
  if (buffer.trim()) pieces.push(buffer);
  return pieces;
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
    // a short one like "SECTION 3 TESTS" (needed for the exam-helper section list),
    // and never a clause heading: parent clauses like "8.3 TESTING" carry all
    // their content in sub-clauses, but the heading chunk is what exact
    // clause-number lookups resolve to.
    const isHeading = section.clauseNumber !== null || isSectionHeading(section.heading || "");
    if (sectionText.length < 20 && !isHeading) continue;

    // Normative/informative tag, decided once per section so split chunks of
    // one clause all carry the same tag. Definitions and NOTE-only content
    // are guidance by nature; appendix chunks take the appendix's own
    // (Normative)/(Informative) marker; everything else reads its wording.
    const isDefinition = /definition/i.test(section.heading || "") || (section.clauseNumber || "").startsWith("1.4");
    let chunkType: ChunkType = "clause";
    let isNormative: boolean | null;
    if (isDefinition) {
      chunkType = "definition";
      isNormative = false;
    } else if (section.inAppendix) {
      chunkType = "appendix";
      isNormative = section.appendixNormative;
    } else if (/^NOTES?\b/.test(sectionText)) {
      chunkType = "note";
      isNormative = false;
    } else {
      isNormative = tagClauseNormativity(sectionText);
    }

    const breadcrumb = buildBreadcrumb(standardCode, version, section.clauseNumber, section.heading);

    if (sectionText.length <= MAX_CHUNK_CHARS) {
      chunks.push({
        clause_number: section.clauseNumber,
        clause_title: section.heading,
        content: breadcrumb + sectionText,
        page_number: section.pageNumber,
        chunk_index: chunkIndex++,
        chunk_type: chunkType,
        is_normative: isNormative,
      });
    } else {
      // Split on paragraph boundaries with overlap carry-forward. Oversized
      // paragraphs (client text has no blank lines) are pre-split so no
      // chunk can exceed the embedder's effective window.
      const paragraphs = sectionText.split(/\n\s*\n/).flatMap((p) => splitOversized(p));
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
            chunk_type: chunkType,
            is_normative: isNormative,
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
          chunk_type: chunkType,
          is_normative: isNormative,
        });
      }
    }
  }

  // Fallback if nothing was detected
  if (chunks.length === 0) {
    const fullText = sections.map(s => s.lines.join("\n")).join("\n");
    const paragraphs = fullText.split(/\n\s*\n/).flatMap((p) => splitOversized(p));
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
          chunk_type: "clause",
          is_normative: tagClauseNormativity(buffer),
        });
        buffer = "";
      }
    }
    if (buffer.trim().length > 20) {
      chunks.push({ clause_number: null, clause_title: null, content: buffer.trim(), page_number: 1, chunk_index: chunkIndex++, chunk_type: "clause", is_normative: tagClauseNormativity(buffer) });
    }
  }

  return chunks;
}

// ── Document map ─────────────────────────────────────────────────────────────

// Build a "table of contents" chunk from the detected structure — sections,
// appendices, and their top-level clause titles. Costs nothing (no AI call:
// it's assembled from headings the sectioner already found) and makes
// structural questions ("which section covers pools?", "is there an appendix
// on EV chargers?") retrieve an exact answer instead of fragments.
export function buildDocumentMapChunk(
  sections: Section[],
  standardCode: string,
  version: string,
): Chunk | null {
  const MAX_MAP_CHARS = 6000;
  const label = `[${standardCode}${version ? ` ${version}` : ""}]`;
  const lines: string[] = [];
  let currentHeadingClauses: string[] = [];
  // Front-matter amendment lists reuse real clause codes with junk titles
  // ("H1P1 Various amendments are included...") — when a clause number
  // appears more than once, only its LAST occurrence (the real body clause)
  // makes the map.
  const lastSeen = new Map<string, number>();
  sections.forEach((s, i) => { if (s.clauseNumber) lastSeen.set(s.clauseNumber, i); });
  const lastSeenHeading = new Map<string, number>();
  sections.forEach((s, i) => {
    if (s.clauseNumber === null && s.heading) lastSeenHeading.set(s.heading.trim(), i);
  });

  const flushClauses = () => {
    if (currentHeadingClauses.length > 0) {
      lines.push("  " + currentHeadingClauses.join("; "));
      currentHeadingClauses = [];
    }
  };

  sections.forEach((s, i) => {
    const isStructural = s.clauseNumber === null && s.heading && isSectionHeading(s.heading)
      && s.heading.trim().length <= 70 // prose-length "headings" are wrapped sentences
      && lastSeenHeading.get(s.heading.trim()) === i; // contents pages list every Part before the body repeats it
    if (isStructural) {
      flushClauses();
      lines.push(`${s.heading!.trim()} (page ${s.pageNumber})`);
    } else if (s.clauseNumber && s.heading && lastSeen.get(s.clauseNumber) === i) {
      // Top-level clauses only (2.3, B1 — not 2.3.4.1) keep the map readable
      const depth = (s.clauseNumber.match(/\./g) || []).length;
      if (depth <= 1) {
        currentHeadingClauses.push(`${s.clauseNumber} ${s.heading.trim()}`);
      }
    }
  });
  flushClauses();

  // A map needs real structure to be worth a chunk
  if (lines.length < 4) return null;

  let body = "";
  for (const line of lines) {
    if (body.length + line.length + 1 > MAX_MAP_CHARS) break;
    body += (body ? "\n" : "") + line;
  }

  return {
    clause_number: null,
    clause_title: "Document map — sections and contents",
    content: `${label} Document map — sections, appendices and contents of this standard\n\n${body}`,
    page_number: 1,
    chunk_index: 0, // placed first so even the free tier's 25% cutoff includes it
    chunk_type: "map",
    is_normative: false,
  };
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

  // tableNum -> { title, lineIdx, rank }  (rank 2 = uppercase caption,
  // rank 1 = title-case caption, rank 0 = reference-only)
  const tables = new Map<string, { title: string; lineIdx: number; rank: number }>();

  // ── Pass 1: caption lines (line STARTS with "TABLE X.X") ──────────────────
  // Real captions in AU/NZ standards are uppercase ("TABLE 8.1"); sentence
  // references at line start are title-case prose ("Table 8.1 contains
  // calculated examples of..."). Prefer uppercase, and reject candidates whose
  // "title" starts with a lowercase word — those are sentences, and anchoring
  // to them sends the PDF link to the wrong page.
  // Number accepts an optional letter prefix for appendix tables ("TABLE C1",
  // "TABLE C2.1") — these hold values like maximum demand that tradies ask
  // about constantly, and the old numeric-only pattern skipped them entirely.
  const captionPattern = /^(?:\*{0,2})TABLE\s+([A-Z]\d{1,2}[DGPVOF]\d{1,2}[a-z]?|[A-Z]?\d+(?:\.\d+)*[a-z]?)\s*(?:—|–|-|:)?\s*(.*)$/i;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, "").trim();
    const match = line.match(captionPattern);
    if (!match) continue;
    const tableNum = match[1].trim().toUpperCase();
    let title = (match[2] || "").trim().replace(/[*—–\-:\s]+$/, "");
    if (/^[a-z]/.test(title)) continue; // sentence reference, not a caption
    const rank = /^[*\s]*TABLE\b/.test(line) ? 2 : 1;
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
    // A title-case "Table X" line with no title on it and only a lowercase
    // continuation ("Table 40\nas 0.563 mV/A.m.") is a wrapped sentence
    // reference, not a caption — treating it as one anchored table chunks to
    // random prose at the wrong page. Demote it to reference rank.
    if (/^[a-z]/.test(title)) title = "";
    const effectiveRank = rank === 1 && !title ? 0 : rank;
    const existing = tables.get(tableNum);
    if (!existing || existing.rank < effectiveRank) {
      tables.set(tableNum, { title, lineIdx: i, rank: effectiveRank });
    }
  }

  // ── Pass 2: references ("see Table 8.1") only for tables with no caption ──
  const refPattern = /\bTABLES?\s+([A-Z]\d{1,2}[DGPVOF]\d{1,2}[a-z]?|[A-Z]?\d+(?:\.\d+)*[a-z]?)/gi;
  for (let i = 0; i < lines.length; i++) {
    let refMatch: RegExpExecArray | null;
    refPattern.lastIndex = 0;
    while ((refMatch = refPattern.exec(lines[i])) !== null) {
      const tableNum = refMatch[1].trim().toUpperCase();
      if (!tables.has(tableNum)) {
        tables.set(tableNum, { title: "", lineIdx: i, rank: 0 });
      }
    }
  }

  // ── Build one chunk per unique table, sorted naturally ────────────────────
  const sortedNums = [...tables.keys()].sort(compareRefNumbers);

  const chunks: Chunk[] = [];
  for (const tableNum of sortedNums) {
    const { title, lineIdx, rank } = tables.get(tableNum)!;

    // Capture the table body: for real captions (rank > 0), everything until
    // the next table/figure caption or clause/section heading — the old
    // ~500-char slice silently discarded most of every multi-page table.
    // Reference-only entries (rank 0) anchor to prose, so keep those short.
    const BODY_HARD_CAP = 6000;
    const bodyCap = rank > 0 ? BODY_HARD_CAP : 400;
    let surrounding = "";
    for (let j = lineIdx + 1; j < lines.length && surrounding.length < bodyCap; j++) {
      const raw = lines[j];
      if (pageMarker.test(raw)) continue;
      if (rank > 0) {
        const trimmed = raw.trim();
        if (captionPattern.test(trimmed)) break;
        if (/^(?:\*{0,2})FIGURE\s+[A-Z]?\d/i.test(trimmed)) break;
        if (!TOC_LEADER.test(raw) && (isSectionHeading(raw) || matchClauseHeading(raw))) break;
      }
      surrounding += raw + "\n";
    }

    // The raw linear body is column-fused/unreliable, so like figures these
    // chunks carry a placeholder that keeps embed-chunks away until
    // describe-figures replaces the content with an accurate vision
    // transcription of the table (matching magic string in embed-chunks).
    const placeholder = rank > 0
      ? "\n\n[A structured transcription of this table will be generated shortly.]"
      : "";

    chunks.push({
      clause_number: `TABLE ${tableNum}`,
      clause_title: title || null,
      content: `${label} Table ${tableNum}${title ? `: ${title}` : ""}\n\n${surrounding.trim()}${placeholder}`,
      page_number: linePages[lineIdx] ?? 1,
      chunk_index: 0, // reassigned after merge
      chunk_type: "table",
      is_normative: null, // a table's force comes from the clause invoking it
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
  // Optional letter prefix covers appendix figures ("FIGURE B1")
  const captionLinePattern = /^(?:\*{0,2})FIGURE\s+([A-Z]\d{1,2}[DGPVOF]\d{1,2}[a-z]?|[A-Z]?\d+(?:\.\d+)*[a-z]?)\s*(?:—|–|-|:)?\s*(.*)$/i;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, "").trim();
    const match = line.match(captionLinePattern);
    if (!match) continue;
    const figNum = match[1].trim().toUpperCase();
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
  const refPattern = /\bFIGURES?\s+((?:[A-Z]\d{1,2}[DGPVOF]\d{1,2}[a-z]?|[A-Z]?\d+(?:\.\d+)*[a-z]?)(?:\s*(?:,|and|&)\s*(?:[A-Z]\d{1,2}[DGPVOF]\d{1,2}[a-z]?|[A-Z]?\d+(?:\.\d+)*[a-z]?))*)/gi;
  let refMatch: RegExpExecArray | null;
  while ((refMatch = refPattern.exec(text)) !== null) {
    // Split a possible list ("3.7, 3.8 and 3.13") into individual numbers.
    const nums = (refMatch[1].match(/[A-Z]\d{1,2}[DGPVOF]\d{1,2}[a-z]?|[A-Z]?\d+(?:\.\d+)*[a-z]?/gi) || []).map((n) => n.toUpperCase());
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
  const sortedNums = [...figures.keys()].sort(compareRefNumbers);

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
      chunk_type: "figure",
      is_normative: null, // a figure's force comes from the clause invoking it
    });
    seenFigures.add(figNum);
  }

  return chunks;
}
