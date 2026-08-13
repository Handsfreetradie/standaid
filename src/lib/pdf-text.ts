// Geometry-aware PDF text line assembly, shared by StandardsUpload, Learn's
// exam-prep upload, and the extraction regression tests. This is where the
// "0.5 ohms → 05 ohms" class of corruption lives, so the logic is pure and
// unit-tested: PDFs emit kerned runs as separate items ("0", ".", "5"), and
// table cells on one row as separate items — get clustering or joining wrong
// and numbers are silently fabricated.

import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

export interface PositionedItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

// Cluster items into visual lines by Y-gap (tolerant of sub-point jitter,
// unlike a fixed grid). Split out from assembleLines so the crop helpers below
// can reuse the exact same clustering while keeping each line's geometry —
// assembleLines throws the coordinates away, but a crop rect needs them.
function clusterLines(items: PositionedItem[]): PositionedItem[][] {
  // Top-to-bottom, then left-to-right so clustering sees reading order.
  const sorted = [...items].sort((a, b) => (b.y - a.y) || (a.x - b.x));

  const lines: PositionedItem[][] = [];
  let current: PositionedItem[] = [];
  let currentY = Infinity;
  for (const it of sorted) {
    // Same visual line if Y is within half a glyph height (min 2pt) —
    // tolerant of kerned runs and superscripts, unlike a fixed grid.
    const tol = Math.max(2, it.h * 0.5);
    if (current.length === 0 || Math.abs(it.y - currentY) <= tol) {
      current.push(it);
      if (current.length === 1) currentY = it.y;
    } else {
      lines.push(current);
      current = [it];
      currentY = it.y;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

// Sort one clustered line by X and join it, inserting spaces from the real
// horizontal gap between items.
function renderLine(line: PositionedItem[]): string {
  line.sort((a, b) => a.x - b.x);
  let text = "";
  let prevEnd = Infinity;
  let prev: PositionedItem | null = null;
  for (const it of line) {
    // Some PDFs (the NCC among them) carry each heading twice — a visible
    // layer and an accessibility/outline layer at the same coordinates.
    // Without this dedupe the copies fuse into "StructurePart H1—Structure".
    if (prev && it.str === prev.str && Math.abs(it.x - prev.x) < 1 && Math.abs(it.y - prev.y) < 1) {
      continue;
    }
    prev = it;
    const gap = it.x - prevEnd;
    // A real word/column gap is a decent fraction of the glyph height;
    // kerned fragments of one word sit at gap ≈ 0 (or overlap).
    if (text && gap > Math.max(1, it.h * 0.12) && !text.endsWith(" ") && !it.str.startsWith(" ")) {
      text += " ";
    }
    text += it.str;
    prevEnd = it.x + it.w;
  }
  return text;
}

export function assembleLines(items: PositionedItem[]): string[] {
  return clusterLines(items).map(renderLine);
}

// ── Figure/table crop geometry ───────────────────────────────────────────────
// Ported from extraction-service/extractor.py:401-468 (_render_figure_png),
// which is the proven version of this algorithm. Two deliberate differences:
//
//  1. Y axis is FLIPPED. PyMuPDF's origin is top-left with y increasing
//     downward; pdf.js user space is bottom-left with y increasing upward. So
//     "the next heading below" is the next line with a SMALLER y here, and the
//     crop's top edge is the LARGER y.
//  2. Only the keyword list ends a crop — never a bare clause number. A table
//     row that reads "2.5 Copper ..." looks exactly like a numbered clause
//     heading, and cutting there would silently truncate the table mid-data.
//     Over-including a few lines is recoverable; losing rows is not.

export interface PositionedLine {
  text: string;
  /** Baseline Y in PDF user space (origin bottom-left, increases upward). */
  y: number;
  /** Approximate top edge of the glyphs on this line. */
  top: number;
}

/** Lines in reading order (top of page first), each keeping its geometry. */
export function assemblePositionedLines(items: PositionedItem[]): PositionedLine[] {
  return clusterLines(items).map((line) => {
    const y = Math.max(...line.map((it) => it.y));
    const height = Math.max(...line.map((it) => it.h), 0);
    return { text: renderLine(line), y, top: y + height };
  });
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// "TABLE 3" must not match "TABLE 3.1" or "TABLE 30" — without the trailing
// guard, asking for Table 3 on a page that also carries Table 3.1 crops the
// wrong block. A following "(", "—" or end-of-line is fine.
//
// The guard rejects a following digit, or a dot THAT IS FOLLOWED BY a digit —
// not any dot. AS/NZS 3000 writes plenty of captions as "Figure 3.16." with a
// trailing full stop, and a blanket `(?![\d.])` silently failed to find every
// one of them (caught against the real Wiring Rules PDF, not the fixtures).
function labelPattern(kind: "Figure" | "Table", refNumber: string): RegExp {
  return new RegExp(`^${kind.toUpperCase()}\\s*${escapeRegExp(refNumber.trim())}(?!\\d|\\.\\d)`, "i");
}

/**
 * Index of the line that captions the given figure/table, or -1.
 * Anchored at line start so prose references ("the values in Table 3 apply")
 * don't win over the real caption.
 */
export function findLabelLine(
  lines: PositionedLine[],
  kind: "Figure" | "Table",
  refNumber: string,
): number {
  const re = labelPattern(kind, refNumber);
  return lines.findIndex((line) => re.test(line.text.trim()));
}

// What ends a crop. Two hard-won constraints:
//
//  1. NO "CLAUSE" keyword. The Python original included it, but figures and
//     tables are full of annotations like "Clause 2.5.3.1" printed inside the
//     diagram itself — stopping there sliced Figure 2.3 of the Wiring Rules
//     clean in half, hiding most of the diagram. Standards head their clauses
//     with a bare number ("3.12.6 Poles and posts"), never the word "Clause".
//  2. The keyword must be followed by an actual identifier, so prose starting
//     with "Table" or a stray "Section" label inside artwork doesn't qualify.
//
// A bare numbered clause heading is deliberately NOT a stop condition: a table
// row like "2.5 Copper 25" is indistinguishable from one, and truncating a
// table mid-data is far more dangerous than including some trailing prose.
const NEXT_BLOCK_RE = /^(?:FIGURE|TABLE)\s+[A-Z]?\d|^(?:APPENDIX|SECTION)\s+[A-Z\d]/i;

/** Crop rectangle in PDF user space (origin bottom-left). */
export interface CropRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const TOP_PAD = 6;
const BOTTOM_PAD = 4;
// Mirrors the Python's `by0 > crop_top + 20`: a heading must be meaningfully
// below the caption to end it, so a caption wrapping onto a second line (or a
// "(continued)" repeat of the same label) doesn't produce a sliver.
const MIN_GAP_BELOW_LABEL = 20;
const MIN_CROP_HEIGHT = 40;

/**
 * Crop from the caption down to the next block heading, spanning the full page
 * width (standards tables run edge to edge). Returns null when the result
 * isn't plausibly a figure/table — the caller should render the full page.
 */
export function computeCropRect(
  lines: PositionedLine[],
  labelIndex: number,
  pageWidth: number,
  pageHeight: number,
): CropRect | null {
  const label = lines[labelIndex];
  if (!label) return null;

  const top = Math.min(label.top + TOP_PAD, pageHeight);

  // Lines are already ordered top-to-bottom, so the first qualifying heading
  // after the caption is the nearest one below it.
  let bottom = 0;
  const sameLabel = lines[labelIndex].text.trim();
  for (let i = labelIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.y > label.y - MIN_GAP_BELOW_LABEL) continue;
    const text = line.text.trim();
    if (text === sameLabel) continue; // "(continued)" repeat of this same table
    if (NEXT_BLOCK_RE.test(text)) {
      bottom = Math.max(line.top + BOTTOM_PAD, 0);
      break;
    }
  }

  if (top - bottom < MIN_CROP_HEIGHT) return null;
  // Nothing gained by cropping the whole page — let the caller take the simple
  // full-page path instead.
  if (top - bottom > pageHeight * 0.98) return null;

  return { x0: 0, y0: bottom, x1: pageWidth, y1: top };
}

// Pages are read in fixed-size windows rather than one Promise.all over the
// whole document — holding 700 page proxies + text content at once is what
// gets a mobile Safari tab killed on the biggest standards.
const PAGE_WINDOW = 25;

export async function extractPdfText(
  file: File,
  onProgress: (pct: number) => void,
  options?: { maxPages?: number },
): Promise<string> {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  try {
    const numPages = options?.maxPages ? Math.min(pdf.numPages, options.maxPages) : pdf.numPages;
    let completed = 0;
    const pageTexts: string[] = [];

    for (let start = 0; start < numPages; start += PAGE_WINDOW) {
      const windowSize = Math.min(PAGE_WINDOW, numPages - start);
      const windowTexts = await Promise.all(
        Array.from({ length: windowSize }, async (_, i) => {
          const page = await pdf.getPage(start + i + 1);
          const content = await page.getTextContent();

          // Reconstruct lines geometry-aware (see assembleLines above — pure,
          // unit-tested). The old fixed 3pt Y-grid split same-line items across
          // buckets (a decimal point 0.02pt off became its own "line", turning
          // 0.5 into 05) and join("") fused adjacent table columns into one
          // number.
          const items: PositionedItem[] = [];
          for (const item of content.items) {
            if (!("str" in item) || !item.str) continue;
            const t = (item as any).transform;
            items.push({
              str: item.str,
              x: t[4],
              y: t[5],
              w: (item as any).width ?? 0,
              h: (item as any).height || Math.hypot(t[2], t[3]) || 10,
            });
          }
          const sortedLines = assembleLines(items);
          page.cleanup();

          onProgress(++completed / numPages);
          return sortedLines.join("\n");
        }),
      );
      pageTexts.push(...windowTexts);
    }

    return pageTexts.map((text, i) => `\n[PAGE ${i + 1}]\n${text}`).join("");
  } finally {
    // Frees the worker's copy of the document — without this the figure pass
    // later holds a second full document alongside this one.
    pdf.destroy();
  }
}
