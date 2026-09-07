// Rasterises part of a plan PDF at the resolution actually needed on screen.
//
// Shared by the import flow and the workspace, because the arithmetic that
// maps scene metres to PDF points has to agree in both — a tile that disagrees
// by a hair sits visibly offset from the plan under it.

// Scale the plan is first rasterised at. Everything that converts between
// scene metres and PDF points goes through this, so it must not drift.
export const BASE_PDF_SCALE = 2;
// A re-render never exceeds this on either side, so a deep zoom on a big
// screen can't allocate a canvas a phone won't survive.
// Only binds on large desktop viewports; a phone never gets near it. Sized so
// a typical screen renders at full device resolution rather than being capped
// back into softness.
const MAX_TILE_PX = 4096;
// Rasterise this much more than is actually on screen, so a nudge of the plan
// doesn't immediately expose the soft base image at the edges. Every pixel
// spent on margin is a pixel not spent on what's actually visible, and the
// view re-renders once panning stops anyway — so this stays modest, and the
// on-screen area keeps full device resolution.
const TILE_MARGIN = 1.35;

// The slice of pdf.js's page API used here, named so this file doesn't depend
// on pdfjs-dist's types at module load (it's imported lazily below).
export interface PdfPage {
  getViewport(options: { scale: number }): { width: number; height: number; convertToViewportPoint(x: number, y: number): number[] };
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  render(options: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
    transform?: number[];
  }): { promise: Promise<void>; cancel(): void };
}

/**
 * Rasterises just the part of the plan currently on screen, at the screen's
 * own pixel density.
 *
 * This is what makes a deep zoom sharp. The base image is rendered once at a
 * fixed scale, so magnifying it past that is magnifying pixels — at 600% the
 * linework turns to mush. A PDF is vector, so instead of stretching pixels we
 * ask it for the visible rectangle again at the resolution actually needed.
 *
 * @param view  the on-screen region, in scene metres
 * @returns the tile plus the region it ACTUALLY covers — rounding the canvas
 *          to whole pixels means that isn't exactly what was asked for, and
 *          placing it as if it were would stretch it very slightly.
 */
export async function renderPdfTile(
  page: PdfPage,
  view: { x: number; y: number; w: number; h: number; screenWidth: number },
  plan: { w: number; h: number },
  pixelsPerMetre: number
): Promise<{ href: string; revoke: () => void; x: number; y: number; coveredW: number; coveredH: number } | null> {
  // Scene metres -> PDF points. Base image pixels are scene * ppm, and those
  // were themselves rendered at BASE_PDF_SCALE points-to-pixels.
  const toPdfPoints = pixelsPerMetre / BASE_PDF_SCALE;
  if (view.w <= 0 || view.h <= 0) return null;

  const dprEarly = window.devicePixelRatio || 1;
  // Pixels per scene unit the screen is actually asking for right now. Render
  // at this and the result is exactly as sharp as the display can show.
  const wantedDensity = (view.screenWidth * dprEarly) / view.w;

  // Prefer to rasterise the ENTIRE plan: then there's no tile boundary at all,
  // panning never exposes anything soft, and one render serves every position
  // at this zoom. Only when the whole plan won't fit the pixel budget — a deep
  // zoom on a big drawing — fall back to the part that's on screen plus a
  // margin.
  const wholePlanPx = plan.w * wantedDensity;
  const wholePlanFits =
    wholePlanPx <= MAX_TILE_PX && plan.h * wantedDensity <= MAX_TILE_PX;
  const region = wholePlanFits
    ? { x: 0, y: 0, w: plan.w, h: plan.h }
    : {
        x: view.x - (view.w * (TILE_MARGIN - 1)) / 2,
        y: view.y - (view.h * (TILE_MARGIN - 1)) / 2,
        w: view.w * TILE_MARGIN,
        h: view.h * TILE_MARGIN,
      };
  const viewPts = region.w * toPdfPoints;
  if (viewPts <= 0) return null;

  const aspect = region.h / region.w;
  // Both sides have to come down together — clamping only the taller one would
  // render less of the plan than the tile then claims to cover, squashing it.
  // Enough pixels to hold `wantedDensity` across whatever region was chosen,
  // so widening the area never costs sharpness — only the cap can.
  let targetPx = Math.min(Math.round(region.w * wantedDensity), MAX_TILE_PX);
  if (targetPx * aspect > MAX_TILE_PX) targetPx = Math.floor(MAX_TILE_PX / aspect);

  const width = targetPx;
  const height = Math.round(targetPx * aspect);
  if (width < 1 || height < 1) return null;

  const scale = width / viewPts;
  if (!Number.isFinite(scale) || scale <= 0) return null;
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  // The page is drawn full size and shifted so the requested region lands at
  // the canvas origin — pdf.js has no crop, but it does take a transform.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  await page.render({
    canvasContext: ctx,
    viewport,
    transform: [1, 0, 0, 1, -region.x * toPdfPoints * scale, -region.y * toPdfPoints * scale],
  }).promise;

  // WebP encodes far faster than PNG at this size. Quality is high enough to
  // be indistinguishable on linework, and browsers without WebP encoding hand
  // back a PNG instead, which still works.
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.95));
  if (!blob) return null;
  const href = URL.createObjectURL(blob);
  // Decode before handing it over. Swapping in an undecoded image makes the
  // plan visibly blink and jump as the browser catches up mid-frame.
  try {
    const img = new Image();
    img.src = href;
    await img.decode();
  } catch {
    // Older browsers without decode() just paint a frame later.
  }
  return {
    href,
    revoke: () => URL.revokeObjectURL(href),
    // Where the tile actually landed, which is the grown region and — because
    // the canvas is a whole number of pixels — not quite its requested size.
    x: region.x,
    y: region.y,
    coveredW: width / scale / toPdfPoints,
    coveredH: height / scale / toPdfPoints,
  };
}
