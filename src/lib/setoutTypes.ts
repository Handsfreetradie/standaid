import type { FittingType } from "@/components/setout/symbols";

export type FittingCategory = "lighting" | "power" | "switches" | "data" | "safety" | "heatCool" | "ductedVacuum";

export const CATEGORY_FOR_TYPE: Record<FittingType, FittingCategory> = {
  // Lighting
  downlight: "lighting",
  batten_holder: "lighting",
  wall_batten_holder: "lighting",
  wall_stair_light: "lighting",
  external_light: "lighting",
  heater_fan_light_2: "lighting",
  heater_fan_light_4: "lighting",
  junction_box: "lighting",
  ceiling_fan: "lighting",
  ceiling_fan_light: "lighting",
  para_flood: "lighting",
  round_fluoro: "lighting",
  fluoro_1200: "lighting",
  motion_sensor: "lighting",
  exhaust_fan: "safety",
  exhaust_fan_light: "lighting",
  pendant: "lighting",
  // Switches
  switch: "switches",
  // Power
  gpo: "power",
  tv_point: "power",
  phone_point: "power",
  meter_box: "power",
  nbn_box: "power",
  ubo_rhood: "power",
  // Data
  data: "data",
  // Safety
  smoke_detector: "safety",
  // Heat/cool
  heating_duct: "heatCool",
  ducted_heating_unit: "heatCool",
  heat_cool_duct: "heatCool",
  rev_cycle_unit: "heatCool",
  thermostat: "heatCool",
  return_air: "heatCool",
  evap_cooling_duct: "heatCool",
  evap_cooling_unit: "heatCool",
  ac_condenser: "heatCool",
  ac_head_unit: "heatCool",
  cooling_unit: "heatCool",
  // Ducted vacuum
  vacuum_unit: "ductedVacuum",
  vacuum_outlet: "ductedVacuum",
};

export interface Point {
  x: number;
  y: number;
}

// A wall segment in real-world metres, plan-local coordinate space.
export interface WallSegment {
  id: string;
  start: Point;
  end: Point;
}

export interface ScaleCalibration {
  pointA: Point;
  pointB: Point;
  realDistanceMetres: number;
}

export type GpoVariant = "standard" | "external" | "dishwasher" | "microwave";

export interface FittingSpecs {
  beamAngle?: number;
  mountingHeight?: number;
  wattage?: number;
  // Single/double — shared by GPO, para flood, and 1200mm fluoro (same
  // single-vs-double glyph convention across all three).
  count?: 1 | 2;
  gpoVariant?: GpoVariant;
  downlightSizeMm?: 50 | 70 | 90;
  // A switch plate's independent gangs — each gang is its own ordered
  // loop-in chain (switch -> target[0] -> target[1] -> ...), e.g. one
  // 2-gang plate where gang 1 runs 4 downlights and gang 2 runs a separate
  // exhaust fan. Replaces the old flat `linked_to` for switches, which
  // could only represent a single gang; `linked_to` is left in the schema
  // unused rather than migrated away, since JSONB specs can hold this
  // without a DB change.
  gangs?: string[][];
  locked?: boolean;
  // Degrees clockwise, 0-359. Wall-mounted types get this set automatically
  // on placement/drag so the symbol's body faces into the room rather than
  // into the wall cavity (see autoRotationForWallMount) — the rotate
  // control just lets the tradie override that guess when it's wrong.
  rotation?: number;
  // Once the tradie manually rotates a wall-mounted fitting, stop
  // auto-recomputing its facing on every drag — otherwise a manual fix
  // would just get overwritten the next time it's nudged.
  rotationLocked?: boolean;
}

export interface WallLock {
  wallId: string;
  distance: number;
}

// GPOs and switches lock to a single nearest wall (plus a mounting height) —
// that's how a tradie actually measures them on site. Everything else locks
// to its two nearest walls. See SINGLE_WALL_FITTING_TYPES.
export interface MeasurementLock {
  wallA: WallLock;
  wallB?: WallLock;
}

export const SINGLE_WALL_FITTING_TYPES: FittingType[] = [
  "gpo",
  "switch",
  "tv_point",
  "phone_point",
  "meter_box",
  "nbn_box",
  "ubo_rhood",
  "data",
  "wall_batten_holder",
  "wall_stair_light",
  "external_light",
  "thermostat",
  "ac_head_unit",
  "vacuum_outlet",
];

export function isSingleWallFitting(type: FittingType): boolean {
  return SINGLE_WALL_FITTING_TYPES.includes(type);
}

// A switch plate's gangs, defaulting to a single empty gang for a plain
// 1-gang switch that hasn't been linked to anything yet — every consumer
// (canvas rendering, the link panel, PDF export, the toggle mutation)
// should read gangs through this rather than touching specs.gangs raw, so
// "no gangs yet" and "one empty gang" are always treated the same way.
export function gangsFor(fitting: Pick<SetoutFitting, "specs">): string[][] {
  return fitting.specs.gangs && fitting.specs.gangs.length > 0 ? fitting.specs.gangs : [[]];
}

export type FittingStatus = "placed" | "confirmed";

export interface SetoutFitting {
  id: string;
  plan_id: string;
  type: FittingType;
  position: Point;
  category: FittingCategory;
  specs: FittingSpecs;
  measurement_lock: MeasurementLock | null;
  status: FittingStatus;
  circuit_id: string | null;
  linked_to: string[];
  created_at: string;
  updated_at: string;
}

export type PlanSourceType = "import" | "draw";

export interface LayerVisibility {
  lighting: boolean;
  power: boolean;
  switches: boolean;
  data: boolean;
  safety: boolean;
  heatCool: boolean;
  ductedVacuum: boolean;
  coverage: boolean;
  measurements: boolean;
}

export const DEFAULT_LAYER_VISIBILITY: LayerVisibility = {
  lighting: true,
  power: true,
  switches: true,
  data: true,
  safety: true,
  heatCool: true,
  ductedVacuum: true,
  coverage: false,
  measurements: true,
};

export const LAYER_LABELS: Record<keyof LayerVisibility, string> = {
  lighting: "Lighting",
  power: "Power",
  switches: "Switches",
  data: "Data",
  safety: "Safety",
  heatCool: "Heat/Cool",
  ductedVacuum: "Ducted vacuum",
  coverage: "Coverage overlay",
  measurements: "Measurements",
};

export interface SetoutPlan {
  id: string;
  user_id: string;
  name: string;
  job_reference: string | null;
  source_type: PlanSourceType;
  scale_calibration: ScaleCalibration | null;
  walls: WallSegment[];
  layer_visibility: LayerVisibility;
  created_at: string;
  updated_at: string;
}

// Display order for category-grouped UI (fitting picker dropdown, PDF
// legend) — mirrors the reference sheet's grouping (Lighting, Heat/Cool,
// Power, Ducted Vacuum) with Switches/Data/Safety, which this app tracks
// as their own categories, slotted in alongside.
export const FITTING_CATEGORY_ORDER: FittingCategory[] = ["lighting", "switches", "power", "data", "safety", "heatCool", "ductedVacuum"];

export interface SetoutCircuit {
  id: string;
  plan_id: string;
  label: string;
  description: string | null;
  breaker_rating: string | null;
  created_at: string;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
