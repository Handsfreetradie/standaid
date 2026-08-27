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
  // Absent/undefined means "exterior" — every wall created before this field
  // existed (the single-perimeter trace/draw flows) is exterior, so this
  // keeps old saved plans rendering and measuring exactly as before.
  kind?: "exterior" | "interior";
}

// A door or window cut into a wall, parametric against that wall (robust to
// the wall being nudged later) — same convention as MeasurementLock's
// {wallId, distance}, rather than storing raw coordinates that would drift
// out of sync if the wall ever moved.
export interface WallOpening {
  id: string;
  wallId: string;
  offset: number; // metres from wall.start to the opening's near edge
  width: number; // metres
  kind: "door" | "window";
  // Doors only — the leaf swings into the room by default (the common
  // case); flip it to swing out instead (e.g. an external door for fire
  // egress, or wherever the default guess was wrong). Ignored for windows.
  swingFlipped?: boolean;
}

export interface ScaleCalibration {
  pointA: Point;
  pointB: Point;
  realDistanceMetres: number;
}

export type GpoVariant = "standard" | "external";

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

export interface WallRef {
  kind: "wall";
  wallId: string;
  distance: number;
}

// A measurement can also be taken off another fitting instead of a wall
// (e.g. "this downlight is 1.2m from that one") — genuinely useful on site
// where a wall isn't the most practical reference, and necessary once the
// tradie can re-point a measurement at anything on the plan (see the
// tap-to-pick flow in SetoutCanvas.tsx/FittingPalette.tsx).
export interface FittingRef {
  kind: "fitting";
  fittingId: string;
  distance: number;
}

export type MeasurementRef = WallRef | FittingRef;

// GPOs and switches lock to a single nearest wall (plus a mounting height) —
// that's how a tradie actually measures them on site. Everything else locks
// to its two nearest walls. See SINGLE_WALL_FITTING_TYPES. Auto-derivation
// (computeMeasurementLock) always produces wall refs — a tradie's laser
// reading is naturally wall-to-fitting — but either slot can be re-pointed
// at a fitting afterward instead.
export interface MeasurementLock {
  refA: MeasurementRef;
  refB?: MeasurementRef;
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

// GPO/para-flood/1200-fluoro carry a `count` spec and GPO also a `variant`;
// downlight carries `downlightSizeMm`; switch derives `gangCount` from its
// gangs. The shared FITTING_SYMBOLS map (symbols/fittingSymbolMap.ts) is
// typed to the common SetoutSymbolProps only, so these per-type extras are
// resolved here as a single source of truth — both the on-screen canvas
// (SetoutCanvas.tsx) and the PDF export (setoutReport.ts) call this rather
// than each keeping their own copy of this switch statement.
export function symbolExtraPropsFor(fitting: Pick<SetoutFitting, "type" | "specs">): Record<string, unknown> {
  const { type, specs } = fitting;
  if (type === "gpo" || type === "para_flood" || type === "fluoro_1200") {
    return { count: specs.count ?? 1, ...(type === "gpo" ? { variant: specs.gpoVariant ?? "standard" } : {}) };
  }
  if (type === "downlight") return { sizeMm: specs.downlightSizeMm ?? 90 };
  if (type === "switch") return { gangCount: Math.min(4, gangsFor(fitting).length) };
  return {};
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

// Real-world wall thickness (metres), one value per wall kind rather than
// per individual wall — exterior and interior walls are typically very
// different builds (e.g. 230mm brick veneer vs 90mm timber stud), but
// walls of the same kind on the one plan are almost always the same
// construction, so a per-wall control would be precision the tradie can't
// actually use. Drives both the on-screen line width (SetoutCanvas.tsx)
// and the PDF export (setoutReport.ts) — same value, same source.
export interface WallThickness {
  exterior: number;
  interior: number;
}

export const DEFAULT_WALL_THICKNESS: WallThickness = {
  exterior: 0.23, // 230mm brick veneer — the common AU external wall
  interior: 0.11, // 90mm stud + plasterboard both sides — the common AU internal wall
};

export interface SetoutPlan {
  id: string;
  user_id: string;
  name: string;
  job_reference: string | null;
  source_type: PlanSourceType;
  scale_calibration: ScaleCalibration | null;
  walls: WallSegment[];
  openings: WallOpening[];
  layer_visibility: LayerVisibility;
  wall_thickness: WallThickness;
  background_image_path: string | null;
  background_image_content_type: string | null;
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

// Circuits have no stored colour (no DB column for it) — instead each
// circuit gets a stable colour derived from its position in the plan's
// circuit list, which is itself stably ordered by created_at. Every
// consumer (canvas icons, circuit legend) calls this rather than picking
// colours independently, so a fitting always matches its circuit's swatch.
const CIRCUIT_COLOR_PALETTE = [
  "#dc2626", // red
  "#ea580c", // orange
  "#d97706", // amber
  "#ca8a04", // yellow
  "#65a30d", // lime
  "#16a34a", // green
  "#059669", // emerald
  "#0d9488", // teal
  "#0891b2", // cyan
  "#0284c7", // sky
  "#2563eb", // blue
  "#4f46e5", // indigo
  "#7c3aed", // violet
  "#9333ea", // purple
  "#c026d3", // fuchsia
  "#db2777", // pink
  "#e11d48", // rose
  "#7f1d1d", // maroon
  "#1e3a8a", // navy
  "#14532d", // forest
];

export function colorForCircuit(circuits: Pick<SetoutCircuit, "id">[], circuitId: string | null | undefined): string | null {
  if (!circuitId) return null;
  const index = circuits.findIndex((c) => c.id === circuitId);
  if (index === -1) return null;
  return CIRCUIT_COLOR_PALETTE[index % CIRCUIT_COLOR_PALETTE.length];
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
