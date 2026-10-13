import { describe, expect, it } from "vitest";
import {
  lightPoolRadius,
  downlightLampPositions,
  offsetSymbolIntoRoom,
  quadraticBezierPoint,
  quadraticBezierLength,
  wallLength,
  pointAtOffset,
  closestPointOnWall,
  projectPointOntoWall,
  hasCurve,
  simplifyPolyline,
  snapPolylineToRightAngles,
  freehandTraceToCorners,
} from "./setoutGeometry";
import type { FittingSpecs, SetoutFitting, WallSegment } from "./setoutTypes";

// Basic trig sanity: radius = height * tan(halfBeamAngle). A 90° beam at 1m
// height is the easy exact case — tan(45°) = 1, so radius should be 1m.
describe("lightPoolRadius", () => {
  it("uses height * tan(halfBeamAngle)", () => {
    expect(lightPoolRadius({ beamAngle: 90, mountingHeight: 1 })).toBeCloseTo(1, 6);
  });

  it("falls back to the standard 2.4m/36° defaults when specs carry neither", () => {
    const expected = 2.4 * Math.tan((36 / 2) * (Math.PI / 180));
    expect(lightPoolRadius({})).toBeCloseTo(expected, 6);
  });
});

// downlightLampPositions is what the twin coverage circles (and the twin
// glyph render in SetoutCanvas) are placed from — a sign or axis error here
// would put a lamp's coverage circle in the wrong spot without ever crashing.
describe("downlightLampPositions", () => {
  type Point = { x: number; y: number };
  const at = (position: Point, specs: FittingSpecs) => ({ position, specs }) as Pick<SetoutFitting, "position" | "specs">;

  it("returns the single fitting position when not a twin", () => {
    expect(downlightLampPositions(at({ x: 5, y: 3 }, {}))).toEqual([{ x: 5, y: 3 }]);
  });

  it("splits a twin left/right along the local x-axis at rotation 0", () => {
    const [a, b] = downlightLampPositions(at({ x: 0, y: 0 }, { twin: true, twinSpacingMm: 300 }));
    expect(a.x).toBeCloseTo(0.15, 6);
    expect(a.y).toBeCloseTo(0, 6);
    expect(b.x).toBeCloseTo(-0.15, 6);
    expect(b.y).toBeCloseTo(0, 6);
  });

  it("rotates the split axis with the fitting — 90° puts the two lamps above/below instead of left/right", () => {
    const [a, b] = downlightLampPositions(at({ x: 0, y: 0 }, { twin: true, twinSpacingMm: 300, rotation: 90 }));
    expect(a.x).toBeCloseTo(0, 6);
    expect(a.y).toBeCloseTo(0.15, 6);
    expect(b.x).toBeCloseTo(0, 6);
    expect(b.y).toBeCloseTo(-0.15, 6);
  });

  it("is centred on the fitting position — the two lamps average back to it", () => {
    const [a, b] = downlightLampPositions(at({ x: 2, y: 4 }, { twin: true, twinSpacingMm: 300, rotation: 40 }));
    expect((a.x + b.x) / 2).toBeCloseTo(2, 6);
    expect((a.y + b.y) / 2).toBeCloseTo(4, 6);
  });
});

// A wall-mounted fitting's stored position always sits exactly on the wall
// centreline (see snapToNearestWall), so offsetSymbolIntoRoom is the only
// place that ever decides which side of the wall it visually renders on. It
// must always pick the room side, regardless of which direction the wall
// happens to have been traced in — a bug here previously made it pick a
// fixed side based on wall direction alone, so it looked right on some
// walls and wrong (outside the room) on others depending on trace order.
describe("offsetSymbolIntoRoom", () => {
  // A 4x4 square room, each wall traced in a different direction to prove
  // the result doesn't depend on wall.start/wall.end order.
  const room: WallSegment[] = [
    { id: "top", start: { x: 0, y: 0 }, end: { x: 4, y: 0 } },
    { id: "right", start: { x: 4, y: 4 }, end: { x: 4, y: 0 } },
    { id: "bottom", start: { x: 4, y: 4 }, end: { x: 0, y: 4 } },
    { id: "left", start: { x: 0, y: 0 }, end: { x: 0, y: 4 } },
  ];

  it("offsets a fitting on the top wall down, into the room", () => {
    const result = offsetSymbolIntoRoom({ x: 2, y: 0 }, room);
    expect(result.y).toBeGreaterThan(0);
    expect(result.x).toBeCloseTo(2, 6);
  });

  it("offsets a fitting on the bottom wall up, into the room — same room, opposite side", () => {
    const result = offsetSymbolIntoRoom({ x: 2, y: 4 }, room);
    expect(result.y).toBeLessThan(4);
  });

  it("offsets a fitting on the left wall right, into the room", () => {
    const result = offsetSymbolIntoRoom({ x: 0, y: 2 }, room);
    expect(result.x).toBeGreaterThan(0);
  });

  it("offsets a fitting on the right wall left, into the room", () => {
    const result = offsetSymbolIntoRoom({ x: 4, y: 2 }, room);
    expect(result.x).toBeLessThan(4);
  });
});

// A curved wall's start/control/end here (0,0) -> (1,1) -> (2,0) happens to
// reduce to the plain parabola y = x - x^2/2 (x(t) = 2t is exactly linear
// for this particular control point), so its arc length has a closed form —
// 2 * integral_0^1 sqrt(1+u^2) du = 2 * [ (u/2)sqrt(1+u^2) + (1/2)asinh(u) ]
// from 0 to 1 ~= 2.2955871506. Worked out independently of the
// implementation, so this checks the sampled approximation against real
// calculus, not just "does the code agree with itself".
describe("quadraticBezierPoint / quadraticBezierLength", () => {
  const p0 = { x: 0, y: 0 };
  const c = { x: 1, y: 1 };
  const p1 = { x: 2, y: 0 };

  it("evaluates the midpoint (t=0.5) exactly", () => {
    expect(quadraticBezierPoint(p0, c, p1, 0.5)).toEqual({ x: 1, y: 0.5 });
  });

  it("matches the endpoints at t=0 and t=1", () => {
    expect(quadraticBezierPoint(p0, c, p1, 0)).toEqual(p0);
    expect(quadraticBezierPoint(p0, c, p1, 1)).toEqual(p1);
  });

  it("approximates the true arc length (worked out by hand via calculus)", () => {
    // Default 24-sample polyline approximation slightly underestimates a
    // real curve (chords are always <= the arc), by ~4e-4 here — 3 decimal
    // places' tolerance comfortably allows for that sampling error while
    // still catching a genuinely wrong formula.
    expect(quadraticBezierLength(p0, c, p1)).toBeCloseTo(2.2955871506, 3);
  });

  it("is longer than the straight-line chord between its endpoints", () => {
    expect(quadraticBezierLength(p0, c, p1)).toBeGreaterThan(2);
  });
});

describe("wallLength / pointAtOffset / closestPointOnWall on a curved wall", () => {
  const curvedWall: WallSegment = { id: "w1", start: { x: 0, y: 0 }, end: { x: 2, y: 0 }, curveControl: { x: 1, y: 1 } };

  it("wallLength uses the curve's arc length, not the straight chord", () => {
    expect(wallLength(curvedWall)).toBeCloseTo(2.2955871506, 3);
  });

  it("a wall with no curveControl still measures as a straight chord", () => {
    expect(wallLength({ id: "w2", start: { x: 0, y: 0 }, end: { x: 3, y: 4 } })).toBe(5);
  });

  it("pointAtOffset at half the arc length lands at the curve's own midpoint (by this example's left/right symmetry)", () => {
    const half = wallLength(curvedWall) / 2;
    const p = pointAtOffset(curvedWall, half);
    expect(p.x).toBeCloseTo(1, 2);
    expect(p.y).toBeCloseTo(0.5, 2);
  });

  it("pointAtOffset clamps to the endpoints outside [0, length]", () => {
    expect(pointAtOffset(curvedWall, -5)).toEqual(curvedWall.start);
    expect(pointAtOffset(curvedWall, 999)).toEqual(curvedWall.end);
  });

  it("closestPointOnWall finds a point actually on the bulge, not clamped to an endpoint, for a point above the curve's peak", () => {
    const result = closestPointOnWall({ x: 1, y: 1.2 }, curvedWall);
    expect(result.x).toBeGreaterThan(0.3);
    expect(result.x).toBeLessThan(1.7);
    expect(result.y).toBeGreaterThan(0.3);
  });
});

// A freehand-drawn curve stores the literal points sampled from the drag
// rather than a Bézier control point — these should behave like a polyline
// through start -> curvePoints -> end, not an approximated smooth arc.
describe("wallLength / pointAtOffset / closestPointOnWall / projectPointOntoWall on a freehand (curvePoints) wall", () => {
  // A right-angle zigzag (0,0) -> (1,0) -> (1,1) -> (2,1), so lengths are
  // exact integers/easy sums rather than needing calculus to verify by hand.
  const zigzagWall: WallSegment = {
    id: "w1",
    start: { x: 0, y: 0 },
    end: { x: 2, y: 1 },
    curvePoints: [{ x: 1, y: 0 }, { x: 1, y: 1 }],
  };

  it("hasCurve is true for a curvePoints wall and false for a plain one", () => {
    expect(hasCurve(zigzagWall)).toBe(true);
    expect(hasCurve({})).toBe(false);
  });

  it("wallLength sums the chords through start -> curvePoints -> end, not the straight-line distance", () => {
    // 1 + 1 + 1 = 3, vs a straight chord of sqrt(5) ~= 2.236
    expect(wallLength(zigzagWall)).toBeCloseTo(3, 6);
  });

  it("pointAtOffset walks along the drawn chain segment by segment", () => {
    expect(pointAtOffset(zigzagWall, 0.5)).toEqual({ x: 0.5, y: 0 });
    expect(pointAtOffset(zigzagWall, 1.5)).toEqual({ x: 1, y: 0.5 });
    expect(pointAtOffset(zigzagWall, 2.5)).toEqual({ x: 1.5, y: 1 });
  });

  it("pointAtOffset clamps to the endpoints outside [0, length]", () => {
    expect(pointAtOffset(zigzagWall, -5)).toEqual(zigzagWall.start);
    expect(pointAtOffset(zigzagWall, 999)).toEqual(zigzagWall.end);
  });

  it("closestPointOnWall finds the nearest point on whichever leg of the drawn chain, not clamped to an endpoint", () => {
    // Directly above the middle of the vertical leg (1,0)->(1,1).
    const result = closestPointOnWall({ x: 1.3, y: 0.5 }, zigzagWall);
    expect(result).toEqual({ x: 1, y: 0.5 });
  });

  it("projectPointOntoWall returns the cumulative arc-length offset to the closest foot", () => {
    // Same point as above: 1m along the first leg, then 0.5m up the second.
    expect(projectPointOntoWall({ x: 1.3, y: 0.5 }, zigzagWall)).toBeCloseTo(1.5, 6);
  });
});

describe("simplifyPolyline", () => {
  it("collapses a jittery straight run down to just its two ends", () => {
    const noisy = [
      { x: 0, y: 0 },
      { x: 1, y: 0.01 },
      { x: 2, y: -0.01 },
      { x: 3, y: 0.02 },
      { x: 4, y: 0 },
    ];
    expect(simplifyPolyline(noisy, 0.05)).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ]);
  });

  it("keeps a genuine corner that strays well past the tolerance", () => {
    const corner = [
      { x: 0, y: 0 },
      { x: 2, y: 0.01 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
    ];
    // (4,0) sits ~4m off the straight line from (0,0) to (4,4) — nowhere
    // near the 0.05m tolerance, so it must survive simplification.
    expect(simplifyPolyline(corner, 0.05)).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
    ]);
  });
});

// snapPolylineToRightAngles is freehandTraceToCorners' angle-snapping step
// in isolation — each edge's length is kept, only its direction is forced
// onto the nearest right angle, same split applyWallLengths makes in the
// other direction (keep direction, replace length).
describe("snapPolylineToRightAngles", () => {
  it("forces each edge's direction to the nearest right angle without changing its length", () => {
    const raw = [
      { x: 0, y: 0 },
      { x: 10, y: 1 }, // ~5.7° off due east — snaps to due east (0°)
      { x: 10.5, y: 11 }, // ~87° off due east — snaps to due north (90°)
    ];
    const len1 = Math.hypot(10, 1);
    const len2 = Math.hypot(0.5, 10);
    const result = snapPolylineToRightAngles(raw);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ x: 0, y: 0 });
    expect(result[1].x).toBeCloseTo(len1, 6);
    expect(result[1].y).toBeCloseTo(0, 6);
    expect(result[2].x).toBeCloseTo(result[1].x, 6);
    expect(result[2].y).toBeCloseTo(result[1].y + len2, 6);
  });

  it("never touches the closing wall back to the first point", () => {
    // Only the 0->1 edge is snapped; polygonToWalls adds the 1->0 wrap-
    // around wall later, unsnapped, same as the existing tap-to-place flow.
    const raw = [{ x: 0, y: 0 }, { x: 3, y: 4 }];
    const result = snapPolylineToRightAngles(raw);
    expect(result).toHaveLength(2);
    expect(Math.hypot(result[1].x, result[1].y)).toBeCloseTo(5, 6);
  });
});

// The full pipeline a freehand drag's sampled points get run through —
// built from a synthetic "hand-drawn" trace of a 4m x 3m rectangle (each
// edge densely sampled with a bit of jitter, the way a real finger-drag
// would come out) to check the noisy trace really does collapse to a
// clean, right-angled room outline.
describe("freehandTraceToCorners", () => {
  const jitter = (i: number) => (i % 2 === 0 ? 0.01 : -0.01);
  const sampleEdge = (from: { x: number; y: number }, to: { x: number; y: number }, steps: number) => {
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      pts.push({
        x: from.x + (to.x - from.x) * t + jitter(i),
        y: from.y + (to.y - from.y) * t + jitter(i + 1),
      });
    }
    return pts;
  };

  it("cleans a noisy, open 3-wall trace down to 4 right-angled corners", () => {
    // Right, then up, then left — deliberately NOT closed back to the
    // start; that's polygonToWalls's job once this hands back corners.
    const rawTrace = [
      ...sampleEdge({ x: 0, y: 0 }, { x: 4, y: 0 }, 10),
      ...sampleEdge({ x: 4, y: 0 }, { x: 4, y: 3 }, 8),
      ...sampleEdge({ x: 4, y: 3 }, { x: 0, y: 3 }, 10),
    ];
    const result = freehandTraceToCorners(rawTrace, 0.05);
    expect(result).not.toBeNull();
    const pts = result!;
    expect(pts).toHaveLength(4);
    for (let i = 0; i < pts.length - 1; i++) {
      const dx = pts[i + 1].x - pts[i].x;
      const dy = pts[i + 1].y - pts[i].y;
      // Every edge should be purely horizontal or purely vertical.
      expect(Math.min(Math.abs(dx), Math.abs(dy))).toBeLessThan(1e-6);
    }
    expect(Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)).toBeCloseTo(4, 1);
    expect(Math.hypot(pts[2].x - pts[1].x, pts[2].y - pts[1].y)).toBeCloseTo(3, 1);
    expect(Math.hypot(pts[3].x - pts[2].x, pts[3].y - pts[2].y)).toBeCloseTo(4, 1);
  });

  it("drops a last point that's really the drag returning near its own start", () => {
    const square = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
      { x: 0.05, y: 0.02 }, // finger lifted just short of a full loop back
    ];
    const result = freehandTraceToCorners(square, 0.01);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(4);
  });

  it("returns null for a scribble with no real corners", () => {
    const scribble = Array.from({ length: 5 }, (_, i) => ({ x: i * 0.02, y: i * 0.02 }));
    expect(freehandTraceToCorners(scribble, 0.05)).toBeNull();
  });
});
