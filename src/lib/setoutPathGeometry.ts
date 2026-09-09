import { distance, type Point, type WallSegment } from "./setoutTypes";
import { closestPointOnWall, perpendicularDistanceToWall, pointAtOffset, wallLength } from "./setoutGeometry";

// The per-wall helpers in setoutGeometry.ts (closestPointOnWall,
// perpendicularDistanceToWall, pointAtOffset, wallLength) only ever touch a
// WallSegment's `start`/`end` — never `id` or `kind` — so a run's segment can
// borrow all of that point-on-segment maths by wrapping it in a throwaway
// WallSegment instead of reimplementing projection/clamping here.
function asSegment(a: Point, b: Point): WallSegment {
  return { id: "", start: a, end: b };
}

// Total run length in metres, summing every segment. Zero-length (coincident
// consecutive points) segments simply contribute 0 — no division happens
// here, so a run mid-draw with a just-placed duplicate point is safe.
export function pathLength(path: Point[]): number {
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    total += wallLength(asSegment(path[i], path[i + 1]));
  }
  return total;
}

// The point that sits `distance` metres along the run from its start.
// Clamps to the start/end rather than extrapolating past either.
export function pointAtDistanceAlongPath(path: Point[], distanceAlong: number): Point {
  // Nothing to anchor to yet — a run being drawn point-by-point can briefly
  // be empty. Returning the origin rather than throwing keeps the canvas
  // rendering (or not rendering) rather than crashing mid-draw.
  if (path.length === 0) return { x: 0, y: 0 };
  // A single point is a zero-length run — every distance along it is that
  // one point.
  if (path.length === 1) return path[0];

  const clamped = Math.max(0, Math.min(distanceAlong, pathLength(path)));

  let travelled = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const segment = asSegment(path[i], path[i + 1]);
    const segLen = wallLength(segment);
    // The `|| last segment` guard covers float rounding: pathLength() sums
    // the same per-segment lengths we're walking here, but summation order
    // can leave `clamped` a hair above the running total on the final
    // segment — pointAtOffset clamps its own offset to [0, segLen] anyway,
    // so falling through to it is always safe.
    if (clamped <= travelled + segLen || i === path.length - 2) {
      return pointAtOffset(segment, clamped - travelled);
    }
    travelled += segLen;
  }
  return path[path.length - 1];
}

// The halfway point ALONG THE RUN (by distance travelled, not the average of
// the vertices) — used to place the length label on the plan. An L-shaped
// run's label should sit on the corner it turns at, not floating off to one
// side of the average of its 3 vertices.
export function pathMidpoint(path: Point[]): Point {
  return pointAtDistanceAlongPath(path, pathLength(path) / 2);
}

// Shortest distance in metres from an arbitrary point to the run. This is
// what hit-testing a tap on the canvas uses.
export function distanceToPath(point: Point, path: Point[]): number {
  // No run to be near — Infinity reads as "not close" to every caller
  // (hit-testing, snapping) without them needing a special empty-path check.
  if (path.length === 0) return Infinity;
  if (path.length === 1) return distance(point, path[0]);

  let min = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const d = perpendicularDistanceToWall(point, asSegment(path[i], path[i + 1]));
    if (d < min) min = d;
  }
  return min;
}

// The closest point ON the run to an arbitrary point, plus how far along the
// run it sits. Used to snap and to re-point measurements at a run.
export function closestPointOnPath(point: Point, path: Point[]): { point: Point; distanceAlong: number } {
  if (path.length === 0) return { point: { x: 0, y: 0 }, distanceAlong: 0 };
  if (path.length === 1) return { point: path[0], distanceAlong: 0 };

  let bestPoint = path[0];
  let bestDist = Infinity;
  let bestTravelled = 0;
  let travelled = 0;

  for (let i = 0; i < path.length - 1; i++) {
    const segment = asSegment(path[i], path[i + 1]);
    const candidate = closestPointOnWall(point, segment);
    const d = distance(point, candidate);
    if (d < bestDist) {
      bestDist = d;
      bestPoint = candidate;
      // closestPointOnWall clamps its result onto the segment, so the
      // candidate is collinear with (and between) segment.start/end — its
      // Euclidean distance from segment.start IS the distance travelled to
      // reach it, no separate t/projection lookup needed.
      bestTravelled = travelled + distance(segment.start, candidate);
    }
    travelled += wallLength(segment);
  }

  return { point: bestPoint, distanceAlong: bestTravelled };
}

// Axis-aligned bounds, for fitting the view and for export page layout.
export function pathBounds(path: Point[]): { minX: number; minY: number; maxX: number; maxY: number } {
  // A degenerate zero-size box at the origin rather than +/-Infinity — a
  // caller that naively unions this into a running bounds accumulator
  // doesn't get poisoned by an infinity it forgot to guard against.
  if (path.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  let minX = path[0].x;
  let minY = path[0].y;
  let maxX = path[0].x;
  let maxY = path[0].y;
  for (const p of path) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

// Degrees clockwise from plan "up" for a bare direction vector — the same
// atan2(dx, -dy) convention used for wall-mount rotation elsewhere in this
// app (see rotationFacingRoom in setoutGeometry.ts). Not imported from
// there: that helper derives its vector from a wall + room centroid (facing
// INTO the room), a different question from "which way does the run point",
// so only the final vector-to-angle formula is shared, reproduced here.
function vectorAngleDegrees(dx: number, dy: number): number {
  const radians = Math.atan2(dx, -dy);
  return ((radians * 180) / Math.PI + 360) % 360;
}

// The direction of the run at a given distance along it, in degrees clockwise
// from plan "up". Used to orient the strip symbol and its label so text runs
// along the strip.
export function pathAngleAt(path: Point[], distanceAlong: number): number {
  // Fewer than 2 points means no direction exists yet — default to "up"
  // rather than throwing; the symbol just won't be rotated until the run
  // has an actual second point.
  if (path.length < 2) return 0;

  const total = pathLength(path);
  const clamped = Math.max(0, Math.min(distanceAlong, total));

  let travelled = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const segment = asSegment(path[i], path[i + 1]);
    const segLen = wallLength(segment);
    const reachesHere = clamped <= travelled + segLen || i === path.length - 2;
    if (reachesHere) {
      if (segLen > 0) {
        return vectorAngleDegrees(segment.end.x - segment.start.x, segment.end.y - segment.start.y);
      }
      // Landed exactly on a zero-length (coincident-point) segment while
      // drawing — atan2(0, -0) has no meaningful "run direction", so borrow
      // direction from the nearest segment that actually has one: prefer
      // looking ahead (the direction the run continues in) then behind.
      for (let j = i + 1; j < path.length - 1; j++) {
        const forward = asSegment(path[j], path[j + 1]);
        if (wallLength(forward) > 0) {
          return vectorAngleDegrees(forward.end.x - forward.start.x, forward.end.y - forward.start.y);
        }
      }
      for (let j = i - 1; j >= 0; j--) {
        const backward = asSegment(path[j], path[j + 1]);
        if (wallLength(backward) > 0) {
          return vectorAngleDegrees(backward.end.x - backward.start.x, backward.end.y - backward.start.y);
        }
      }
      return 0; // every point in the run is coincident — no direction exists at all.
    }
    travelled += segLen;
  }
  return 0;
}
