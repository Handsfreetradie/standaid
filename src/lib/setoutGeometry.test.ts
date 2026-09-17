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
  duplicatePositionsAlongWall,
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

// Feature: "Repeat along wall" — a 10m wall along the x-axis is the easy
// case to reason about by hand: 1m spacing, direction and capping are all
// plain arithmetic on the x coordinate.
describe("duplicatePositionsAlongWall", () => {
  const wall: WallSegment = { id: "w1", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } };

  it("walks toward the far end (more room ahead than behind) at the requested spacing", () => {
    const fitting = { id: "f1", position: { x: 2, y: 0 } };
    const result = duplicatePositionsAlongWall(fitting, wall, 3, 1000, "spacing");
    expect(result.actualCount).toBe(3);
    expect(result.cappedReason).toBeNull();
    expect(result.positions).toEqual([{ x: 3, y: 0 }, { x: 4, y: 0 }, { x: 5, y: 0 }]);
  });

  it("measures every copy off the source fitting, at its actual distance along the wall", () => {
    const fitting = { id: "f1", position: { x: 2, y: 0 } };
    const result = duplicatePositionsAlongWall(fitting, wall, 3, 1000, "spacing");
    expect(result.measurementLocks).toEqual([
      { refA: { kind: "fitting", fittingId: "f1", distance: 1 } },
      { refA: { kind: "fitting", fittingId: "f1", distance: 2 } },
      { refA: { kind: "fitting", fittingId: "f1", distance: 3 } },
    ]);
  });

  it("walks toward the start instead when that end has more room", () => {
    const fitting = { id: "f1", position: { x: 9, y: 0 } };
    const result = duplicatePositionsAlongWall(fitting, wall, 2, 1000, "spacing");
    expect(result.positions).toEqual([{ x: 8, y: 0 }, { x: 7, y: 0 }]);
  });

  it("caps the count and explains why when the wall runs out of room before the requested spacing does", () => {
    const fitting = { id: "f1", position: { x: 2, y: 0 } }; // 8m of room ahead
    const result = duplicatePositionsAlongWall(fitting, wall, 5, 3000, "spacing"); // 3m spacing -> only 2 fit
    expect(result.actualCount).toBe(2);
    expect(result.positions).toEqual([{ x: 5, y: 0 }, { x: 8, y: 0 }]);
    expect(result.cappedReason).toContain("2");
  });

  it("returns nothing (with a reason) when there's no room left at all — a degenerate zero-length wall", () => {
    const zeroLengthWall: WallSegment = { id: "w0", start: { x: 5, y: 5 }, end: { x: 5, y: 5 } };
    const fitting = { id: "f1", position: { x: 5, y: 5 } };
    const result = duplicatePositionsAlongWall(fitting, zeroLengthWall, 3, 1000, "spacing");
    expect(result.actualCount).toBe(0);
    expect(result.cappedReason).toContain("not enough wall");
  });

  it("picks up the far end even from right at the near end — the OTHER end still has all the room", () => {
    const fitting = { id: "f1", position: { x: 10, y: 0 } }; // sitting exactly at wall.end
    const result = duplicatePositionsAlongWall(fitting, wall, 2, 1000, "spacing");
    expect(result.actualCount).toBe(2);
    expect(result.positions).toEqual([{ x: 9, y: 0 }, { x: 8, y: 0 }]);
  });

  it("'toEnd' mode ignores the spacing figure and spaces copies evenly, landing the last one exactly on the wall's end", () => {
    const fitting = { id: "f1", position: { x: 2, y: 0 } }; // 8m of room ahead
    const result = duplicatePositionsAlongWall(fitting, wall, 4, 999999, "toEnd");
    expect(result.actualCount).toBe(4);
    expect(result.positions).toEqual([{ x: 4, y: 0 }, { x: 6, y: 0 }, { x: 8, y: 0 }, { x: 10, y: 0 }]);
  });

  it("works along a vertical wall too — direction isn't hardcoded to the x-axis", () => {
    const verticalWall: WallSegment = { id: "w2", start: { x: 5, y: 0 }, end: { x: 5, y: 6 } };
    const fitting = { id: "f2", position: { x: 5, y: 1 } };
    const result = duplicatePositionsAlongWall(fitting, verticalWall, 2, 1000, "spacing");
    expect(result.positions[0].x).toBeCloseTo(5, 6);
    expect(result.positions[0].y).toBeCloseTo(2, 6);
    expect(result.positions[1].y).toBeCloseTo(3, 6);
  });

  it("returns nothing for a non-positive count or spacing", () => {
    const fitting = { id: "f1", position: { x: 2, y: 0 } };
    expect(duplicatePositionsAlongWall(fitting, wall, 0, 1000, "spacing").actualCount).toBe(0);
    expect(duplicatePositionsAlongWall(fitting, wall, 3, 0, "spacing").actualCount).toBe(0);
  });
});
