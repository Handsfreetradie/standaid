// Estimated voltage rise for a solar inverter's output circuit, checked
// against AS/NZS 4777.1's own limit. Reuses the Trade Tools' cable
// resistance/reactance data (real AS/NZS 3008.1.1 Table 30/34/35 figures)
// rather than a second, parallel lookup table — mvPerAm is a pure function
// with no UI dependency, safe to import here.
import { mvPerAm, type CableMaterial, type SystemType, type PhaseType } from "@/components/tools/electricalData";

// AS/NZS 4777.1 caps the total voltage rise from the inverter's AC output
// terminals to the point of common coupling at 2% (at rated output current)
// — the standard's own limit, not a guess.
export const MAX_INVERTER_VOLTAGE_RISE_PERCENT = 2;

export interface SolarVoltageRiseInput {
  material: CableMaterial;
  cableCsaMm2: string;
  systemType: SystemType;
  phase?: PhaseType;
  runLengthM: number; // one-way run, inverter to point of connection
  currentAmps: number;
  supplyVoltage: number; // 230 single-phase, 400 three-phase
  cableType?: string; // a CABLE_TYPES key, e.g. "xlpe" — omit for the 20°C reference estimate
}

export interface SolarVoltageRiseResult {
  voltageRisePercent: number;
  mvPerAm: number;
  pass: boolean;
}

// Same formula VoltageDropTool.tsx already uses: Vrise% = (mV/A·m × I × L) /
// 1000 / V × 100. Returns null when the material/size/cableType combination
// has no resistance figure at all (e.g. an aluminium size XLPE doesn't
// stock), same "unknown, not zero" convention mvPerAm itself uses.
export function calculateSolarVoltageRise(input: SolarVoltageRiseInput): SolarVoltageRiseResult | null {
  const mv = mvPerAm(input.material, input.cableCsaMm2, input.systemType, input.phase, 75, undefined, input.cableType);
  if (mv === null) return null;
  const voltageRisePercent = ((mv * input.currentAmps * input.runLengthM) / 1000 / input.supplyVoltage) * 100;
  return { voltageRisePercent, mvPerAm: mv, pass: voltageRisePercent <= MAX_INVERTER_VOLTAGE_RISE_PERCENT };
}
