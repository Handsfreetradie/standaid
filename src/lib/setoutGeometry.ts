import { distance, type Point, type WallSegment, type FittingSpecs } from "./setoutTypes";

let wallIdCounter = 0;
function nextWallId(): string {
  wallIdCounter += 1;
  return `wall-${Date.now()}-${wallIdCounter}`;
}

// Snaps a freshly-clicked point so the segment from the previous point is
// purely horizontal or purely vertical — whichever axis the raw click is
// closer to. This is the "auto-square to 90°" behaviour for the draw-from-
// scratch flow: a tradie roughly clicking room corners gets a clean
// rectilinear polygon without needing to click precisely.
export function snapOrthogonal(prev: Point, raw: Point): Point {
  const dx = Math.abs(raw.x - prev.x);
  const dy = Math.abs(raw.y - prev.y);
  return dx >= dy ? { x: raw.x, y: prev.y } : { x: prev.x, y: raw.y };
}

// Converts a closed polygon (corner points, in order) into wall segments.
export function polygonToWalls(points: Point[]): WallSegment[] {
  if (points.length < 2) return [];
  return points.map((start, i) => ({
    id: nextWallId(),
    start,
    end: points[(i + 1) % points.length],
  }));
}

export function wallLength(wall: WallSegment): number {
  return distance(wall.start, wall.end);
}

// A point "closes" the sketch if it lands within this many scene units
// (metres) of the first point — lets a tradie tap-close a shape instead of
// needing pixel-perfect precision, especially on a phone screen.
export const CLOSE_SHAPE_THRESHOLD_METRES = 0.35;

export function isNearFirstPoint(points: Point[], candidate: Point): boolean {
  if (points.length < 3) return false;
  return distance(points[0], candidate) <= CLOSE_SHAPE_THRESHOLD_METRES;
}

// Rebuilds a rectilinear polygon from its sketch-order corner points and a
// per-wall real length, keeping each segment's direction (the axis it runs
// along, and which way) exactly as sketched. Used after auto-square sketching
// so the tradie can type in real wall lengths and see the true-to-scale shape.
export function applyWallLengths(sketchPoints: Point[], lengths: number[]): Point[] {
  const rebuilt: Point[] = [sketchPoints[0]];
  for (let i = 0; i < sketchPoints.length; i++) {
    const start = sketchPoints[i];
    const end = sketchPoints[(i + 1) % sketchPoints.length];
    const len = lengths[i] ?? distance(start, end);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const mag = Math.hypot(dx, dy) || 1;
    const dirX = dx / mag;
    const dirY = dy / mag;
    const from = rebuilt[i];
    const next = { x: from.x + dirX * len, y: from.y + dirY * len };
    if (i < sketchPoints.length - 1) rebuilt.push(next);
  }
  return rebuilt;
}

// Defaults for downlights that haven't had their specs edited yet — a
// standard 90mm LED downlight on a typical 2.4m residential ceiling with a
// common 36° beam.
export const DEFAULT_BEAM_ANGLE = 36;
export const DEFAULT_MOUNTING_HEIGHT = 2.4;
export const BEAM_ANGLE_OPTIONS = [24, 36, 60, 90];

// Indicative light-pool radius on the floor, from beam angle and mounting
// height — basic trig (radius = height * tan(halfBeamAngle)), NOT a
// photometric/lux calculation. Real coverage depends on reflectance,
// obstructions, fitting output etc. — this is a rough "will these overlap or
// leave a gap" guide only, and must be labelled as such wherever it's shown.
export function lightPoolRadius(specs: FittingSpecs): number {
  const beamAngle = specs.beamAngle ?? DEFAULT_BEAM_ANGLE;
  const height = specs.mountingHeight ?? DEFAULT_MOUNTING_HEIGHT;
  const halfAngleRad = (beamAngle / 2) * (Math.PI / 180);
  return height * Math.tan(halfAngleRad);
}

// Two light pools count as "significantly" overlapping (worth flagging as
// possibly doubled-up) once their circles overlap by more than this fraction
// of their combined radii — i.e. distance between centres is less than this
// fraction of (rA + rB). A lower fraction flags earlier/lighter overlap.
const OVERLAP_WARNING_FACTOR = 0.6;

export function poolsSignificantlyOverlap(centreA: Point, radiusA: number, centreB: Point, radiusB: number): boolean {
  const d = distance(centreA, centreB);
  return d < (radiusA + radiusB) * OVERLAP_WARNING_FACTOR;
}
