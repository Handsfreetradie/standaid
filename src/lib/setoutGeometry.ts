import { distance, isSingleWallFitting, DEFAULT_TWIN_SPACING_MM, type Point, type PathPoint, type WallSegment, type WallOpening, type FittingSpecs, type MeasurementLock, type MeasurementRef, type SetoutPhotoPoint, type SetoutPhotoGallery, type WallThickness, type SetoutFitting } from "./setoutTypes";
import type { FittingType } from "@/components/setout/symbols";

let wallIdCounter = 0;
// For one-at-a-time additions (a manually-added interior wall, an opening)
// where each call should mint a genuinely new, permanent id — unlike
// polygonToWalls's deterministic per-call ids, which are for a whole
// perimeter being re-derived from the same in-progress corner list.
export function nextWallId(): string {
  wallIdCounter += 1;
  return `wall-${Date.now()}-${wallIdCounter}`;
}

export function nextOpeningId(): string {
  wallIdCounter += 1;
  return `opening-${Date.now()}-${wallIdCounter}`;
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
// Ids are deterministic by corner index ("ext-0", "ext-1", ...) rather than
// from the global counter — a caller that re-derives a live preview from
// the same in-progress corner list (e.g. while placing doors/windows before
// the shape is finalised) gets the same ids back each time, so anything
// already referencing a wallId (a WallOpening, a measurement lock) doesn't
// silently orphan itself the next time this runs. Only breaks if the corner
// count/order itself changes between placing something and saving.
export function polygonToWalls(points: PathPoint[]): WallSegment[] {
  if (points.length < 2) return [];
  return points.map((start, i) => {
    const end = points[(i + 1) % points.length];
    return {
      id: `ext-${i}`,
      start,
      end,
      kind: "exterior" as const,
      curvePoints: end.curvePoints,
      curveControl: end.curveControl,
    };
  });
}

// True if this segment is curved by either mechanism — the current freehand
// curvePoints or the legacy single-Bézier-point curveControl (kept only for
// data drawn before freehand curves existed). Every branch elsewhere that
// used to test `wall.curveControl` directly should test this instead, so old
// and new curved data are both handled.
export function hasCurve(wall: Pick<WallSegment, "curveControl" | "curvePoints">): boolean {
  return !!wall.curveControl || !!(wall.curvePoints && wall.curvePoints.length > 0);
}

// Quadratic Bézier point at t in [0,1] (start -> control -> end).
export function quadraticBezierPoint(p0: Point, c: Point, p1: Point, t: number): Point {
  const mt = 1 - t;
  return {
    x: mt * mt * p0.x + 2 * mt * t * c.x + t * t * p1.x,
    y: mt * mt * p0.y + 2 * mt * t * c.y + t * t * p1.y,
  };
}

// Arc length of a quadratic Bézier has no closed form — approximated by
// sampling a dense polyline instead. 24 samples is plenty accurate at
// residential curve scales (a few metres), and this is only ever computed
// on demand, never stored.
export function quadraticBezierLength(p0: Point, c: Point, p1: Point, samples = 24): number {
  let total = 0;
  let prev = p0;
  for (let i = 1; i <= samples; i++) {
    const next = quadraticBezierPoint(p0, c, p1, i / samples);
    total += distance(prev, next);
    prev = next;
  }
  return total;
}

// Samples a curved wall into straight sub-segments so every straight-line
// helper below (nearest-point, offset-along, perpendicular-foot) can run
// against it unchanged, rather than solving exact nearest-point-on-bezier
// (a cubic) or nearest-point-on-polyline directly. Not stored — computed
// fresh whenever needed. A straight wall is returned as itself, so this is a
// safe no-op call site for every wall.
export function curveSubSegments(wall: WallSegment, samples = 16): WallSegment[] {
  if (wall.curvePoints && wall.curvePoints.length > 0) {
    // Freehand curve: these points ARE the drawn shape already, dense
    // enough from capture — no re-sampling needed, just chain them.
    const chain = [wall.start, ...wall.curvePoints, wall.end];
    const segments: WallSegment[] = [];
    for (let i = 0; i < chain.length - 1; i++) {
      segments.push({ id: `${wall.id}-sub-${i}`, start: chain[i], end: chain[i + 1], kind: wall.kind });
    }
    return segments;
  }
  if (!wall.curveControl) return [wall];
  const segments: WallSegment[] = [];
  let prev = wall.start;
  for (let i = 1; i <= samples; i++) {
    const next = i === samples ? wall.end : quadraticBezierPoint(wall.start, wall.curveControl, wall.end, i / samples);
    segments.push({ id: `${wall.id}-sub-${i}`, start: prev, end: next, kind: wall.kind });
    prev = next;
  }
  return segments;
}

export function wallLength(wall: WallSegment): number {
  if (wall.curvePoints && wall.curvePoints.length > 0) {
    const chain = [wall.start, ...wall.curvePoints, wall.end];
    let total = 0;
    for (let i = 0; i < chain.length - 1; i++) total += distance(chain[i], chain[i + 1]);
    return total;
  }
  if (wall.curveControl) return quadraticBezierLength(wall.start, wall.curveControl, wall.end);
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

// Perpendicular distance from a point to the infinite line through a-b —
// the test Ramer–Douglas–Peucker simplification below uses to decide which
// sampled points actually matter. Falls back to plain point distance when
// a and b coincide (a zero-length chord has no direction to measure against).
function perpendicularDistanceToLine(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distance(point, a);
  const t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared;
  const projection = { x: a.x + t * dx, y: a.y + t * dy };
  return distance(point, projection);
}

// Ramer–Douglas–Peucker: reduces a dense, hand-jittery polyline (every
// point sampled along a freehand drag) down to the handful of points that
// actually describe its shape, by recursively keeping only whichever point
// deviates furthest from the straight line between the two ends — and
// only if that deviation exceeds `tolerance` (scene units). A generic
// polyline utility, not sketch-specific, so it's usable wherever a drawn
// path needs cleaning up, not just the freehand room trace below.
export function simplifyPolyline(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points;
  const end = points.length - 1;
  let maxDistance = 0;
  let splitIndex = 0;
  for (let i = 1; i < end; i++) {
    const d = perpendicularDistanceToLine(points[i], points[0], points[end]);
    if (d > maxDistance) {
      maxDistance = d;
      splitIndex = i;
    }
  }
  if (maxDistance <= tolerance) return [points[0], points[end]];
  const left = simplifyPolyline(points.slice(0, splitIndex + 1), tolerance);
  const right = simplifyPolyline(points.slice(splitIndex), tolerance);
  return [...left.slice(0, -1), ...right];
}

// Walks an open chain of corner points edge by edge and snaps each edge's
// direction to the nearest right angle, keeping that edge's original
// length — the mirror image of applyWallLengths above (which keeps
// direction and replaces length; this keeps length and replaces
// direction). Each edge snaps independently to global horizontal/vertical,
// same as snapOrthogonal's per-tap squaring — no "this shape's own
// reference angle" concept. Deliberately doesn't touch the closing edge
// back to points[0] (added later by polygonToWalls's wraparound) — the
// existing tap-to-place flow never squares that final wrap-around wall
// either, so a freehand trace ending up with one unsquared closing wall is
// consistent with how sketching already behaves, not a new gap.
export function snapPolylineToRightAngles(points: Point[]): Point[] {
  if (points.length < 2) return points;
  const result: Point[] = [points[0]];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    const len = distance(start, end);
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const snappedAngle = Math.round(angle / (Math.PI / 2)) * (Math.PI / 2);
    const from = result[result.length - 1];
    result.push({ x: from.x + Math.cos(snappedAngle) * len, y: from.y + Math.sin(snappedAngle) * len });
  }
  return result;
}

// A wall shorter than this is treated as drag noise rather than a real
// corner — a phone screen's worth of hand jitter easily produces a
// millimetre-scale "corner" that was never actually there.
export const MIN_FREEHAND_WALL_LENGTH_M = 0.1;

// Drops points that landed within `minDistance` of the point already kept
// before them — run on the RAW (pre-angle-snap) corner candidates so a
// too-close pair never reaches snapPolylineToRightAngles in the first
// place. Doing the filtering before snapping, rather than after, avoids
// ever having to recompute a snapped position once lengths have already
// been baked in.
function dedupeNearPoints(points: Point[], minDistance: number): Point[] {
  if (points.length === 0) return points;
  const result: Point[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    if (distance(result[result.length - 1], points[i]) >= minDistance) result.push(points[i]);
  }
  return result;
}

// Removes a corner where the edges on either side ended up pointing in
// exactly the same direction once snapped — not a real corner anymore,
// just two now-collinear walls that should be one. The first and last
// points are left alone (same reasoning as the closing-edge note on
// snapPolylineToRightAngles above — that wrap-around wall is never
// checked for straightness either).
function dedupeCollinearCorners(points: Point[]): Point[] {
  if (points.length < 3) return points;
  const result = [...points];
  let i = 1;
  while (i < result.length - 1) {
    const inAngle = Math.atan2(result[i].y - result[i - 1].y, result[i].x - result[i - 1].x);
    const outAngle = Math.atan2(result[i + 1].y - result[i].y, result[i + 1].x - result[i].x);
    if (Math.abs(inAngle - outAngle) < 1e-6) {
      result.splice(i, 1);
    } else {
      i++;
    }
  }
  return result;
}

// The freehand "sketch the room in one stroke" pipeline: takes the raw
// points sampled along a single pencil-style drag and turns them into a
// clean set of corners — simplify away the hand jitter, drop a last point
// that's really just the drag returning to where it started, snap every
// edge to a right angle, then merge away any corner that didn't survive
// snapping as a real corner. Returns null if fewer than 3 corners survive,
// so the caller can ask the tradie to retrace rather than save a
// degenerate shape.
export function freehandTraceToCorners(rawPoints: Point[], simplifyTolerance: number): Point[] | null {
  if (rawPoints.length < 2) return null;
  const simplified = simplifyPolyline(rawPoints, simplifyTolerance);
  const last = simplified.length - 1;
  const closesItself = simplified.length > 3 && distance(simplified[0], simplified[last]) <= CLOSE_SHAPE_THRESHOLD_METRES;
  const openChain = closesItself ? simplified.slice(0, -1) : simplified;
  const deduped = dedupeNearPoints(openChain, MIN_FREEHAND_WALL_LENGTH_M);
  if (deduped.length < 3) return null;
  const snapped = snapPolylineToRightAngles(deduped);
  const cleaned = dedupeCollinearCorners(snapped);
  return cleaned.length >= 3 ? cleaned : null;
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

// Rough starting points for the other wall-mounted types — all editable via
// the same height field, not a strict standard for every one of these.
const DEFAULT_HEIGHT_BY_TYPE: Partial<Record<FittingType, number>> = {
  gpo: DEFAULT_GPO_HEIGHT,
  gpo_switch_combo: DEFAULT_GPO_HEIGHT,
  switch: DEFAULT_SWITCH_HEIGHT,
  cooktop_isolator: DEFAULT_SWITCH_HEIGHT,
  tv_point: 0.3,
  phone_point: 0.3,
  data: 0.3,
  data_cabinet: 0.3,
  nbn_box: 0.3,
  ubo_rhood: 0.3,
  wall_stair_light: 0.3,
  meter_box: 1.5,
  switchboard: 1.5,
  thermostat: 1.5,
  hot_water_unit: 1.5,
  spa_pool_heater: 1.5,
  cooktop: 1.2,
  oven: 0.9,
  wall_batten_holder: 2.0,
  ac_head_unit: 2.1,
  external_light: 2.1,
  heated_towel_rail: 1.0,
  underfloor_heating_stat: 1.5,
  solar_inverter: 1.6,
};

export function defaultHeightForType(type: FittingType): number | null {
  return DEFAULT_HEIGHT_BY_TYPE[type] ?? null;
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

// A twin downlight is two actual lamps, offset either side of the fitting's
// placed position along whatever direction it's rotated to (see the twin
// glyph render in SetoutCanvas, which offsets the same way in icon-local
// space before the same rotation is applied) — so its real floor coverage is
// two overlapping pools, not one pool centred on the fixture. A plain
// downlight is just the one lamp at its own position.
export function downlightLampPositions(fitting: Pick<SetoutFitting, "position" | "specs">): Point[] {
  if (!fitting.specs.twin) return [fitting.position];
  const spacingM = (fitting.specs.twinSpacingMm ?? DEFAULT_TWIN_SPACING_MM) / 1000;
  const rotationRad = (fitting.specs.rotation ?? 0) * (Math.PI / 180);
  const halfOffset = { x: (spacingM / 2) * Math.cos(rotationRad), y: (spacingM / 2) * Math.sin(rotationRad) };
  return [
    { x: fitting.position.x + halfOffset.x, y: fitting.position.y + halfOffset.y },
    { x: fitting.position.x - halfOffset.x, y: fitting.position.y - halfOffset.y },
  ];
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

function closestPointOnStraightSegment(p: Point, wall: Pick<WallSegment, "start" | "end">): Point {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return wall.start;
  let t = ((p.x - wall.start.x) * dx + (p.y - wall.start.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return { x: wall.start.x + t * dx, y: wall.start.y + t * dy };
}

// Closest point to `p` on the finite wall segment (not the infinite line
// through it) — a fitting near a corner should measure off the wall's actual
// end, not a point that would fall past it. Curved walls are sampled into
// straight sub-segments first (see curveSubSegments) and the best result
// kept.
export function closestPointOnWall(p: Point, wall: WallSegment): Point {
  if (!hasCurve(wall)) return closestPointOnStraightSegment(p, wall);
  let best = wall.start;
  let bestDist = Infinity;
  for (const seg of curveSubSegments(wall)) {
    const candidate = closestPointOnStraightSegment(p, seg);
    const d = distance(p, candidate);
    if (d < bestDist) {
      bestDist = d;
      best = candidate;
    }
  }
  return best;
}

export function perpendicularDistanceToWall(p: Point, wall: WallSegment): number {
  return distance(p, closestPointOnWall(p, wall));
}

// Scalar distance along the wall (from wall.start) to p's perpendicular
// foot — unclamped, so a caller can tell a point actually past the wall's
// end from one that just landed at 0/length. This is how a door/window
// opening's {offset, width} get derived from two raw AI/tap points, and how
// "does this point fall inside an opening" gets checked in snapToNearestWall.
function projectPointOntoStraightSegment(p: Point, wall: Pick<WallSegment, "start" | "end">): number {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const len = Math.hypot(dx, dy) || 1;
  const t = ((p.x - wall.start.x) * dx + (p.y - wall.start.y) * dy) / (len * len);
  return t * len;
}

// Scalar distance along the wall (from wall.start) to p's perpendicular
// foot. For a curved wall this is an arc-length offset: the sub-segment
// with the closest foot is found first, then every earlier sub-segment's
// own length is added on so the result is still "metres from wall.start",
// same convention pointAtOffset expects back.
export function projectPointOntoWall(p: Point, wall: WallSegment): number {
  if (!hasCurve(wall)) return projectPointOntoStraightSegment(p, wall);
  let bestOffset = 0;
  let bestDist = Infinity;
  let cumulative = 0;
  for (const seg of curveSubSegments(wall)) {
    const segLen = distance(seg.start, seg.end);
    const localT = segLen === 0 ? 0 : Math.max(0, Math.min(segLen, projectPointOntoStraightSegment(p, seg))) / segLen;
    const candidate = { x: seg.start.x + (seg.end.x - seg.start.x) * localT, y: seg.start.y + (seg.end.y - seg.start.y) * localT };
    const d = distance(p, candidate);
    if (d < bestDist) {
      bestDist = d;
      bestOffset = cumulative + localT * segLen;
    }
    cumulative += segLen;
  }
  return bestOffset;
}

export function pointAtOffset(wall: WallSegment, offset: number): Point {
  const len = wallLength(wall) || 1;
  const clamped = Math.max(0, Math.min(len, offset));
  if (!hasCurve(wall)) {
    const t = clamped / len;
    return { x: wall.start.x + (wall.end.x - wall.start.x) * t, y: wall.start.y + (wall.end.y - wall.start.y) * t };
  }
  let remaining = clamped;
  for (const seg of curveSubSegments(wall)) {
    const segLen = distance(seg.start, seg.end);
    if (remaining <= segLen || segLen === 0) {
      const t = segLen === 0 ? 0 : remaining / segLen;
      return { x: seg.start.x + (seg.end.x - seg.start.x) * t, y: seg.start.y + (seg.end.y - seg.start.y) * t };
    }
    remaining -= segLen;
  }
  return wall.end;
}

// Clearance kept from a door/window opening's edge when a fitting snaps
// onto the wall it's cut into — a GPO or switch mounted mid-doorway isn't
// usable, so it gets nudged just clear of the opening instead.
const OPENING_CLEARANCE_METRES = 0.1;

// True only when `p` has a genuine 90° foot on this wall's segment (not
// past either end) — i.e. a laser held square to the wall would actually
// land on it. `closestPointOnWall` clamps to the nearest endpoint once the
// foot falls outside the segment, which is correct for "closest point" but
// wrong for a measurement lock: that clamped distance is a diagonal to a
// corner, not a 90° reading, and must not be offered as one.
function hasPerpendicularFoot(p: Point, wall: WallSegment): boolean {
  const segments = hasCurve(wall) ? curveSubSegments(wall) : [wall];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const dx = seg.end.x - seg.start.x;
    const dy = seg.end.y - seg.start.y;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq === 0) continue;
    const t = ((p.x - seg.start.x) * dx + (p.y - seg.start.y) * dy) / lengthSq;
    if (t < 0 || t > 1) continue;
    // Only the wall's own two outer ends (first sub-segment's start, last
    // sub-segment's end) count as "off the end" — a foot landing mid-curve,
    // even right at a sub-segment boundary, is still a genuine foot.
    if (t <= 0 && i === 0) continue;
    if (t >= 1 && i === segments.length - 1) continue;
    return true;
  }
  return false;
}

// Rough "middle of the room" reference point (average of all wall
// endpoints) — used only to guess which side of a wall is "inside" versus
// "into the cavity", not for anything measurement-critical.
export function wallsCentroid(walls: WallSegment[]): Point | null {
  const points = walls.flatMap((w) => [w.start, w.end]);
  if (points.length === 0) return null;
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

export function nearestMountWall(p: Point, walls: WallSegment[]): WallSegment | null {
  if (walls.length === 0) return null;
  const candidates = walls.filter((wall) => hasPerpendicularFoot(p, wall));
  const pool = candidates.length > 0 ? candidates : walls;
  let nearest = pool[0];
  let nearestDistance = perpendicularDistanceToWall(p, nearest);
  for (const wall of pool.slice(1)) {
    const d = perpendicularDistanceToWall(p, wall);
    if (d < nearestDistance) {
      nearestDistance = d;
      nearest = wall;
    }
  }
  return nearest;
}

// Finds the wall a tapped point should be attached to (same "prefer a
// genuine perpendicular foot" rule as snapToNearestWall/autoRotationForWallMount)
// plus the scalar offset along it — used by manual door/window placement to
// resolve a tap into a {wallId, offset} pair.
export function nearestWallAndOffset(p: Point, walls: WallSegment[]): { wall: WallSegment; offset: number } | null {
  const wall = nearestMountWall(p, walls);
  if (!wall) return null;
  return { wall, offset: projectPointOntoWall(p, wall) };
}

// Rotation (degrees clockwise) that orients a wall-mounted symbol so its
// body faces into the room rather than into the wall cavity. Wall-mount
// symbols (GpoSymbol, SwitchSymbol, ...) are drawn with their baseline at
// the bottom — "up" in the icon's own frame is "into the room" at
// rotation 0 — so this finds which of the wall's two perpendicular
// directions points toward the room's rough centre, then works out the
// angle needed to turn the icon's local "up" to face that way.
// Which of a wall's two perpendicular directions points toward the room's
// rough centre from a given point on that wall — shared by the wall-mount
// auto-rotation below and by door-swing rendering (a door leaf should swing
// into the room, same "which side is inside" question).
export function roomFacingNormal(wall: WallSegment, position: Point, centroid: Point | null): Point {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const len = Math.hypot(dx, dy) || 1;
  const n1 = { x: -dy / len, y: dx / len };
  const n2 = { x: dy / len, y: -dx / len };
  if (!centroid) return n1;
  const toCentroid = { x: centroid.x - position.x, y: centroid.y - position.y };
  const d1 = toCentroid.x * n1.x + toCentroid.y * n1.y;
  const d2 = toCentroid.x * n2.x + toCentroid.y * n2.y;
  return d2 > d1 ? n2 : n1;
}

function rotationFacingRoom(wall: WallSegment, position: Point, centroid: Point | null): number {
  const normal = roomFacingNormal(wall, position, centroid);
  const radians = Math.atan2(normal.x, -normal.y);
  return Math.round(((radians * 180) / Math.PI + 360) % 360);
}

// One-stop helper for placement/drag: auto-orients a wall-mounted fitting
// to face into the room based on whichever wall it's nearest to. Returns 0
// (no rotation) if there's nothing to orient against yet.
export function autoRotationForWallMount(position: Point, walls: WallSegment[]): number {
  const wall = nearestMountWall(position, walls);
  if (!wall) return 0;
  return rotationFacingRoom(wall, position, wallsCentroid(walls));
}

// Offset a wall-mounted symbol position into the room (not on the wall centerline).
// Wall-mounted symbols snap onto the wall line itself, but visually we want them
// sitting cleanly on the inside edge, not straddling the wall stroke.
// Offset scales with wall thickness: roughly the thickness itself for clean positioning.
export function offsetSymbolIntoRoom(position: Point, walls: WallSegment[], wallThickness?: { exterior: number; interior: number }): Point {
  const wall = nearestMountWall(position, walls);
  if (!wall) return position;
  const thickness = wall.kind === "interior" ? (wallThickness?.interior ?? 0.05) : (wallThickness?.exterior ?? 0.06);
  const offsetMetres = thickness * 0.6;
  const closest = closestPointOnWall(position, wall);
  // Which side of the wall the room is actually on — the same test the
  // auto-rotation uses (roomFacingNormal), not a "which way is this position
  // already offset" guess. A wall-mounted fitting's stored position always
  // sits exactly on the wall centreline, both on placement and after every
  // drag (see snapToNearestWall) — so that guess had nothing real to compare
  // against, and its tie-break always resolved to the same fixed side of the
  // wall regardless of where the room actually was, on every single
  // wall-mounted fitting in the app.
  const normal = roomFacingNormal(wall, closest, wallsCentroid(walls));
  return { x: closest.x + normal.x * offsetMetres, y: closest.y + normal.y * offsetMetres };
}

// Snaps a point onto the nearest wall — used for GPOs, switches, and other
// wall-mounted fittings, which should sit physically on the wall line
// rather than floating anywhere in the room. Prefers walls with a genuine
// perpendicular foot (see hasPerpendicularFoot) so a fixture doesn't jump
// diagonally onto a corner; falls back to any wall only if none qualify
// (e.g. sitting exactly on a corner). Returns the raw point unchanged if
// there are no walls at all.
//
// If the snapped spot falls inside a door/window opening on that wall (plus
// a small clearance either side), it's nudged out to whichever edge of the
// opening is closer — a GPO or switch mounted mid-doorway isn't usable.
//
// Optional dragOrigin: if provided, prioritizes walls in the direction of
// the drag, allowing fittings to move between interior and exterior walls.
export function snapToNearestWall(p: Point, walls: WallSegment[], openings: WallOpening[] = [], dragOrigin?: Point): Point {
  if (walls.length === 0) return p;

  // When dragging, use all walls to find nearest (allows interior→exterior transitions)
  // Otherwise use smart pool (walls with perpendicular feet only)
  let searchPool: WallSegment[];
  if (dragOrigin) {
    const dragDist = Math.hypot(p.x - dragOrigin.x, p.y - dragOrigin.y);
    // If dragged at all (0.05m+), search all walls to allow changing walls immediately
    searchPool = dragDist > 0.05 ? walls : walls.filter((wall) => hasPerpendicularFoot(p, wall));
  } else {
    const candidates = walls.filter((wall) => hasPerpendicularFoot(p, wall));
    searchPool = candidates.length > 0 ? candidates : walls;
  }

  let nearestWall = searchPool[0];
  let nearestDistance = perpendicularDistanceToWall(p, nearestWall);
  for (const wall of searchPool.slice(1)) {
    const d = perpendicularDistanceToWall(p, wall);
    if (d < nearestDistance) {
      nearestDistance = d;
      nearestWall = wall;
    }
  }
  const snapped = closestPointOnWall(p, nearestWall);
  const wallOpenings = openings.filter((o) => o.wallId === nearestWall.id);
  if (wallOpenings.length === 0) return snapped;
  const offset = projectPointOntoWall(snapped, nearestWall);
  const len = wallLength(nearestWall);
  for (const o of wallOpenings) {
    const lo = o.offset - OPENING_CLEARANCE_METRES;
    const hi = o.offset + o.width + OPENING_CLEARANCE_METRES;
    if (offset > lo && offset < hi) {
      const nudgedOffset = offset - lo <= hi - offset ? Math.max(0, lo) : Math.min(len, hi);
      return pointAtOffset(nearestWall, nudgedOffset);
    }
  }
  return snapped;
}

// Smart-guide style row/column snapping for downlights: if a downlight
// being placed or dragged is already close to sharing an x or y with
// another downlight in the room, snap it exactly onto that line instead
// of leaving it a few centimetres off — the same behaviour as alignment
// guides in a design tool. Independent per axis, so a light can pick up a
// column from one neighbour and a row from a different one.
export const ALIGNMENT_SNAP_THRESHOLD_METRES = 0.15;

export function alignToExistingPoints(
  point: Point,
  others: Point[],
  threshold = ALIGNMENT_SNAP_THRESHOLD_METRES
): { position: Point; guideX?: number; guideY?: number } {
  let bestX: number | undefined;
  let bestXDist = threshold;
  let bestY: number | undefined;
  let bestYDist = threshold;
  for (const other of others) {
    const dx = Math.abs(other.x - point.x);
    if (dx < bestXDist) {
      bestXDist = dx;
      bestX = other.x;
    }
    const dy = Math.abs(other.y - point.y);
    if (dy < bestYDist) {
      bestYDist = dy;
      bestY = other.y;
    }
  }
  // Aligning on both axes at once can land the new fitting exactly on top of
  // an existing one, which looks like the placement simply not working. It
  // happens whenever the threshold is large relative to the spacing on the
  // plan — including when a mis-typed scale makes the whole drawing smaller
  // than the threshold itself. Keep the nearer axis and let the other be,
  // rather than silently stacking.
  if (bestX !== undefined && bestY !== undefined) {
    const landsOnExisting = others.some(
      (o) => Math.abs(o.x - bestX!) < 1e-9 && Math.abs(o.y - bestY!) < 1e-9
    );
    if (landsOnExisting) {
      if (bestXDist <= bestYDist) return { position: { x: bestX, y: point.y }, guideX: bestX };
      return { position: { x: point.x, y: bestY }, guideY: bestY };
    }
  }
  return { position: { x: bestX ?? point.x, y: bestY ?? point.y }, guideX: bestX, guideY: bestY };
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
  // Only walls with a genuine 90° foot qualify — a wall that's numerically
  // closer but only reachable via a clamped corner would give a diagonal
  // "measurement", which isn't a real laser reading.
  const perpendicularWalls = walls.filter((wall) => hasPerpendicularFoot(position, wall));
  if (perpendicularWalls.length === 0) return null;
  const ranked = perpendicularWalls
    .map((wall) => ({ kind: "wall" as const, wallId: wall.id, distance: perpendicularDistanceToWall(position, wall) }))
    .sort((a, b) => a.distance - b.distance);
  if (fittingType && isSingleWallFitting(fittingType)) {
    // These fittings are snapped onto their mounted wall on placement/drag
    // (see snapToNearestWall), so ranked[0] is that same wall at ~0m — not
    // useful as "the" measurement. The one real reading is the along-wall
    // distance to the nearest adjacent wall, i.e. the next-nearest one.
    return ranked.length > 1 ? { refA: ranked[1] } : { refA: ranked[0] };
  }
  if (ranked.length < 2) return { refA: ranked[0] };
  return { refA: ranked[0], refB: ranked[1] };
}

// Group photo points by position to create photo galleries at each location
export function groupPhotosByPosition(photos: SetoutPhotoPoint[]): SetoutPhotoGallery[] {
  const tolerance = 0.01; // Group photos within 1cm of each other
  const galleries: SetoutPhotoGallery[] = [];

  for (const photo of photos) {
    const existing = galleries.find(
      (g) => Math.abs(g.position.x - photo.position.x) < tolerance && Math.abs(g.position.y - photo.position.y) < tolerance
    );
    if (existing) {
      existing.photos.push(photo);
    } else {
      galleries.push({ position: photo.position, photos: [photo] });
    }
  }

  // Sort photos within each gallery by creation date
  galleries.forEach((g) => g.photos.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()));
  return galleries;
}

/**
 * Re-takes a measurement against the SAME references after a fitting moves.
 *
 * Auto-derivation picks the nearest walls, which is a reasonable starting
 * guess. But once the tradie has said what a measurement is taken to, nudging
 * the fitting must not quietly re-point it at whatever is nearest now — the
 * number on the drawing would change meaning without anything saying so. So a
 * user-set lock keeps its references and only updates how far away they are.
 */
export function remeasureLock(
  lock: MeasurementLock,
  position: Point,
  ctx: { walls: WallSegment[]; openings: WallOpening[]; fittings: SetoutFitting[]; wallThickness: WallThickness }
): MeasurementLock {
  const wallById = new Map(ctx.walls.map((w) => [w.id, w]));
  const openingById = new Map(ctx.openings.map((o) => [o.id, o]));
  const fittingById = new Map(ctx.fittings.map((f) => [f.id, f]));
  const centroid = ctx.walls.length > 0 ? wallsCentroid(ctx.walls) : { x: 0, y: 0 };

  const again = (ref: MeasurementRef): MeasurementRef => {
    switch (ref.kind) {
      case "wall": {
        const wall = wallById.get(ref.wallId);
        return wall ? { ...ref, distance: perpendicularDistanceToWall(position, wall) } : ref;
      }
      case "fitting": {
        const other = fittingById.get(ref.fittingId);
        return other ? { ...ref, distance: distance(position, other.position) } : ref;
      }
      case "opening": {
        const opening = openingById.get(ref.openingId);
        const wall = opening ? wallById.get(opening.wallId) : undefined;
        if (!opening || !wall) return ref;
        const len = wallLength(wall);
        const offset = ref.edge === "start" ? Math.max(0, opening.offset) : Math.min(len, opening.offset + opening.width);
        const edgePoint = pointAtOffset(wall, offset);
        const thickness = wall.kind === "interior" ? ctx.wallThickness.interior : ctx.wallThickness.exterior;
        const normal = roomFacingNormal(wall, edgePoint, centroid);
        const at = { x: edgePoint.x + normal.x * (thickness / 2), y: edgePoint.y + normal.y * (thickness / 2) };
        return { ...ref, distance: distance(position, at) };
      }
      case "stroke": {
        // Square to the same line: drop a perpendicular from the new position
        // onto the line through the stored point, in its stored direction.
        const along = (position.x - ref.point.x) * ref.dirX + (position.y - ref.point.y) * ref.dirY;
        const foot = { x: ref.point.x + ref.dirX * along, y: ref.point.y + ref.dirY * along };
        return { ...ref, point: foot, distance: Math.hypot(position.x - foot.x, position.y - foot.y) };
      }
    }
  };

  return { ...lock, refA: again(lock.refA), refB: lock.refB ? again(lock.refB) : undefined };
}

/** A midpoint offered as a placement target, and the two fittings it sits between. */
export interface MidpointSnap {
  position: Point;
  a: Point;
  b: Point;
}

/**
 * Finds the halfway point between two existing fittings, when the tradie is
 * aiming near one.
 *
 * Covers both of the cases that actually come up: dead centre between a pair
 * of downlights, and dead centre of four in a rectangle — the midpoint of
 * either diagonal of a rectangle IS its centre, so the same rule gives you a
 * fan in the middle of a four-light room without needing to know the four
 * lights form a group.
 *
 * Pairs are formed only from fittings near the point, so this stays cheap on a
 * plan carrying a few hundred of them.
 */
export function findMidpointSnap(
  point: Point,
  others: Point[],
  tolerance: number,
  searchRadius = 8
): MidpointSnap | null {
  const near = others.filter((o) => distance(o, point) <= searchRadius);
  let best: MidpointSnap | null = null;
  let bestDist = tolerance;

  for (let i = 0; i < near.length; i++) {
    for (let j = i + 1; j < near.length; j++) {
      const mid = { x: (near[i].x + near[j].x) / 2, y: (near[i].y + near[j].y) / 2 };
      const d = distance(mid, point);
      if (d < bestDist) {
        bestDist = d;
        best = { position: mid, a: near[i], b: near[j] };
      }
    }
  }
  return best;
}
