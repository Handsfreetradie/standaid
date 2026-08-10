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
// unlike a fixed grid), sort by X within each line, and insert spaces from
// the real horizontal gap between items.
export function assembleLines(items: PositionedItem[]): string[] {
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

  return lines.map((line) => {
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
  });
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
