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

// --- mV/A/m voltage drop values per AS/NZS 3008.1.1 Table 40/42 ---
// Keys: `${material}-${phase}` for PVC cables
export const MV_PER_AM: Record<string, Record<string, number>> = {
  "copper-single-ac": {
    "1": 44, "1.5": 29, "2.5": 18, "4": 11, "6": 7.3, "10": 4.4, "16": 2.8,
    "25": 1.75, "35": 1.25, "50": 0.93, "70": 0.63, "95": 0.47, "120": 0.37,
    "150": 0.30, "185": 0.25, "240": 0.19,
  },
  "copper-three-ac": {
    "1": 38, "1.5": 25, "2.5": 15.5, "4": 9.5, "6": 6.4, "10": 3.8, "16": 2.4,
    "25": 1.5, "35": 1.1, "50": 0.81, "70": 0.55, "95": 0.41, "120": 0.32,
    "150": 0.26, "185": 0.22, "240": 0.165,
  },
  "aluminium-single-ac": {
    "16": 4.6, "25": 2.85, "35": 2.05, "50": 1.5, "70": 1.05,
    "95": 0.77, "120": 0.61, "150": 0.50, "185": 0.41, "240": 0.315,
  },
  "aluminium-three-ac": {
    "16": 4.0, "25": 2.5, "35": 1.8, "50": 1.3, "70": 0.91,
    "95": 0.67, "120": 0.53, "150": 0.43, "185": 0.35, "240": 0.27,
  },
  // DC uses same resistive values as single-phase (no reactance component)
  "copper-dc": {
    "1": 44, "1.5": 29, "2.5": 18, "4": 11, "6": 7.3, "10": 4.4, "16": 2.8,
    "25": 1.75, "35": 1.25, "50": 0.93, "70": 0.63, "95": 0.47, "120": 0.37,
    "150": 0.30, "185": 0.25, "240": 0.19,
  },
  "aluminium-dc": {
    "16": 4.6, "25": 2.85, "35": 2.05, "50": 1.5, "70": 1.05,
    "95": 0.77, "120": 0.61, "150": 0.50, "185": 0.41, "240": 0.315,
  },
};

// --- Temperature derating factors (AS/NZS 3008 Table 27) ---
export const TEMP_DERATING_PVC: Record<string, number> = {
  "25": 1.10, "30": 1.04, "35": 1.0, "40": 0.94, "45": 0.87, "50": 0.79, "55": 0.71, "60": 0.61,
};

export const TEMP_DERATING_XLPE: Record<string, number> = {
  "25": 1.07, "30": 1.04, "35": 1.02, "40": 1.0, "45": 0.96, "50": 0.93, "55": 0.89, "60": 0.84, "65": 0.79, "70": 0.73,
};

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
  if (insulation.includes("XLPE") || insulation.includes("90°C") || insulation.includes("Cross-linked")) {
    return TEMP_DERATING_XLPE[temp] ?? 1.0;
  }
  return TEMP_DERATING_PVC[temp] ?? 1.0;
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
