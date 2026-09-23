import { describe, expect, it } from "vitest";
import {
  wetZonePolygonsFor,
  wetZoneWarningsFor,
  isSanitaryFittingType,
  type SanitaryFootprintFitting,
  type WetZoneCheckFitting,
} from "./setoutWetZones";

function shower(overrides: Partial<SanitaryFootprintFitting> = {}): SanitaryFootprintFitting {
  return {
    id: "shower-1",
    type: "shower",
    position: { x: 1, y: 1 },
    rotationDeg: 0,
    footprintWidthMm: 900,
    footprintDepthMm: 900,
    ...overrides,
  };
}

describe("isSanitaryFittingType", () => {
  it("recognises bath/shower/basin and nothing else", () => {
    expect(isSanitaryFittingType("bath")).toBe(true);
    expect(isSanitaryFittingType("shower")).toBe(true);
    expect(isSanitaryFittingType("basin")).toBe(true);
    expect(isSanitaryFittingType("gpo")).toBe(false);
  });
});

describe("wetZonePolygonsFor", () => {
  it("a shower against a wall (rotation 0): Zone 1 matches its footprint, centred on its position", () => {
    const zones = wetZonePolygonsFor(shower());
    const zone1 = zones.find((z) => z.zone === 1)!;
    // 900mm footprint => 0.45m half-extents either side of the centre (1,1)
    const xs = zone1.polygon.map((p) => p.x);
    const ys = zone1.polygon.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(0.55, 6);
    expect(Math.max(...xs)).toBeCloseTo(1.45, 6);
    expect(Math.min(...ys)).toBeCloseTo(0.55, 6);
    expect(Math.max(...ys)).toBeCloseTo(1.45, 6);
  });

  it("Zone 2 sits 0.6m further out than Zone 1 on every side", () => {
    const zones = wetZonePolygonsFor(shower());
    const zone2 = zones.find((z) => z.zone === 2)!;
    const xs = zone2.polygon.map((p) => p.x);
    const ys = zone2.polygon.map((p) => p.y);
    // Zone 1 half-extent 0.45 + 0.6 margin = 1.05
    expect(Math.min(...xs)).toBeCloseTo(1 - 1.05, 6);
    expect(Math.max(...xs)).toBeCloseTo(1 + 1.05, 6);
    expect(Math.min(...ys)).toBeCloseTo(1 - 1.05, 6);
    expect(Math.max(...ys)).toBeCloseTo(1 + 1.05, 6);
  });

  it("every zone carries the same 2.25m height limit", () => {
    const zones = wetZonePolygonsFor(shower());
    for (const z of zones) expect(z.heightLimitM).toBeCloseTo(2.25, 6);
  });

  it("a basin has no Cl 6.2 zones at all", () => {
    const zones = wetZonePolygonsFor(shower({ id: "basin-1", type: "basin", footprintWidthMm: 600, footprintDepthMm: 450 }));
    expect(zones).toEqual([]);
  });

  it("rotation: a 900x900 shower rotated 90° still has a square Zone 1 footprint at the same place (symmetric case)", () => {
    const flat = wetZonePolygonsFor(shower());
    const rotated = wetZonePolygonsFor(shower({ rotationDeg: 90 }));
    const zone1Flat = flat.find((z) => z.zone === 1)!.polygon;
    const zone1Rotated = rotated.find((z) => z.zone === 1)!.polygon;
    // Square footprint => rotating 90° about its own centre reproduces the
    // same set of corner points (order may differ), proving rotation is
    // actually applied about the fitting's position rather than the origin.
    const sortedFlat = [...zone1Flat].sort((a, b) => a.x - b.x || a.y - b.y);
    const sortedRotated = [...zone1Rotated].sort((a, b) => a.x - b.x || a.y - b.y);
    sortedFlat.forEach((p, i) => {
      expect(sortedRotated[i].x).toBeCloseTo(p.x, 6);
      expect(sortedRotated[i].y).toBeCloseTo(p.y, 6);
    });
  });

  it("rotation: a rectangular bath rotated 90° swaps which axis its long side runs along", () => {
    const bathFlat = wetZonePolygonsFor(
      shower({ id: "bath-1", type: "bath", position: { x: 0, y: 0 }, footprintWidthMm: 1700, footprintDepthMm: 750, rotationDeg: 0 })
    );
    const bathRotated = wetZonePolygonsFor(
      shower({ id: "bath-1", type: "bath", position: { x: 0, y: 0 }, footprintWidthMm: 1700, footprintDepthMm: 750, rotationDeg: 90 })
    );
    const zone1Flat = bathFlat.find((z) => z.zone === 1)!.polygon;
    const zone1Rotated = bathRotated.find((z) => z.zone === 1)!.polygon;
    const spanX = (pts: { x: number; y: number }[]) => Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
    const spanY = (pts: { x: number; y: number }[]) => Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y));
    expect(spanX(zone1Flat)).toBeCloseTo(1.7, 6);
    expect(spanY(zone1Flat)).toBeCloseTo(0.75, 6);
    // After 90° rotation the long (1.7m) side now runs along y, short along x
    expect(spanX(zone1Rotated)).toBeCloseTo(0.75, 6);
    expect(spanY(zone1Rotated)).toBeCloseTo(1.7, 6);
  });
});

describe("wetZoneWarningsFor", () => {
  const theShower = shower(); // centre (1,1), Zone 1 half-extent 0.45m, Zone 2 half-extent 1.05m

  it("flags a GPO inside Zone 1 with a Zone 1 message", () => {
    const gpo: WetZoneCheckFitting = { id: "gpo-1", type: "gpo", position: { x: 1.1, y: 1.1 } }; // well inside 0.45m half-extent
    const warnings = wetZoneWarningsFor([theShower], [gpo]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ fittingId: "gpo-1", zone: 1 });
    expect(warnings[0].message).toMatch(/Zone 1/);
    expect(warnings[0].message.toLowerCase()).toMatch(/verify/);
  });

  it("flags a GPO inside Zone 2 (but outside Zone 1) with a Zone 2 message", () => {
    const gpo: WetZoneCheckFitting = { id: "gpo-2", type: "gpo", position: { x: 1.8, y: 1 } }; // 0.8m from centre: outside 0.45, inside 1.05
    const warnings = wetZoneWarningsFor([theShower], [gpo]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ fittingId: "gpo-2", zone: 2 });
    expect(warnings[0].message).toMatch(/Zone 2/);
  });

  it("does not flag a GPO placed well outside Zone 2", () => {
    const gpo: WetZoneCheckFitting = { id: "gpo-3", type: "gpo", position: { x: 5, y: 5 } };
    expect(wetZoneWarningsFor([theShower], [gpo])).toEqual([]);
  });

  it("flags a downlight and a switch the same way as a GPO when inside Zone 1", () => {
    const downlight: WetZoneCheckFitting = { id: "dl-1", type: "downlight", position: { x: 1, y: 1 } };
    const switchFitting: WetZoneCheckFitting = { id: "sw-1", type: "switch", position: { x: 1.2, y: 0.9 } };
    const warnings = wetZoneWarningsFor([theShower], [downlight, switchFitting]);
    expect(warnings.map((w) => w.fittingId).sort()).toEqual(["dl-1", "sw-1"]);
  });

  it("never flags another sanitary fitting even if their footprints overlap", () => {
    const basin: WetZoneCheckFitting = { id: "basin-1", type: "basin", position: { x: 1.1, y: 1.1 } };
    expect(wetZoneWarningsFor([theShower], [basin])).toEqual([]);
  });

  it("a basin-only sanitary fitting produces no warnings for anything nearby (no Cl 6.2 zone)", () => {
    const basinFixture = shower({ id: "basin-2", type: "basin", footprintWidthMm: 600, footprintDepthMm: 450 });
    const gpo: WetZoneCheckFitting = { id: "gpo-4", type: "gpo", position: { x: 1, y: 1 } };
    expect(wetZoneWarningsFor([basinFixture], [gpo])).toEqual([]);
  });

  it("GPO message calls out relocation specifically, distinct from the general IP/RCD wording", () => {
    const gpo: WetZoneCheckFitting = { id: "gpo-5", type: "gpo", position: { x: 1, y: 1 } };
    const warnings = wetZoneWarningsFor([theShower], [gpo]);
    expect(warnings[0].message.toLowerCase()).toMatch(/relocate/);
  });
});
