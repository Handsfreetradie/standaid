import { describe, expect, it } from "vitest";
import {
  pathLength,
  pointAtDistanceAlongPath,
  pathMidpoint,
  distanceToPath,
  closestPointOnPath,
  pathBounds,
  pathAngleAt,
} from "./setoutPathGeometry";
import type { PathPoint, Point } from "./setoutTypes";

// A 3-4-5 right triangle run: 3m along +x, then 4m along +y. Hypotenuse would
// be 5m but the RUN follows the two legs, so total length is 3 + 4 = 7m —
// kept here as a basic sanity check, with a dedicated 9m case below matching
// the task's own worked example (two legs of length that sum to 9).
const triangle: Point[] = [
  { x: 0, y: 0 },
  { x: 3, y: 0 },
  { x: 3, y: 4 },
];

// Two legs of 4m and 5m -> total run length exactly 9m.
const nineMetreRun: Point[] = [
  { x: 0, y: 0 },
  { x: 4, y: 0 },
  { x: 4, y: 5 },
];

// L-shaped 2m + 2m run: corner sits exactly at the halfway point by distance.
const lShape: Point[] = [
  { x: 0, y: 0 },
  { x: 2, y: 0 },
  { x: 2, y: 2 },
];

describe("pathLength", () => {
  it("sums every segment", () => {
    expect(pathLength(triangle)).toBeCloseTo(7, 9);
    expect(pathLength(nineMetreRun)).toBeCloseTo(9, 9);
    expect(pathLength(lShape)).toBeCloseTo(4, 9);
  });

  it("is 0 for empty and single-point paths", () => {
    expect(pathLength([])).toBe(0);
    expect(pathLength([{ x: 1, y: 1 }])).toBe(0);
  });

  it("ignores coincident consecutive points (zero-length segments)", () => {
    const withDup: Point[] = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 5, y: 0 }];
    expect(pathLength(withDup)).toBeCloseTo(5, 9);
  });

  // Same worked-by-hand curve as setoutGeometry.test.ts's quadraticBezierLength
  // case ((0,0) -> control (1,1) -> (2,0), arc length ~2.2955871506) — a run
  // with one curved segment (LED strip path shape) followed by one straight
  // segment of 3m should total curve-length + 3, not chord-length (2) + 3.
  it("is curve-aware for a run with a curveControl on one point", () => {
    const runWithCurve: PathPoint[] = [
      { x: 0, y: 0 },
      { x: 2, y: 0, curveControl: { x: 1, y: 1 } },
      { x: 5, y: 0 },
    ];
    expect(pathLength(runWithCurve)).toBeCloseTo(2.2955871506 + 3, 3);
  });
});

describe("pointAtDistanceAlongPath", () => {
  it("walks along a straight segment", () => {
    const p = pointAtDistanceAlongPath(nineMetreRun, 2);
    expect(p.x).toBeCloseTo(2, 9);
    expect(p.y).toBeCloseTo(0, 9);
  });

  it("crosses into the second segment correctly", () => {
    // 4m along the first leg, then 3m into the second (y-leg) = 7m total.
    const p = pointAtDistanceAlongPath(nineMetreRun, 7);
    expect(p.x).toBeCloseTo(4, 9);
    expect(p.y).toBeCloseTo(3, 9);
  });

  it("clamps rather than extrapolating past either end", () => {
    const start = pointAtDistanceAlongPath(nineMetreRun, -5);
    expect(start).toEqual({ x: 0, y: 0 });
    const end = pointAtDistanceAlongPath(nineMetreRun, 999);
    expect(end.x).toBeCloseTo(4, 9);
    expect(end.y).toBeCloseTo(5, 9);
  });

  it("returns the single point for a zero-length run regardless of distance", () => {
    const single: Point[] = [{ x: 2, y: 3 }];
    expect(pointAtDistanceAlongPath(single, 0)).toEqual({ x: 2, y: 3 });
    expect(pointAtDistanceAlongPath(single, 50)).toEqual({ x: 2, y: 3 });
  });

  it("does not throw for an empty path", () => {
    expect(pointAtDistanceAlongPath([], 3)).toEqual({ x: 0, y: 0 });
  });
});

describe("pathMidpoint", () => {
  it("sits exactly on the corner of an equal-legged L-shape", () => {
    const mid = pathMidpoint(lShape);
    expect(mid.x).toBeCloseTo(2, 9);
    expect(mid.y).toBeCloseTo(0, 9);
  });

  it("is by distance travelled, not the average of vertices", () => {
    // Legs of 4m and 5m: average-of-vertices would be (8/3, 5/3) — the true
    // midpoint-by-distance (4.5m in) is 0.5m into the second leg instead.
    const mid = pathMidpoint(nineMetreRun);
    expect(mid.x).toBeCloseTo(4, 9);
    expect(mid.y).toBeCloseTo(0.5, 9);
  });
});

describe("distanceToPath / closestPointOnPath", () => {
  it("measures perpendicular distance to the nearest segment", () => {
    // 1m directly above the midpoint of the first leg of lShape.
    const p = { x: 1, y: -1 };
    expect(distanceToPath(p, lShape)).toBeCloseTo(1, 9);
  });

  it("closestPointOnPath reports the point and correct distanceAlong", () => {
    const p = { x: 1, y: -1 };
    const result = closestPointOnPath(p, lShape);
    expect(result.point.x).toBeCloseTo(1, 9);
    expect(result.point.y).toBeCloseTo(0, 9);
    expect(result.distanceAlong).toBeCloseTo(1, 9);
  });

  it("picks the globally nearest segment, not just the first", () => {
    // Near the second leg of the L (x=2, y between 0 and 2).
    const p = { x: 3, y: 1 };
    const result = closestPointOnPath(p, lShape);
    expect(result.point.x).toBeCloseTo(2, 9);
    expect(result.point.y).toBeCloseTo(1, 9);
    // 2m along the first leg + 1m into the second leg.
    expect(result.distanceAlong).toBeCloseTo(3, 9);
  });

  it("handles empty and single-point paths without throwing", () => {
    expect(distanceToPath({ x: 0, y: 0 }, [])).toBe(Infinity);
    expect(closestPointOnPath({ x: 0, y: 0 }, [])).toEqual({ point: { x: 0, y: 0 }, distanceAlong: 0 });
    const single: Point[] = [{ x: 5, y: 5 }];
    expect(distanceToPath({ x: 5, y: 8 }, single)).toBeCloseTo(3, 9);
    expect(closestPointOnPath({ x: 5, y: 8 }, single)).toEqual({ point: { x: 5, y: 5 }, distanceAlong: 0 });
  });
});

describe("pathBounds", () => {
  it("bounds a multi-segment run", () => {
    expect(pathBounds(lShape)).toEqual({ minX: 0, minY: 0, maxX: 2, maxY: 2 });
  });

  it("returns a zero-size box at the origin for an empty path", () => {
    expect(pathBounds([])).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });

  it("returns a zero-size box at the point for a single-point path", () => {
    expect(pathBounds([{ x: 4, y: -2 }])).toEqual({ minX: 4, minY: -2, maxX: 4, maxY: -2 });
  });
});

describe("pathAngleAt", () => {
  it("matches the app's atan2(dx, -dy) convention: straight up is 0 degrees", () => {
    const up: Point[] = [{ x: 0, y: 0 }, { x: 0, y: -5 }];
    expect(pathAngleAt(up, 2)).toBeCloseTo(0, 9);
  });

  it("straight right (+x) is 90 degrees", () => {
    const right: Point[] = [{ x: 0, y: 0 }, { x: 5, y: 0 }];
    expect(pathAngleAt(right, 2)).toBeCloseTo(90, 9);
  });

  it("straight down (+y) is 180 degrees", () => {
    const down: Point[] = [{ x: 0, y: 0 }, { x: 0, y: 5 }];
    expect(pathAngleAt(down, 2)).toBeCloseTo(180, 9);
  });

  it("straight left (-x) is 270 degrees", () => {
    const left: Point[] = [{ x: 0, y: 0 }, { x: -5, y: 0 }];
    expect(pathAngleAt(left, 2)).toBeCloseTo(270, 9);
  });

  it("picks up the second segment's direction once past the corner", () => {
    // lShape goes +x then +y: past 2m in, direction should be "down" (180).
    expect(pathAngleAt(lShape, 3)).toBeCloseTo(180, 9);
  });

  it("returns 0 for paths with fewer than 2 points", () => {
    expect(pathAngleAt([], 0)).toBe(0);
    expect(pathAngleAt([{ x: 1, y: 1 }], 0)).toBe(0);
  });

  it("resolves the boundary before an interior coincident-point segment using the real segment before it", () => {
    const withDup: Point[] = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 5 }];
    // Distance 3 is exactly the shared point where the real first leg ends
    // and the zero-length segment starts — the walk resolves ties in favour
    // of whichever segment it reaches first, so this reports the first leg's
    // direction (right, 90), not NaN from atan2(0, -0) on the dup segment.
    expect(pathAngleAt(withDup, 3)).toBeCloseTo(90, 9);
  });

  it("borrows direction forward when the run itself starts with a coincident point", () => {
    // A double-click before the first real drag: the run's first segment is
    // zero-length, so distance 0 has no direction of its own and must borrow
    // from the next real segment (right, 90).
    const leadingDup: Point[] = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 5, y: 0 }];
    expect(pathAngleAt(leadingDup, 0)).toBeCloseTo(90, 9);
  });
});
