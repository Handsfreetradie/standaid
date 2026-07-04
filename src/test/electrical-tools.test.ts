import { describe, it, expect } from "vitest";
import { mvPerAm, getTempDerating, TEMP_DERATING_PVC, TEMP_DERATING_XLPE } from "../components/tools/electricalData";
import { calculateMaxDemandC1 } from "../components/tools/maxDemandC1";

describe("mvPerAm — voltage drop values vs AS/NZS 3008.1.1", () => {
  // Reference values from AS/NZS 3008.1.1 Table 42 (copper multicore, 75°C)
  it("matches known copper values at 75°C", () => {
    expect(mvPerAm("copper", "2.5", "ac", "single", 75)!).toBeCloseTo(18.0, 0);
    expect(mvPerAm("copper", "2.5", "ac", "three", 75)!).toBeCloseTo(15.6, 1);
    expect(mvPerAm("copper", "16", "ac", "three", 75)!).toBeCloseTo(2.43, 1);
    expect(mvPerAm("copper", "25", "ac", "three", 75)!).toBeCloseTo(1.54, 1);
  });

  it("includes reactance at large sizes (the old table's 21% error)", () => {
    // 240mm² copper three-phase: Zc = √(R75² + X²) ≈ 0.120 Ω/km → √3·Zc ≈ 0.21
    const v = mvPerAm("copper", "240", "ac", "three", 75)!;
    expect(v).toBeGreaterThan(0.20); // old hand-typed value was 0.165 — dangerously low
    expect(v).toBeLessThan(0.22);
  });

  it("uses resistance only for DC", () => {
    // DC has no reactance: 2 × R75 for 240mm² ≈ 0.183, well below the AC value
    const dc = mvPerAm("copper", "240", "dc", undefined, 75)!;
    const ac = mvPerAm("copper", "240", "ac", "single", 75)!;
    expect(dc).toBeLessThan(ac);
    expect(dc).toBeCloseTo(2 * 0.0754 * 1.2162, 2);
  });

  it("increases with conductor temperature (XLPE at 90°C reads higher)", () => {
    const at75 = mvPerAm("copper", "6", "ac", "single", 75)!;
    const at90 = mvPerAm("copper", "6", "ac", "single", 90)!;
    expect(at90).toBeGreaterThan(at75);
  });

  it("single-phase is 2/√3 times three-phase", () => {
    const single = mvPerAm("copper", "10", "ac", "single", 75)!;
    const three = mvPerAm("copper", "10", "ac", "three", 75)!;
    expect(single / three).toBeCloseTo(2 / Math.sqrt(3), 2);
  });

  it("agrees with AS/NZS 3000 Table C8 (simplified voltage drop, verified from the PDF)", () => {
    // Table C8 lists A·m per %Vd. mV/A·m = (V × 10) / (A·m per %Vd).
    // Single-phase 230V column: 2.5mm²=128, 4mm²=205, 16mm²=818, 25mm²=1289
    const c8Single: Record<string, number> = { "2.5": 128, "4": 205, "16": 818, "25": 1289 };
    for (const [size, am] of Object.entries(c8Single)) {
      const expected = 2300 / am;
      expect(mvPerAm("copper", size, "ac", "single", 75)!).toBeCloseTo(expected, 1);
    }
    // Three-phase 400V column: 2.5mm²=256, 16mm²=1643
    expect(mvPerAm("copper", "2.5", "ac", "three", 75)!).toBeCloseTo(4000 / 256, 1);
    expect(mvPerAm("copper", "16", "ac", "three", 75)!).toBeCloseTo(4000 / 1643, 1);
  });
});

describe("temperature derating — 40°C ambient base per AS/NZS 3008", () => {
  it("is 1.0 at the 40°C reference for both insulations", () => {
    expect(TEMP_DERATING_PVC["40"]).toBe(1.0);
    expect(TEMP_DERATING_XLPE["40"]).toBe(1.0);
  });

  it("follows the √((Top−Ta)/(Top−40)) curve", () => {
    // V-75 at 50°C: √(25/35) ≈ 0.845
    expect(TEMP_DERATING_PVC["50"]).toBeCloseTo(0.85, 1);
    // XLPE at 50°C: √(40/50) ≈ 0.894
    expect(TEMP_DERATING_XLPE["50"]).toBeCloseTo(0.89, 1);
  });

  it("does not derate MICC", () => {
    expect(getTempDerating("Mineral 250°C", "50")).toBe(1.0);
  });
});

describe("maximum demand — AS/NZS 3000 Table C1 single domestic", () => {
  it("calculates the classic worked example correctly", () => {
    // Typical house: 25 light points, 30 GPO points, 32A range,
    // 16A storage HWS, 20A aircon
    const r = calculateMaxDemandC1({
      lighting: 25,     // A(i): 3 + 2 (points 21–40)          = 5
      gpo10: 30,        // B(i): 10 + 5 (points 21–40)          = 15
      cooking: 32,      // C: 50% of 32                          = 16
      storageHws: 16,   // F: 100%                               = 16
      heatingAircon: 20, // D: 75% of 20                         = 15
    });
    const byKey = Object.fromEntries(r.lines.map((l) => [l.key, l.demandA]));
    expect(byKey.lighting).toBe(5);
    expect(byKey.gpo10).toBe(15);
    expect(byKey.cooking).toBe(16);
    expect(byKey.storageHws).toBe(16);
    expect(byKey.heatingAircon).toBe(15);
    expect(r.totalDemandA).toBe(67);
    expect(r.mainSwitchSizeA).toBe(80);
  });

  it("applies the 20-point steps for lighting and GPOs", () => {
    expect(calculateMaxDemandC1({ lighting: 20 }).totalDemandA).toBe(3);
    expect(calculateMaxDemandC1({ lighting: 21 }).totalDemandA).toBe(5);
    expect(calculateMaxDemandC1({ lighting: 41 }).totalDemandA).toBe(7);
    expect(calculateMaxDemandC1({ gpo10: 20 }).totalDemandA).toBe(10);
    expect(calculateMaxDemandC1({ gpo10: 21 }).totalDemandA).toBe(15);
  });

  it("applies 33.3% to instantaneous water heaters", () => {
    const r = calculateMaxDemandC1({ instantHws: 30 });
    expect(r.totalDemandA).toBe(10);
  });

  it("applies flat allowances for 15A and 20A socket outlets (verified against Table C1 text)", () => {
    // C1 b(ii)/b(iii): "one or more" outlets → flat 10 A / 15 A, NOT per outlet
    expect(calculateMaxDemandC1({ socket15: 1 }).totalDemandA).toBe(10);
    expect(calculateMaxDemandC1({ socket15: 3 }).totalDemandA).toBe(10);
    expect(calculateMaxDemandC1({ socket20: 2 }).totalDemandA).toBe(15);
  });

  it("ignores empty inputs", () => {
    const r = calculateMaxDemandC1({});
    expect(r.totalDemandA).toBe(0);
    expect(r.lines).toHaveLength(0);
  });
});
