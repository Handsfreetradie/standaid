import { distance, isSingleWallFitting, type Point, type WallSegment, type FittingSpecs, type MeasurementLock } from "./setoutTypes";
import type { FittingType } from "@/components/setout/symbols";

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

// Standard Australian trade heights, floor to fitting centre — both editable
// per-fitting via specs.mountingHeight, same field the downlight beam calc uses.
export const DEFAULT_GPO_HEIGHT = 0.3;
export const DEFAULT_SWITCH_HEIGHT = 1.2;

export function defaultHeightForType(type: FittingType): number | null {
  if (type === "gpo") return DEFAULT_GPO_HEIGHT;
  if (type === "switch") return DEFAULT_SWITCH_HEIGHT;
  return null;
}

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

// Closest point to `p` on the finite wall segment (not the infinite line
// through it) — a fitting near a corner should measure off the wall's actual
// end, not a point that would fall past it.
export function closestPointOnWall(p: Point, wall: WallSegment): Point {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return wall.start;
  let t = ((p.x - wall.start.x) * dx + (p.y - wall.start.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return { x: wall.start.x + t * dx, y: wall.start.y + t * dy };
}

export function perpendicularDistanceToWall(p: Point, wall: WallSegment): number {
  return distance(p, closestPointOnWall(p, wall));
}

// Auto-locks a fitting to its nearest wall(s) (by perpendicular distance) —
// this is what gets read off with a laser on site, so it must be recomputed
// any time the fitting moves ("re-lock on any manual adjustment"). GPOs and
// switches lock to a single nearest wall (plus their mounting height);
// everything else locks to its two nearest walls. Picking whichever wall(s)
// happen to be closest is the simple, predictable default; manual override
// of which wall to lock to is a later enhancement — for now the tradie can
// hand-edit the resulting distance instead.
export function computeMeasurementLock(position: Point, walls: WallSegment[], fittingType?: FittingType): MeasurementLock | null {
  if (walls.length === 0) return null;
  const ranked = walls
    .map((wall) => ({ wallId: wall.id, distance: perpendicularDistanceToWall(position, wall) }))
    .sort((a, b) => a.distance - b.distance);
  if (fittingType && isSingleWallFitting(fittingType)) {
    return { wallA: ranked[0] };
  }
  if (ranked.length < 2) return null;
  return { wallA: ranked[0], wallB: ranked[1] };
}
