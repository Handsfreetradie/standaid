// Finds the CENTRE OF WALLS on an uploaded plan, so a tap while tracing lands
// where a tradie actually sets out to.
//
// Deliberately NOT an attempt to work out which lines are walls in the way the
// old AI extraction did — that proved unreliable on real drawings. This only
// looks for the one thing a wall reliably is on any plan: two straight
// parallel lines a believable thickness apart. It offers the middle of that
// pair, and nothing else. The tradie stays the one deciding what's a wall.
//
// The detected lines are never drawn: on a real plan essentially every line is
// ink, so tinting them just recolours the drawing and buries the detail being
// read. The plan's own linework is the guide; detection only moves the tap.

import { runEdgePass, type EdgePassRequest, type EdgePassResult } from "./edgeDetection.worker";

// The Sobel pass is O(pixels), so the full-resolution render of a big sheet
// would stall even a good phone — but downsampling too far is worse, because
// walls stop being resolvable at all. An A1 at 1:100 works out around 57
// pixels per metre at the base render; at 1200 that collapses to ~14, which
// makes a 230mm wall 3 pixels wide and a 90mm stud barely 1 — the two faces
// merge and there is no pair left to find the middle of. At 3000 a 230mm wall
// is ~8 pixels across, which the pairing can actually see.
const MAX_WORKING_EDGE = 3000;
// Gradient magnitude a pixel must clear to count as ink. Plans are line art on
// white, so real lines clear this easily while paper texture and JPEG noise
// don't.
const EDGE_THRESHOLD = 110;

// Plausible built wall thicknesses in metres, face to face — a thin stud
// partition through to double brick. Anything outside this isn't a wall, which
// is what stops the snap grabbing landscaping, furniture or the title block.
const MIN_WALL_THICKNESS_M = 0.06;
const MAX_WALL_THICKNESS_M = 0.4;
// Two faces of one wall run parallel, so their normals are parallel or
// anti-parallel — cos 20°.
const PARALLEL_COS = 0.94;
// Cap on how far the search for a nearby face reaches, in working pixels.
// Bounds the cost of a query when the tradie is zoomed right out and 20 screen
// pixels covers a lot of plan.
const MAX_SEARCH_PX = 40;
// Floor on the same search, expressed in metres of plan rather than pixels of
// screen, for two reasons.
//
// First, the caller's tolerance arrives in SCREEN pixels, which shrinks to
// nothing in plan terms as the tradie zooms in: past roughly a 1.5m-wide view,
// 20 screen pixels is less than ONE pixel of the detected image, the search
// collapses to the single pixel under the cursor, and nothing snaps however
// carefully you aim.
//
// Second, and less obvious: pointing at the MIDDLE of a wall puts its faces
// half a thickness away. Any floor smaller than that makes the centre of a
// thick wall the one place the snap refuses to work — aiming better makes it
// worse. So the search always reaches at least half of the widest wall it
// would accept.
const MIN_SEARCH_M = MAX_WALL_THICKNESS_M / 2;

export interface Point {
  x: number;
  y: number;
}

export interface PlanEdges {
  index: WallSnapIndex;
  // How many edge pixels fired, for reporting to the user.
  count: number;
}

/**
 * Snaps a point to the centre of the nearest wall.
 *
 * Everything is answered against the pixel grid the worker built, so a query
 * is a small bounded window scan plus a march straight across the wall — no
 * spatial-hash traversal, no per-query geometry over thousands of points. That
 * matters because the tap preview runs this on every pointer move.
 */
export class WallSnapIndex {
  private normals: Float32Array;
  private straight: Uint8Array;
  private ink: Uint8Array;
  private grid: Int32Array;
  private width: number;
  private height: number;
  // Working-image pixels per scene metre.
  private pxPerMetre: number;

  constructor(pass: EdgePassResult, pxPerMetre: number) {
    this.normals = pass.normals;
    this.straight = pass.straight;
    this.ink = pass.ink;
    this.grid = pass.grid;
    this.width = pass.width;
    this.height = pass.height;
    this.pxPerMetre = pxPerMetre;
  }

  private edgeAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return -1;
    return this.grid[y * this.width + x];
  }

  private isInk(x: number, y: number): boolean {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return false;
    return this.ink[py * this.width + px] === 1;
  }

  /**
   * Measures across the drawn mark at a boundary and returns how far its ink
   * runs, and which way.
   *
   * `nx`/`ny` is the boundary's normal, so stepping along it crosses the mark.
   * Returns the signed distance to the far side, or 0 if there's no ink beside
   * this boundary or the run is too wide to be a wall.
   */
  private inkRunAcross(ex: number, ey: number, nx: number, ny: number): number {
    const maxRun = MAX_WALL_THICKNESS_M * this.pxPerMetre;
    // The gradient points across the mark but not reliably INTO it, so find
    // which side the ink is actually on.
    const dir = this.isInk(ex + nx, ey + ny) ? 1 : this.isInk(ex - nx, ey - ny) ? -1 : 0;
    if (dir === 0) return 0;

    let far = 0;
    for (let t = 1; t <= maxRun; t += 0.5) {
      if (!this.isInk(ex + nx * dir * t, ey + ny * dir * t)) break;
      far = t;
    }
    // Ran off the end of what a wall could be — this is a filled region
    // (hatching, a title block, a solid symbol), not a wall to set out to.
    if (far <= 0 || far >= maxRun) return 0;
    return dir * far;
  }

  /**
   * The centre of the drawn wall nearest a scene point, or null if there isn't
   * one within `tolerance`.
   *
   * On a plan the wall IS the black mark — sometimes a single thick stroke,
   * sometimes a filled band between two faces. Either way what a tradie sets
   * out to is the middle of that mark, so this finds the mark's boundary,
   * measures straight across its ink, and returns the halfway point. Snapping
   * to the boundary itself would be half a wall out, which is what it did
   * before.
   *
   * Ink that curves rather than running straight, or whose run is wider than
   * any wall, yields nothing — the tap then lands where it was put.
   */
  nearestWallCentre(sceneX: number, sceneY: number, tolerance: number): Point | null {
    const cx = sceneX * this.pxPerMetre;
    const cy = sceneY * this.pxPerMetre;
    // Clamped, not used raw — see MIN_SEARCH_M for why zooming in otherwise
    // shrinks this below one pixel of the detected image.
    const tolPx = Math.min(
      MAX_SEARCH_PX,
      Math.max(MIN_SEARCH_M * this.pxPerMetre, tolerance * this.pxPerMetre)
    );
    const reach = Math.ceil(tolPx);
    const tolPxSq = tolPx * tolPx;

    // Each boundary near the cursor gives one reading of where the centre is.
    // They disagree by a fraction of a pixel depending on which side was
    // measured from, so the agreeing ones are averaged rather than trusting
    // whichever happened to be nearest the cursor.
    const midXs: number[] = [];
    const midYs: number[] = [];
    let bestIdx = -1;
    let bestDistSq = Infinity;

    const originX = Math.round(cx);
    const originY = Math.round(cy);
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        if (dx * dx + dy * dy > tolPxSq) continue;
        const px = originX + dx;
        const py = originY + dy;
        const k = this.edgeAt(px, py);
        if (k < 0 || !this.straight[k]) continue;

        const nx = this.normals[k * 2];
        const ny = this.normals[k * 2 + 1];
        const across = this.inkRunAcross(px, py, nx, ny);
        if (across === 0) continue;

        const midX = px + (nx * across) / 2;
        const midY = py + (ny * across) / 2;
        const distSq = (midX - cx) ** 2 + (midY - cy) ** 2;
        if (distSq < bestDistSq) {
          bestDistSq = distSq;
          bestIdx = midXs.length;
        }
        midXs.push(midX);
        midYs.push(midY);
      }
    }
    if (bestIdx < 0) return null;

    // Average only the readings that agree with the closest — anything further
    // off belongs to a different wall and must not be blended into this one.
    const anchorX = midXs[bestIdx];
    const anchorY = midYs[bestIdx];
    const clusterPxSq = (MIN_WALL_THICKNESS_M * this.pxPerMetre) ** 2;
    let sumX = 0;
    let sumY = 0;
    let n = 0;
    for (let i = 0; i < midXs.length; i++) {
      if ((midXs[i] - anchorX) ** 2 + (midYs[i] - anchorY) ** 2 > clusterPxSq) continue;
      sumX += midXs[i];
      sumY += midYs[i];
      n++;
    }
    return { x: sumX / n / this.pxPerMetre, y: sumY / n / this.pxPerMetre };
  }
}

// Decodes the plan, downsamples it, and returns the pixels plus the scale
// factor back to the original image.
async function loadDownsampled(imageUrl: string): Promise<{ imageData: ImageData; scale: number }> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = "anonymous";
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Could not load the plan image"));
    el.src = imageUrl;
  });

  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  const scale = longest > MAX_WORKING_EDGE ? MAX_WORKING_EDGE / longest : 1;
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not create a canvas to read the plan");
  ctx.drawImage(img, 0, 0, width, height);

  return { imageData: ctx.getImageData(0, 0, width, height), scale };
}

// Runs the pass in a worker, falling back to running it inline if the worker
// can't be constructed (older WebViews, blocked module workers).
function runPass(request: EdgePassRequest): Promise<EdgePassResult> {
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./edgeDetection.worker.ts", import.meta.url), { type: "module" });
    } catch {
      resolve(runEdgePass(request));
      return;
    }

    const settle = (result: EdgePassResult) => {
      worker.terminate();
      resolve(result);
    };
    worker.onmessage = (e: MessageEvent<EdgePassResult>) => settle(e.data);
    worker.onerror = () => settle(runEdgePass(request));
    // Deliberately NOT transferring the pixel buffer: a module worker that
    // fails to load fires onerror, and the inline fallback above needs the
    // pixels still attached to this side. Structured-cloning a few MB costs a
    // millisecond or two; a detached buffer would silently yield zero edges.
    worker.postMessage(request);
  });
}

/**
 * Finds the walls on a plan.
 *
 * @param imageUrl        the plan raster
 * @param pixelsPerMetre  scale of the ORIGINAL image, so the returned index
 *                        answers in the scene units the canvas works in
 */
export async function detectPlanEdges(imageUrl: string, pixelsPerMetre: number): Promise<PlanEdges> {
  const { imageData, scale } = await loadDownsampled(imageUrl);

  const pass = await runPass({
    data: imageData.data,
    width: imageData.width,
    height: imageData.height,
    threshold: EDGE_THRESHOLD,
  });

  // The image was downsampled, so a working pixel covers more ground than an
  // original one — fold that into the scale the index answers in.
  return { index: new WallSnapIndex(pass, scale * pixelsPerMetre), count: pass.count };
}
