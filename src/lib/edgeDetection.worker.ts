// Sobel edge pass, run off the main thread so a big plan doesn't freeze the
// UI on a phone. Receives already-downsampled RGBA pixels (the decode and
// downscale happen on the main thread, where the DOM image APIs live) and
// returns, for every pixel that fired: which way the line there runs across,
// whether that line is straight, and a pixel-indexed grid to look either up
// by position.

export interface EdgePassRequest {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  threshold: number;
}

export interface EdgePassResult {
  // Unit gradient per edge pixel, flat [nx0, ny0, nx1, ny1, ...]. The gradient
  // points across the line the pixel sits on, so this is the line's normal —
  // which is what lets the caller pair up the two faces of a wall.
  normals: Float32Array;
  // 1 where the pixel is ink (dark), 0 where it's paper. width*height. This is
  // what a wall actually IS on a plan — the drawn mark — so the snap measures
  // across this run rather than trying to pair up separate lines.
  ink: Uint8Array;
  // 1 where the line through this edge pixel runs straight, 0 where it curves.
  // Precomputed here rather than per query: it's a fixed property of the
  // image, and working it out during a snap cost tens of ms per tap.
  straight: Uint8Array;
  // width*height, holding the edge index at each pixel or -1 for no edge. Lets
  // the caller step across a wall by position, with no search at all.
  grid: Int32Array;
  count: number;
  width: number;
  height: number;
}

// How far along a line to look when deciding whether it's straight, and how
// closely the normals must agree over that run (cos 15°). Working-image px.
const STRAIGHT_RUN_PX = 4;
const STRAIGHT_COS = 0.96;
// Greyscale below this counts as ink. Plans are dark line work on white paper,
// so the split is wide and this only has to sit somewhere sensible between.
const INK_LEVEL = 150;

export function runEdgePass({ data, width, height, threshold }: EdgePassRequest): EdgePassResult {
  // Greyscale once up front rather than re-averaging each pixel nine times
  // inside the convolution below.
  const grey = new Float32Array(width * height);
  for (let i = 0, p = 0; i < grey.length; i++, p += 4) {
    grey[i] = (data[p] + data[p + 1] + data[p + 2]) / 3;
  }

  const ink = new Uint8Array(width * height);
  for (let i = 0; i < grey.length; i++) if (grey[i] < INK_LEVEL) ink[i] = 1;

  const grid = new Int32Array(width * height).fill(-1);
  const nxs: number[] = [];
  const nys: number[] = [];
  const thresholdSq = threshold * threshold;
  let count = 0;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const tl = grey[i - width - 1];
      const tc = grey[i - width];
      const tr = grey[i - width + 1];
      const ml = grey[i - 1];
      const mr = grey[i + 1];
      const bl = grey[i + width - 1];
      const bc = grey[i + width];
      const br = grey[i + width + 1];

      const gx = -tl + tr - 2 * ml + 2 * mr - bl + br;
      const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;

      const magSq = gx * gx + gy * gy;
      if (magSq > thresholdSq) {
        const mag = Math.sqrt(magSq);
        grid[i] = count++;
        nxs.push(gx / mag);
        nys.push(gy / mag);
      }
    }
  }

  const normals = new Float32Array(count * 2);
  for (let k = 0; k < count; k++) {
    normals[k * 2] = nxs[k];
    normals[k * 2 + 1] = nys[k];
  }

  // Straightness: step along the line (perpendicular to its own normal) and
  // check the normals there still point the same way. A wall face holds its
  // direction; curved ink — landscaping, a door swing, hatching — does not.
  // Grid lookups make this a fixed small cost per edge pixel.
  const straight = new Uint8Array(count);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const k = grid[y * width + x];
      if (k < 0) continue;
      const ax = normals[k * 2];
      const ay = normals[k * 2 + 1];
      // Along the line is the normal turned 90°.
      const tx = -ay;
      const ty = ax;
      let aligned = 0;
      for (let step = -STRAIGHT_RUN_PX; step <= STRAIGHT_RUN_PX; step++) {
        if (step === 0) continue;
        const sx = Math.round(x + tx * step);
        const sy = Math.round(y + ty * step);
        if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
        const j = grid[sy * width + sx];
        if (j < 0) continue;
        if (Math.abs(ax * normals[j * 2] + ay * normals[j * 2 + 1]) > STRAIGHT_COS) aligned++;
      }
      // Most of the run either side has to agree, not one stray neighbour.
      if (aligned >= STRAIGHT_RUN_PX) straight[k] = 1;
    }
  }

  return { normals, straight, ink, grid, count, width, height };
}

// Worker entry point. Guarded so this module can also be imported directly on
// the main thread as a synchronous fallback when Worker construction fails.
if (typeof self !== "undefined" && typeof (self as unknown as { document?: unknown }).document === "undefined") {
  self.onmessage = (e: MessageEvent<EdgePassRequest>) => {
    const result = runEdgePass(e.data);
    // Transfer the buffers rather than copying them back.
    (self as unknown as Worker).postMessage(result, [
      result.normals.buffer,
      result.straight.buffer,
      result.ink.buffer,
      result.grid.buffer,
    ]);
  };
}
