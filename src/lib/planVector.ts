// Reads the actual line geometry out of a vector PDF.
//
// The plan already contains the exact lines — coordinates and stroke widths,
// to whatever precision the drafter worked at. Rasterising it and then
// measuring greyscale ramps to recover those lines back (see edgeDetection.ts)
// throws that away and hands back an estimate: about 3mm at best, because one
// pixel of the working image is nearly 30mm of building. When the PDF is
// vector there is no reason to estimate anything.
//
// So this is the exact path, and edgeDetection is the fallback for scans and
// photographs, where pixels are genuinely all there is.

import type { Point } from "./setoutTypes";

// Path ops that describe straight geometry. Curves are deliberately not
// followed: on a plan they are door swings, landscaping and furniture, never
// walls, so ignoring them removes most of the clutter for free.
const OP_MOVE_TO = 13;
const OP_LINE_TO = 14;
const OP_CURVE_TO = 15;
const OP_CURVE_TO_2 = 16;
const OP_CURVE_TO_3 = 17;
const OP_CLOSE_PATH = 18;
const OP_RECTANGLE = 19;

const OP_SAVE = 10;
const OP_RESTORE = 11;
const OP_TRANSFORM = 12;
const OP_SET_LINE_WIDTH = 2;
const OP_CONSTRUCT_PATH = 91;
const OP_STROKE = 20;
const OP_CLOSE_STROKE = 21;
const OP_FILL = 22;
const OP_EO_FILL = 23;
const OP_FILL_STROKE = 24;
const OP_EO_FILL_STROKE = 25;
const OP_CLOSE_FILL_STROKE = 26;

const STROKING_OPS = new Set([OP_STROKE, OP_CLOSE_STROKE, OP_FILL_STROKE, OP_EO_FILL_STROKE, OP_CLOSE_FILL_STROKE]);
const FILLING_OPS = new Set([OP_FILL, OP_EO_FILL, OP_FILL_STROKE, OP_EO_FILL_STROKE, OP_CLOSE_FILL_STROKE]);
const PATH_ENDING_OPS = new Set([...STROKING_OPS, ...FILLING_OPS]);

type Matrix = [number, number, number, number, number, number];

/** One drawn straight line, in scene units (metres). */
export interface PlanLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  // Half the stroke width, so a face is exactly this far off the centreline.
  // Zero for the boundary of a filled shape, which has no width of its own.
  halfWidth: number;
}

export interface VectorSnap {
  point: Point;
  /** The line that was snapped to, so callers can measure against it later. */
  line: PlanLine;
}

// Minimal slice of pdf.js used here, so this module doesn't pull in its types.
interface PdfViewport {
  convertToViewportPoint(x: number, y: number): number[];
}
export interface PdfPageForVector {
  getViewport(options: { scale: number }): PdfViewport;
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
}

function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

// PDF concatenation order: the new matrix applies before the existing one.
function concatMatrix(m: Matrix, ctm: Matrix): Matrix {
  return [
    m[0] * ctm[0] + m[1] * ctm[2],
    m[0] * ctm[1] + m[1] * ctm[3],
    m[2] * ctm[0] + m[3] * ctm[2],
    m[2] * ctm[1] + m[3] * ctm[3],
    m[4] * ctm[0] + m[5] * ctm[2] + ctm[4],
    m[4] * ctm[1] + m[5] * ctm[3] + ctm[5],
  ];
}

// Uniform scale factor of a matrix, for carrying stroke widths through.
function matrixScale(m: Matrix): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
}

/**
 * Pulls every straight drawn line out of a PDF page.
 *
 * @param pixelsPerMetre  scale of the base raster, so the result lands in the
 *                        same scene units the canvas works in
 * @param baseScale       the scale the base raster was rendered at, so vector
 *                        and raster coordinates agree exactly
 */
export async function extractPlanLines(
  page: PdfPageForVector,
  pixelsPerMetre: number,
  baseScale: number
): Promise<PlanLine[]> {
  const list = await page.getOperatorList();
  const viewport = page.getViewport({ scale: baseScale });

  // User space -> base raster pixels -> scene metres, exactly as the displayed
  // image was placed, so a snapped point sits where the line looks.
  const toScene = (x: number, y: number): [number, number] => {
    const [vx, vy] = viewport.convertToViewportPoint(x, y);
    return [vx / pixelsPerMetre, vy / pixelsPerMetre];
  };

  const lines: PlanLine[] = [];
  const stack: { ctm: Matrix; lineWidth: number }[] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  let lineWidth = 1;

  // Subpaths of the path currently being built, in user space.
  let subpaths: [number, number][][] = [];
  let current: [number, number][] = [];

  const endSubpath = () => {
    if (current.length > 1) subpaths.push(current);
    current = [];
  };

  const commitPath = (stroked: boolean) => {
    endSubpath();
    const halfWidth = stroked ? (lineWidth * matrixScale(ctm) * baseScale) / pixelsPerMetre / 2 : 0;
    for (const path of subpaths) {
      for (let i = 1; i < path.length; i++) {
        const [x1, y1] = toScene(path[i - 1][0], path[i - 1][1]);
        const [x2, y2] = toScene(path[i][0], path[i][1]);
        // Zero-length segments carry no direction and can't be snapped to.
        if (x1 === x2 && y1 === y2) continue;
        lines.push({ x1, y1, x2, y2, halfWidth });
      }
    }
    subpaths = [];
  };

  for (let i = 0; i < list.fnArray.length; i++) {
    const fn = list.fnArray[i];
    const args = list.argsArray[i] as never[];

    if (fn === OP_SAVE) {
      stack.push({ ctm, lineWidth });
    } else if (fn === OP_RESTORE) {
      const prev = stack.pop();
      if (prev) {
        ctm = prev.ctm;
        lineWidth = prev.lineWidth;
      }
    } else if (fn === OP_TRANSFORM) {
      ctm = concatMatrix(args as unknown as Matrix, ctm);
    } else if (fn === OP_SET_LINE_WIDTH) {
      lineWidth = args[0] as unknown as number;
    } else if (fn === OP_CONSTRUCT_PATH) {
      const ops = args[0] as unknown as number[];
      const coords = args[1] as unknown as number[];
      let c = 0;
      for (const op of ops) {
        if (op === OP_MOVE_TO) {
          endSubpath();
          current = [applyMatrix(ctm, coords[c], coords[c + 1])];
          c += 2;
        } else if (op === OP_LINE_TO) {
          current.push(applyMatrix(ctm, coords[c], coords[c + 1]));
          c += 2;
        } else if (op === OP_CLOSE_PATH) {
          if (current.length > 1) current.push(current[0]);
        } else if (op === OP_RECTANGLE) {
          // A filled wall is very often a rectangle rather than a stroke.
          const [x, y, w, h] = [coords[c], coords[c + 1], coords[c + 2], coords[c + 3]];
          c += 4;
          endSubpath();
          subpaths.push([
            applyMatrix(ctm, x, y),
            applyMatrix(ctm, x + w, y),
            applyMatrix(ctm, x + w, y + h),
            applyMatrix(ctm, x, y + h),
            applyMatrix(ctm, x, y),
          ]);
        } else if (op === OP_CURVE_TO) {
          // Skipped, but the pen still moves — otherwise the next lineTo would
          // draw a segment from the wrong place.
          c += 6;
          endSubpath();
          current = [applyMatrix(ctm, coords[c - 2], coords[c - 1])];
        } else if (op === OP_CURVE_TO_2 || op === OP_CURVE_TO_3) {
          c += 4;
          endSubpath();
          current = [applyMatrix(ctm, coords[c - 2], coords[c - 1])];
        }
      }
    } else if (PATH_ENDING_OPS.has(fn)) {
      commitPath(STROKING_OPS.has(fn));
    }
  }

  return lines;
}

/**
 * Snaps a point to the exact geometry of a plan.
 *
 * Every answer is a perpendicular foot on a real line from the PDF, so the
 * only error left is whatever the drafter and the scale calibration bring —
 * nothing is estimated here.
 */
export class PlanVectorIndex {
  private lines: PlanLine[];
  // Uniform grid of line indices, so a query tests a handful of candidates
  // rather than every line on the sheet.
  private cells = new Map<string, number[]>();
  private cellSize: number;

  constructor(lines: PlanLine[], cellSize = 0.5) {
    this.lines = lines;
    this.cellSize = cellSize;
    lines.forEach((l, idx) => {
      // Walk the segment, dropping it into every cell it passes through.
      const steps = Math.max(1, Math.ceil(Math.hypot(l.x2 - l.x1, l.y2 - l.y1) / cellSize));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const key = this.keyFor(l.x1 + (l.x2 - l.x1) * t, l.y1 + (l.y2 - l.y1) * t);
        const bucket = this.cells.get(key);
        if (bucket) {
          if (bucket[bucket.length - 1] !== idx) bucket.push(idx);
        } else {
          this.cells.set(key, [idx]);
        }
      }
    });
  }

  get size(): number {
    return this.lines.length;
  }

  private keyFor(x: number, y: number): string {
    return `${Math.floor(x / this.cellSize)},${Math.floor(y / this.cellSize)}`;
  }

  // Perpendicular foot of (px,py) on a segment, clamped to its ends.
  private footOn(l: PlanLine, px: number, py: number): { x: number; y: number; distSq: number } {
    const dx = l.x2 - l.x1;
    const dy = l.y2 - l.y1;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq > 0 ? Math.max(0, Math.min(1, ((px - l.x1) * dx + (py - l.y1) * dy) / lenSq)) : 0;
    const fx = l.x1 + dx * t;
    const fy = l.y1 + dy * t;
    return { x: fx, y: fy, distSq: (px - fx) ** 2 + (py - fy) ** 2 };
  }

  private candidates(x: number, y: number, tolerance: number): number[] {
    const reach = Math.max(1, Math.ceil(tolerance / this.cellSize));
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    const seen = new Set<number>();
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const bucket = this.cells.get(`${cx + dx},${cy + dy}`);
        if (bucket) for (const idx of bucket) seen.add(idx);
      }
    }
    return [...seen];
  }

  private nearest(x: number, y: number, tolerance: number): { line: PlanLine; fx: number; fy: number } | null {
    let best: { line: PlanLine; fx: number; fy: number } | null = null;
    let bestDistSq = tolerance * tolerance;
    for (const idx of this.candidates(x, y, tolerance)) {
      const l = this.lines[idx];
      const foot = this.footOn(l, x, y);
      // Measure to the drawn edge, so a thick line is grabbed from anywhere on
      // it rather than only near its centre.
      const surfaceDist = Math.max(0, Math.sqrt(foot.distSq) - l.halfWidth);
      if (surfaceDist * surfaceDist < bestDistSq) {
        bestDistSq = surfaceDist * surfaceDist;
        best = { line: l, fx: foot.x, fy: foot.y };
      }
    }
    return best;
  }

  /** The exact centreline of the nearest drawn line — used for tracing walls. */
  nearestCentre(x: number, y: number, tolerance: number): VectorSnap | null {
    const hit = this.nearest(x, y, tolerance);
    if (!hit) return null;
    return { point: { x: hit.fx, y: hit.fy }, line: hit.line };
  }

  /**
   * The exact face of the nearest drawn line, on whichever side the point is —
   * what a tradie pulls a tape to, and what fittings are measured from.
   */
  nearestEdge(x: number, y: number, tolerance: number): VectorSnap | null {
    const hit = this.nearest(x, y, tolerance);
    if (!hit) return null;
    const { line, fx, fy } = hit;
    if (line.halfWidth <= 0) return { point: { x: fx, y: fy }, line };
    // Offset from the centreline toward the point, by exactly half the width.
    let ox = x - fx;
    let oy = y - fy;
    const len = Math.hypot(ox, oy);
    if (len < 1e-9) {
      // Dead on the centreline: no side implied, so take the normal.
      const dx = line.x2 - line.x1;
      const dy = line.y2 - line.y1;
      const dlen = Math.hypot(dx, dy) || 1;
      ox = -dy / dlen;
      oy = dx / dlen;
    } else {
      ox /= len;
      oy /= len;
    }
    return { point: { x: fx + ox * line.halfWidth, y: fy + oy * line.halfWidth }, line };
  }
}

/**
 * Loads a stored plan PDF and reads its geometry.
 *
 * Used by the workspace, which only has the file in storage — the setup flow
 * already holds the page object and calls extractPlanLines directly.
 * Resolves null when the file isn't a PDF or has no real geometry in it (a
 * scan), leaving the caller to fall back to the pixel detector.
 */
export async function loadPlanVectorIndex(
  fileUrl: string,
  contentType: string | null,
  pixelsPerMetre: number,
  baseScale: number
): Promise<PlanVectorIndex | null> {
  if (contentType && !contentType.includes("pdf")) return null;
  // A page with real drawn geometry has thousands of lines; a scan wrapped in
  // a PDF has a handful, and is better served by detecting them in pixels.
  const MIN_VECTOR_LINES = 20;
  try {
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
    const buffer = await (await fetch(fileUrl)).arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
    const page = await pdf.getPage(1);
    const lines = await extractPlanLines(page as unknown as PdfPageForVector, pixelsPerMetre, baseScale);
    return lines.length >= MIN_VECTOR_LINES ? new PlanVectorIndex(lines) : null;
  } catch {
    return null;
  }
}
