// ============================================================
// Shared electrical data for all trade tools
// Based on AS/NZS 3008.1.1, AS/NZS 3000, AS/NZS 3080
// ============================================================

export type SystemType = "ac" | "dc";
export type PhaseType = "single" | "three";
export type CableMaterial = "copper" | "aluminium";

// --- Cable Types common in AU ---
export interface CableTypeInfo {
  label: string;
  insulation: string;
  maxTemp: number;
  materials: CableMaterial[];
  configurations: string[];
  sizes: Record<CableMaterial, string[]>;
}

export const CABLE_TYPES: Record<string, CableTypeInfo> = {
  "flat-tps-v75": {
    label: "Flat TPS (V-75)",
    insulation: "PVC 75°C",
    maxTemp: 75,
    materials: ["copper"],
    configurations: ["flat-multicore"],
    sizes: {
      copper: ["1", "1.5", "2.5", "4", "6", "10", "16"],
      aluminium: [],
    },
  },
  "v90": {
    label: "V-90 (Building Wire)",
    insulation: "PVC 90°C",
    maxTemp: 90,
    materials: ["copper"],
    configurations: ["single-core"],
    sizes: {
      copper: ["1", "1.5", "2.5", "4", "6", "10", "16"],
      aluminium: [],
    },
  },
  "xlpe": {
    label: "XLPE",
    insulation: "Cross-linked PE 90°C",
    maxTemp: 90,
    materials: ["copper", "aluminium"],
    configurations: ["single-core", "multicore"],
    sizes: {
      copper: ["1.5", "2.5", "4", "6", "10", "16", "25", "35", "50", "70", "95", "120", "150", "185", "240"],
      aluminium: ["16", "25", "35", "50", "70", "95", "120", "150", "185", "240"],
    },
  },
  "orange-circular": {
    label: "Orange Circular",
    insulation: "PVC 90°C",
    maxTemp: 90,
    materials: ["copper"],
    configurations: ["multicore-circular"],
    sizes: {
      copper: ["1.5", "2.5", "4", "6", "10", "16", "25", "35", "50"],
      aluminium: [],
    },
  },
  "sdi": {
    label: "SDI (Single / Double Insulated)",
    insulation: "XLPE / PVC",
    maxTemp: 90,
    materials: ["copper", "aluminium"],
    configurations: ["single-core"],
    sizes: {
      copper: ["6", "10", "16", "25", "35", "50", "70", "95", "120", "150", "185", "240"],
      aluminium: ["16", "25", "35", "50", "70", "95", "120", "150", "185", "240"],
    },
  },
  "mineral-insulated": {
    label: "MICC (Mineral Insulated)",
    insulation: "Mineral 250°C",
    maxTemp: 250,
    materials: ["copper"],
    configurations: ["multicore"],
    sizes: {
      copper: ["1", "1.5", "2.5", "4"],
      aluminium: [],
    },
  },
};

// --- Current-carrying capacity (A) per AS/NZS 3008.1.1 ---
// Keys: `${cableType}-${material}` → { size: amps }
// Simplified: enclosed/clipped reference values at 40°C for PVC, 45°C for XLPE
export const CURRENT_CAPACITY: Record<string, Record<string, number>> = {
  // Flat TPS V-75 copper – Table 3 Col 4 (enclosed, single circuit)
  "flat-tps-v75-copper": {
    "1": 13, "1.5": 15.5, "2.5": 20, "4": 27, "6": 34, "10": 46, "16": 61,
  },
  // V-90 building wire copper – Table 4 Col 4 (enclosed)
  "v90-copper": {
    "1": 14, "1.5": 17.5, "2.5": 24, "4": 32, "6": 41, "10": 56, "16": 73,
  },
  // XLPE copper – Table 12 Col 4 (enclosed)
  "xlpe-copper": {
    "1.5": 22, "2.5": 29, "4": 38, "6": 49, "10": 67, "16": 88,
    "25": 115, "35": 141, "50": 170, "70": 214, "95": 259, "120": 301,
    "150": 346, "185": 396, "240": 468,
  },
  // XLPE aluminium – Table 12 Col 4
  "xlpe-aluminium": {
    "16": 68, "25": 89, "35": 109, "50": 132, "70": 166, "95": 201,
    "120": 233, "150": 268, "185": 307, "240": 363,
  },
  // Orange circular copper – same as V-90 enclosed
  "orange-circular-copper": {
    "1.5": 17.5, "2.5": 24, "4": 32, "6": 41, "10": 56, "16": 73,
    "25": 97, "35": 119, "50": 144,
  },
  // SDI copper – Table 12 (similar to XLPE)
  "sdi-copper": {
    "6": 49, "10": 67, "16": 88, "25": 115, "35": 141, "50": 170,
    "70": 214, "95": 259, "120": 301, "150": 346, "185": 396, "240": 468,
  },
  // SDI aluminium
  "sdi-aluminium": {
    "16": 68, "25": 89, "35": 109, "50": 132, "70": 166, "95": 201,
    "120": 233, "150": 268, "185": 307, "240": 363,
  },
  // MICC copper
  "mineral-insulated-copper": {
    "1": 18, "1.5": 23, "2.5": 31, "4": 42,
  },
};

// --- Voltage drop (mV/A·m) computed the same way AS/NZS 3008.1.1 derives
// Tables 40-51: conductor resistance at operating temperature plus cable
// reactance. The previous hand-typed tables ignored reactance, which made
// large cables (≥120mm²) read up to 21% LOW — a compliance risk on submains.
//
// R20 values are the standard conductor resistances (IEC 60228 / AS 1125).
export const R20_OHM_PER_KM: Record<CableMaterial, Record<string, number>> = {
  copper: {
    "1": 18.1, "1.5": 12.1, "2.5": 7.41, "4": 4.61, "6": 3.08, "10": 1.83,
    "16": 1.15, "25": 0.727, "35": 0.524, "50": 0.387, "70": 0.268,
    "95": 0.193, "120": 0.153, "150": 0.124, "185": 0.0991, "240": 0.0754,
  },
  aluminium: {
    "16": 1.91, "25": 1.20, "35": 0.868, "50": 0.641, "70": 0.443,
    "95": 0.320, "120": 0.253, "150": 0.206, "185": 0.164, "240": 0.125,
  },
};

// Typical multicore cable reactance (Ω/km) — near-constant across sizes
const REACTANCE_OHM_PER_KM = 0.08;

// mV/A·m for a run: single-phase = 2·Zc, three-phase = √3·Zc, DC = 2·R.
// conductorTempC should be the insulation's operating temperature
// (75 for V-75, 90 for XLPE/V-90) — resistance rises ~6% from 75→90°C.
export function mvPerAm(
  material: CableMaterial,
  size: string,
  system: SystemType,
  phase?: PhaseType,
  conductorTempC = 75,
): number | null {
  const r20 = R20_OHM_PER_KM[material]?.[size];
  if (!r20) return null;
  const alpha = material === "copper" ? 0.00393 : 0.00403;
  const r = r20 * (1 + alpha * (conductorTempC - 20));
  if (system === "dc") return 2 * r;
  const z = Math.sqrt(r * r + REACTANCE_OHM_PER_KM * REACTANCE_OHM_PER_KM);
  return phase === "three" ? Math.sqrt(3) * z : 2 * z;
}

// Backwards-compatible lookup tables, generated at 75°C conductor temperature.
// Prefer calling mvPerAm() directly with the cable's real operating temp.
function buildMvTable(material: CableMaterial, system: SystemType, phase?: PhaseType): Record<string, number> {
  const out: Record<string, number> = {};
  for (const size of Object.keys(R20_OHM_PER_KM[material])) {
    const v = mvPerAm(material, size, system, phase, 75);
    if (v !== null) out[size] = Math.round(v * 1000) / 1000;
  }
  return out;
}

export const MV_PER_AM: Record<string, Record<string, number>> = {
  "copper-single-ac": buildMvTable("copper", "ac", "single"),
  "copper-three-ac": buildMvTable("copper", "ac", "three"),
  "aluminium-single-ac": buildMvTable("aluminium", "ac", "single"),
  "aluminium-three-ac": buildMvTable("aluminium", "ac", "three"),
  "copper-dc": buildMvTable("copper", "dc"),
  "aluminium-dc": buildMvTable("aluminium", "dc"),
};

// --- Temperature derating factors (AS/NZS 3008 Table 27a method) ---
// Derived as √((Top − Tambient) / (Top − 40)) — the air tables in AS/NZS
// 3008.1.1 are based on 40°C ambient air, not 35°C as previously coded
// (the old tables under-derated PVC at 40°C+ and were optimistic for XLPE).
function tempFactor(operatingTemp: number, ambient: number): number {
  const f = Math.sqrt((operatingTemp - ambient) / (operatingTemp - 40));
  return Math.round(f * 100) / 100;
}

function buildTempTable(operatingTemp: number, ambients: number[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of ambients) out[String(a)] = tempFactor(operatingTemp, a);
  return out;
}

export const TEMP_DERATING_PVC: Record<string, number> =
  buildTempTable(75, [25, 30, 35, 40, 45, 50, 55, 60]);

export const TEMP_DERATING_XLPE: Record<string, number> =
  buildTempTable(90, [25, 30, 35, 40, 45, 50, 55, 60, 65, 70]);

// --- Installation method derating (AS/NZS 3008 Tables 22-25) ---
export interface InstallMethod {
  label: string;
  factor: number;
  description: string;
}

export const INSTALL_METHODS: Record<string, InstallMethod> = {
  "clipped-direct": { label: "Clipped direct", factor: 1.0, description: "Surface-mounted, clipped to wall/ceiling" },
  "conduit-surface": { label: "In conduit (surface)", factor: 0.94, description: "PVC or steel conduit on surface" },
  "conduit-recessed": { label: "In conduit (recessed)", factor: 0.90, description: "Conduit embedded in wall/ceiling" },
  "trunking": { label: "In trunking", factor: 0.90, description: "Cable trunking / ducting" },
  "cable-tray-touching": { label: "Cable tray (touching)", factor: 0.87, description: "Perforated tray, cables touching" },
  "cable-tray-spaced": { label: "Cable tray (spaced)", factor: 1.0, description: "Perforated tray, cables spaced apart" },
  "buried-direct": { label: "Buried direct", factor: 0.97, description: "Direct buried in ground" },
  "buried-conduit": { label: "Buried in conduit", factor: 0.88, description: "Underground in conduit" },
  "in-insulation-covered": { label: "In thermal insulation (covered)", factor: 0.50, description: "Completely surrounded by insulation" },
  "in-insulation-one-side": { label: "In insulation (one side)", factor: 0.75, description: "Touching insulation on one side" },
  "free-air": { label: "Free air / suspended", factor: 1.05, description: "Suspended in air, good ventilation" },
};

// --- Grouping derating factors (AS/NZS 3008 Table 22) ---
export const GROUPING_DERATING: Record<number, number> = {
  1: 1.0,
  2: 0.80,
  3: 0.70,
  4: 0.65,
  5: 0.60,
  6: 0.57,
  7: 0.54,
  8: 0.52,
  9: 0.50,
};

// --- AC Voltage presets ---
export const AC_VOLTAGES = ["230", "240", "400", "415"] as const;
export const DC_VOLTAGES = ["12", "24", "48", "110", "120"] as const;

// --- Conduit data (AS/NZS 2053) ---
export const CONDUIT_SIZES: Record<string, { label: string; internalArea: number }> = {
  "16": { label: "16mm", internalArea: 157 },
  "20": { label: "20mm", internalArea: 227 },
  "25": { label: "25mm", internalArea: 380 },
  "32": { label: "32mm", internalArea: 641 },
  "40": { label: "40mm", internalArea: 1018 },
  "50": { label: "50mm", internalArea: 1590 },
  "63": { label: "63mm", internalArea: 2552 },
};

// Cable overall diameters (mm) for conduit fill
export const CABLE_OD: Record<string, Record<string, number>> = {
  "Flat TPS (V-75)": {
    "1": 8.0, "1.5": 9.0, "2.5": 10.5, "4": 11.5, "6": 12.5, "10": 14.5, "16": 17.0,
  },
  "V-90 (single core)": {
    "1": 3.5, "1.5": 3.9, "2.5": 4.5, "4": 5.2, "6": 5.8, "10": 7.2, "16": 8.6,
  },
  "XLPE (single core)": {
    "1.5": 4.2, "2.5": 4.8, "4": 5.5, "6": 6.2, "10": 7.8, "16": 9.2,
    "25": 11.2, "35": 12.8, "50": 14.6, "70": 17.0, "95": 19.5,
  },
  "Orange Circular": {
    "1.5": 10.5, "2.5": 11.5, "4": 13.0, "6": 14.5, "10": 17.0, "16": 20.0,
    "25": 23.0, "35": 26.0, "50": 30.0,
  },
  "SDI": {
    "6": 10.0, "10": 12.0, "16": 14.0, "25": 17.0, "35": 19.0, "50": 22.0,
    "70": 25.0, "95": 29.0, "120": 32.0,
  },
};

// AS/NZS 3080 fill ratios
export const CONDUIT_FILL_RATIOS: Record<string, { label: string; ratio: number }> = {
  "1": { label: "1 cable", ratio: 0.53 },
  "2": { label: "2 cables", ratio: 0.31 },
  "3+": { label: "3+ cables", ratio: 0.40 },
};

// --- Utility functions ---
export function getTempDerating(insulation: string, temp: string): number {
  if (insulation.includes("Mineral")) return 1.0; // MICC unaffected at these ambients
  if (insulation.includes("XLPE") || insulation.includes("90°C") || insulation.includes("Cross-linked")) {
    return TEMP_DERATING_XLPE[temp] ?? 1.0;
  }
  return TEMP_DERATING_PVC[temp] ?? 1.0;
}

// Conductor operating temperature for voltage drop — capped at 90°C (MICC's
// 250°C sheath rating is not a normal conductor operating temperature).
export function conductorTempFor(cableMaxTemp: number | undefined): number {
  const t = cableMaxTemp ?? 75;
  return Math.min(t, 90);
}

export function getGroupingDerating(circuits: number): number {
  if (circuits <= 1) return 1.0;
  if (circuits >= 9) return 0.50;
  return GROUPING_DERATING[circuits] ?? 0.50;
}

export function getMvKey(material: CableMaterial, system: SystemType, phase?: PhaseType): string {
  if (system === "dc") return `${material}-dc`;
  return `${material}-${phase || "single"}-ac`;
}

export function getCapacityKey(cableType: string, material: CableMaterial): string {
  return `${cableType}-${material}`;
}

export function getAvailableSizes(cableType: string, material: CableMaterial): string[] {
  const ct = CABLE_TYPES[cableType];
  if (!ct) return [];
  return ct.sizes[material] || [];
}
