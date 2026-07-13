// Geometry-aware PDF text line assembly, shared by StandardsUpload and the
// extraction regression tests. This is where the "0.5 ohms → 05 ohms" class
// of corruption lives, so the logic is pure and unit-tested: PDFs emit kerned
// runs as separate items ("0", ".", "5"), and table cells on one row as
// separate items — get clustering or joining wrong and numbers are silently
// fabricated.

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
    for (const it of line) {
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
