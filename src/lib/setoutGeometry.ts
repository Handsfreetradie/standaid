import { distance, isSingleWallFitting, type Point, type WallSegment, type WallOpening, type FittingSpecs, type MeasurementLock } from "./setoutTypes";
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
export function polygonToWalls(points: Point[]): WallSegment[] {
  if (points.length < 2) return [];
  return points.map((start, i) => ({
    id: `ext-${i}`,
    start,
    end: points[(i + 1) % points.length],
    kind: "exterior" as const,
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

// Rough starting points for the other wall-mounted types — all editable via
// the same height field, not a strict standard for every one of these.
const DEFAULT_HEIGHT_BY_TYPE: Partial<Record<FittingType, number>> = {
  gpo: DEFAULT_GPO_HEIGHT,
  switch: DEFAULT_SWITCH_HEIGHT,
  tv_point: 0.3,
  phone_point: 0.3,
  data: 0.3,
  data_cabinet: 0.3,
  nbn_box: 0.3,
  ubo_rhood: 0.3,
  vacuum_outlet: 0.3,
  wall_stair_light: 0.3,
  meter_box: 1.5,
  switchboard: 1.5,
  thermostat: 1.5,
  wall_batten_holder: 2.0,
  ac_head_unit: 2.1,
  external_light: 2.1,
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

// Scalar distance along the wall (from wall.start) to p's perpendicular
// foot — unclamped, so a caller can tell a point actually past the wall's
// end from one that just landed at 0/length. This is how a door/window
// opening's {offset, width} get derived from two raw AI/tap points, and how
// "does this point fall inside an opening" gets checked in snapToNearestWall.
export function projectPointOntoWall(p: Point, wall: WallSegment): number {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const len = Math.hypot(dx, dy) || 1;
  const t = ((p.x - wall.start.x) * dx + (p.y - wall.start.y) * dy) / (len * len);
  return t * len;
}

export function pointAtOffset(wall: WallSegment, offset: number): Point {
  const len = wallLength(wall) || 1;
  const t = Math.max(0, Math.min(1, offset / len));
  return { x: wall.start.x + (wall.end.x - wall.start.x) * t, y: wall.start.y + (wall.end.y - wall.start.y) * t };
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
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return false;
  const t = ((p.x - wall.start.x) * dx + (p.y - wall.start.y) * dy) / lengthSq;
  return t >= 0 && t <= 1;
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

function nearestMountWall(p: Point, walls: WallSegment[]): WallSegment | null {
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
  const normal = roomFacingNormal(wall, position, wallsCentroid(walls));
  return {
    x: position.x + normal.x * offsetMetres,
    y: position.y + normal.y * offsetMetres,
  };
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
    // If dragged far enough (0.2m+), search all walls to allow changing walls
    searchPool = dragDist > 0.2 ? walls : walls.filter((wall) => hasPerpendicularFoot(p, wall));
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
