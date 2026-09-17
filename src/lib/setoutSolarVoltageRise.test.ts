import { describe, it, expect } from "vitest";
import { mvPerAm } from "@/components/tools/electricalData";
import { calculateSolarVoltageRise, MAX_INVERTER_VOLTAGE_RISE_PERCENT } from "./setoutSolarVoltageRise";

describe("calculateSolarVoltageRise", () => {
  it("matches the same mV/A·m × I × L / 1000 / V × 100 formula VoltageDropTool uses", () => {
    const input = {
      material: "copper" as const,
      cableCsaMm2: "16",
      systemType: "ac" as const,
      phase: "single" as const,
      runLengthM: 50,
      currentAmps: 20,
      supplyVoltage: 230,
    };
    const mv = mvPerAm(input.material, input.cableCsaMm2, input.systemType, input.phase, 75)!;
    const expected = ((mv * input.currentAmps * input.runLengthM) / 1000 / input.supplyVoltage) * 100;

    const result = calculateSolarVoltageRise(input);
    expect(result).not.toBeNull();
    expect(result!.voltageRisePercent).toBeCloseTo(expected, 9);
    expect(result!.mvPerAm).toBeCloseTo(mv, 9);
  });

  it("passes exactly at the 2% AS/NZS 4777.1 limit and fails just over it", () => {
    const material = "copper" as const;
    const cableCsaMm2 = "16";
    const systemType = "ac" as const;
    const phase = "single" as const;
    const currentAmps = 20;
    const supplyVoltage = 230;
    const mv = mvPerAm(material, cableCsaMm2, systemType, phase, 75)!;

    // Solve the same formula backwards for the run length that lands
    // exactly on the limit, then nudge it up by 1% to cross the boundary.
    const lengthAtLimit = (MAX_INVERTER_VOLTAGE_RISE_PERCENT * 1000 * supplyVoltage) / (100 * mv * currentAmps);

    const atLimit = calculateSolarVoltageRise({ material, cableCsaMm2, systemType, phase, runLengthM: lengthAtLimit, currentAmps, supplyVoltage })!;
    expect(atLimit.voltageRisePercent).toBeCloseTo(MAX_INVERTER_VOLTAGE_RISE_PERCENT, 6);
    expect(atLimit.pass).toBe(true);

    const overLimit = calculateSolarVoltageRise({ material, cableCsaMm2, systemType, phase, runLengthM: lengthAtLimit * 1.01, currentAmps, supplyVoltage })!;
    expect(overLimit.voltageRisePercent).toBeGreaterThan(MAX_INVERTER_VOLTAGE_RISE_PERCENT);
    expect(overLimit.pass).toBe(false);
  });

  it("returns null for a material/size combination with no resistance figure (aluminium has no 1mm²)", () => {
    expect(
      calculateSolarVoltageRise({ material: "aluminium", cableCsaMm2: "1", systemType: "ac", phase: "single", runLengthM: 10, currentAmps: 10, supplyVoltage: 230 })
    ).toBeNull();
  });

  it("uses the real AS/NZS 3008.1.1 table figure (via cableType) rather than the 20°C-reference fallback", () => {
    const input = {
      material: "copper" as const,
      cableCsaMm2: "16",
      systemType: "ac" as const,
      phase: "single" as const,
      runLengthM: 50,
      currentAmps: 20,
      supplyVoltage: 230,
    };
    const withoutCableType = calculateSolarVoltageRise(input)!;
    const withXlpe = calculateSolarVoltageRise({ ...input, cableType: "xlpe" })!;
    // Same formula either way, but a different (table-based, real XLPE
    // single-core resistance/reactance) mV/A·m once cableType is given —
    // proving cableType is actually being passed through and used, not
    // silently ignored.
    expect(withXlpe.mvPerAm).not.toBeCloseTo(withoutCableType.mvPerAm, 3);
  });

  it("uses the cable's own operating temperature (90°C for XLPE) rather than always assuming 75°C", () => {
    const base = {
      material: "copper" as const,
      cableCsaMm2: "16",
      systemType: "ac" as const,
      phase: "single" as const,
      runLengthM: 50,
      currentAmps: 20,
      supplyVoltage: 230,
      cableType: "xlpe",
    };
    // Resistance rises with temperature, so mV/A·m at XLPE's real 90°C
    // operating temperature must come out higher than the same cable
    // evaluated (incorrectly) at 75°C — this is an internal-consistency
    // check against mvPerAm itself (not an externally published AS/NZS
    // 3008.1.1 figure), since that's what changing the hardcoded 75 is
    // actually meant to fix.
    const mv90 = calculateSolarVoltageRise(base)!.mvPerAm;
    const mv75 = mvPerAm("copper", "16", "ac", "single", 75, undefined, "xlpe")!;
    expect(mv90).toBeGreaterThan(mv75);
  });
});
