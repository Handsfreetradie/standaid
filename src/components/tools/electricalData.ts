// ============================================================
// Shared electrical data for all trade tools
// Based on AS/NZS 3008.1.1, AS/NZS 3000, AS/NZS 2053
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
  // Flat TPS V-75 copper (two-core sheathed thermoplastic) — AS/NZS 3008.1.1
  // Table 10, column 11 "Enclosed — wiring enclosure in air", Cu solid/stranded.
  // Verified 2026-07-13 cell-by-cell against the vision-transcribed Table 10
  // from the user's uploaded standard; the previous hand-typed values were
  // ~10% low (they tracked the exposed-to-sun column, not enclosed).
  "flat-tps-v75-copper": {
    "1": 13, "1.5": 16, "2.5": 23, "4": 30, "6": 39, "10": 52, "16": 68,
  },
  // V-90 building wire copper – Table 4 Col 4 (enclosed)
  "v90-copper": {
    "1": 14, "1.5": 17.5, "2.5": 24, "4": 32, "6": 41, "10": 56, "16": 73,
  },
  // XLPE (X-90) copper single-core — AS/NZS 3008.1.1 Table 5 column 14
  // "Enclosed — wiring enclosure in air", Cu. Verified 2026-07-13 cell-by-cell
  // against the vision-transcribed Table 5 from the user's uploaded standard;
  // the previous values (wrongly attributed to Table 12, which is 110°C
  // insulation) ran 2–5% HIGH — the unsafe direction. Two-conductor (1Ø)
  // basis; three-phase circuits (Table 8) rate slightly lower.
  "xlpe-copper": {
    "1.5": 21, "2.5": 30, "4": 38, "6": 47, "10": 65, "16": 84,
    "25": 113, "35": 135, "50": 166, "70": 204, "95": 255, "120": 292,
    "150": 329, "185": 387, "240": 461,
  },
  // XLPE aluminium — Table 5 column 16 (enclosed), verified as above
  "xlpe-aluminium": {
    "16": 65, "25": 87, "35": 105, "50": 129, "70": 159, "95": 198,
    "120": 226, "150": 255, "185": 301, "240": 360,
  },
  // Orange circular copper — UNVERIFIED: proper basis is Table 13 (3/4-core
  // thermoplastic) whose transcription came back column-garbled; these
  // conservative V-90-derived values stay until Table 13 verifies cleanly.
  "orange-circular-copper": {
    "1.5": 17.5, "2.5": 24, "4": 32, "6": 41, "10": 56, "16": 73,
    "25": 97, "35": 119, "50": 144,
  },
  // SDI copper — single-core X-90, same Table 5 column 14 basis (verified)
  "sdi-copper": {
    "6": 47, "10": 65, "16": 84, "25": 113, "35": 135, "50": 166,
    "70": 204, "95": 255, "120": 292, "150": 329, "185": 387, "240": 461,
  },
  // SDI aluminium — Table 5 column 16 (verified)
  "sdi-aluminium": {
    "16": 65, "25": 87, "35": 105, "50": 129, "70": 159, "95": 198,
    "120": 226, "150": 255, "185": 301, "240": 360,
  },
  // MICC copper
  "mineral-insulated-copper": {
    "1": 18, "1.5": 23, "2.5": 31, "4": 42,
  },
};

// --- Voltage drop (mV/A·m) — resistance and reactance transcribed directly
// from the user's copy of AS/NZS 3008.1.1:2017 (Tables 30, 34, 35), keyed by
// cable construction, rather than derived from a 20°C reference resistance.
// Table 34 (single-core) and Table 35 (multicore circular) are near-identical
// at common sizes but diverge slightly ≥240mm² — worth keeping separate.
//
// a.c. resistance (Rc), Ω/km, at [75°C, 90°C] conductor temperature.
const R34_SINGLE_CORE: Record<CableMaterial, Record<string, [number, number]>> = {
  copper: {
    "1": [25.8, 27.0], "1.5": [16.5, 17.3], "2.5": [9.01, 9.45], "4": [5.61, 5.88],
    "6": [3.75, 3.93], "10": [2.23, 2.33], "16": [1.40, 1.47], "25": [0.884, 0.927],
    "35": [0.638, 0.668], "50": [0.471, 0.494], "70": [0.327, 0.342], "95": [0.236, 0.247],
    "120": [0.188, 0.197], "150": [0.153, 0.160], "185": [0.123, 0.129], "240": [0.0948, 0.0991],
  },
  aluminium: {
    "16": [2.33, 2.45], "25": [1.47, 1.54], "35": [1.06, 1.11], "50": [0.783, 0.822],
    "70": [0.542, 0.568], "95": [0.392, 0.411], "120": [0.310, 0.325], "150": [0.253, 0.265],
    "185": [0.202, 0.212], "240": [0.155, 0.162],
  },
};

// Copper only — both multicore cable types modelled in this app use copper conductors.
const R35_MULTICORE_CIRCULAR: Record<string, [number, number]> = {
  "1": [25.8, 27.0], "1.5": [16.5, 17.3], "2.5": [9.01, 9.45], "4": [5.61, 5.88],
  "6": [3.75, 3.93], "10": [2.23, 2.33], "16": [1.40, 1.47], "25": [0.884, 0.927],
  "35": [0.638, 0.669], "50": [0.471, 0.494],
};

// Reactance (Xc), Ω/km — geometric, so the same value applies to copper and
// aluminium conductors of the same size. Single-core uses the "trefoil (or
// single phase)" column; multicore uses the "circular conductors" column.
const X30_SINGLE_CORE_TREFOIL_PVC: Record<string, number> = {
  "1": 0.168, "1.5": 0.157, "2.5": 0.143, "4": 0.137, "6": 0.128, "10": 0.118, "16": 0.111,
};
const X30_SINGLE_CORE_TREFOIL_XLPE: Record<string, number> = {
  "1.5": 0.155, "2.5": 0.141, "4": 0.131, "6": 0.123, "10": 0.114, "16": 0.106, "25": 0.102,
  "35": 0.0982, "50": 0.0924, "70": 0.0893, "95": 0.0868, "120": 0.0844, "150": 0.0844,
  "185": 0.0835, "240": 0.0818,
};
const X30_MULTICORE_CIRCULAR_PVC: Record<string, number> = {
  "1": 0.119, "1.5": 0.111, "2.5": 0.102, "4": 0.102, "6": 0.0967, "10": 0.0906, "16": 0.0861,
  "25": 0.0853, "35": 0.0826, "50": 0.0797,
};

// Which AS/NZS 3008.1.1 construction table applies to each cable type this app
// models. Mineral Insulated (MICC) isn't mapped — it uses its own separate
// Table 38, and its 1-4mm² size range makes voltage drop a non-issue in
// practice — it keeps the 20°C-reference estimate below as a fallback.
const CABLE_CONSTRUCTION: Partial<Record<string, "single-core" | "multicore-circular">> = {
  "flat-tps-v75": "multicore-circular",
  "v90": "single-core",
  "xlpe": "single-core",
  "orange-circular": "multicore-circular",
  "sdi": "single-core",
};

function resistanceFromTable(
  material: CableMaterial,
  size: string,
  construction: "single-core" | "multicore-circular",
  conductorTempC: number,
): number | null {
  const col = conductorTempC >= 82.5 ? 1 : 0; // nearest of the tabled 75°C/90°C columns
  if (construction === "single-core") return R34_SINGLE_CORE[material]?.[size]?.[col] ?? null;
  return material === "copper" ? R35_MULTICORE_CIRCULAR[size]?.[col] ?? null : null;
}

function reactanceFromTable(
  size: string,
  construction: "single-core" | "multicore-circular",
  insulation: string,
): number | null {
  if (construction === "multicore-circular") return X30_MULTICORE_CIRCULAR_PVC[size] ?? null;
  const isXlpe = insulation.includes("XLPE") || insulation.includes("Cross-linked");
  return (isXlpe ? X30_SINGLE_CORE_TREFOIL_XLPE : X30_SINGLE_CORE_TREFOIL_PVC)[size] ?? null;
}

// Fallback resistance model (20°C reference + temperature coefficient) for
// cable types without a direct AS/NZS 3008.1.1 table mapping above, e.g. MICC.
const R20_OHM_PER_KM: Record<CableMaterial, Record<string, number>> = {
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
const REACTANCE_OHM_PER_KM = 0.08; // typical multicore reactance, near-constant across sizes

// mV/A·m for a run: single-phase = 2·Zc, three-phase = √3·Zc, DC = 2·R.
// conductorTempC should be the insulation's operating temperature
// (75 for V-75, 90 for XLPE/V-90) — resistance rises ~6% from 75→90°C.
//
// cableType (a key from CABLE_TYPES) selects the real AS/NZS 3008.1.1 table
// for the cable's actual construction — single-core (Table 34) vs multicore
// circular (Table 35) resistance, and the matching Table 30 reactance column.
// Omit it to fall back to the 20°C-reference estimate (used for cable types
// not yet mapped in CABLE_CONSTRUCTION, e.g. MICC).
//
// powerFactor: AS/NZS 3008.1.1 Clause 4.5 computes AC voltage drop from
// (R·cosφ + X·sinφ), not |Z|. At unity pf only R matters; ignoring this
// (the old behaviour) overstated drop slightly at pf 1 and misstated it on
// larger cables at low pf. Omit powerFactor to keep the |Z| (worst-case)
// figure the printed tables use.
export function mvPerAm(
  material: CableMaterial,
  size: string,
  system: SystemType,
  phase?: PhaseType,
  conductorTempC = 75,
  powerFactor?: number,
  cableType?: string,
): number | null {
  const construction = cableType ? CABLE_CONSTRUCTION[cableType] : undefined;
  let r: number | null = null;
  let x = REACTANCE_OHM_PER_KM;

  if (construction) {
    const tabledR = resistanceFromTable(material, size, construction, conductorTempC);
    if (tabledR !== null) {
      r = tabledR;
      const insulation = CABLE_TYPES[cableType!]?.insulation ?? "PVC";
      const tabledX = reactanceFromTable(size, construction, insulation);
      if (tabledX !== null) x = tabledX;
    }
  }

  if (r === null) {
    const r20 = R20_OHM_PER_KM[material]?.[size];
    if (!r20) return null;
    const alpha = material === "copper" ? 0.00393 : 0.00403;
    r = r20 * (1 + alpha * (conductorTempC - 20));
  }

  if (system === "dc") return 2 * r;
  let effective: number;
  if (powerFactor !== undefined && powerFactor > 0 && powerFactor < 1) {
    const sinPhi = Math.sqrt(1 - powerFactor * powerFactor);
    effective = r * powerFactor + x * sinPhi;
  } else {
    effective = Math.sqrt(r * r + x * x);
  }
  return phase === "three" ? Math.sqrt(3) * effective : 2 * effective;
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
  "buried-direct": { label: "Buried direct (guide)", factor: 0.97, description: "APPROXIMATION — real buried ratings come from AS/NZS 3008's separate soil-based tables. Verify before relying on this." },
  "buried-conduit": { label: "Buried in conduit (guide)", factor: 0.88, description: "APPROXIMATION — real buried ratings come from AS/NZS 3008's separate soil-based tables. Verify before relying on this." },
  "in-insulation-covered": { label: "In thermal insulation (covered)", factor: 0.50, description: "Completely surrounded by insulation" },
  "in-insulation-one-side": { label: "In insulation (one side)", factor: 0.75, description: "Touching insulation on one side" },
  // No uplift for free air: in-air ratings come from the standard's own
  // unenclosed tables, not a bonus factor on the enclosed column (the old
  // ×1.05 was invented and could pass a cable the real table would fail).
  "free-air": { label: "Free air / suspended", factor: 1.0, description: "Unenclosed in-air ratings are higher — this uses the enclosed value as a safe floor" },
};

// Installation methods whose real ratings live in separate tables of the
// standard — results for these are flagged as a guide, not a compliance call.
export const APPROXIMATE_METHODS = new Set(["buried-direct", "buried-conduit"]);

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

// Conduit space factors (accepted industry practice: 53% one cable, 31% two, 40% three+)
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
