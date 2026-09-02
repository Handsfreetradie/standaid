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
  switchboard: "power",
  // Data
  data: "data",
  data_cabinet: "data",
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
  kind: "door" | "window" | "sliding_door";
  // Doors only — the leaf swings into the room by default (the common
  // case); flip it to swing out instead (e.g. an external door for fire
  // egress, or wherever the default guess was wrong). Ignored for windows
  // and sliding doors.
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
  // A data outlet's cabinet (patch panel) it home-runs back to. Unlike a
  // switch's gangs, data cabling is always one home run per point — no
  // loop-in, no N-way — so this is a plain one-to-many reference (many
  // points, one id each) rather than an ordered chain the cabinet itself
  // owns.
  dataCabinetId?: string | null;
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

export interface OpeningRef {
  kind: "opening";
  openingId: string;
  distance: number;
  // Which edge of the opening: "start" (near wall.start) or "end" (near wall.end)
  edge: "start" | "end";
}

export type MeasurementRef = WallRef | FittingRef | OpeningRef;

// GPOs and switches lock to a single nearest wall (plus a mounting height) —
// that's how a tradie actually measures them on site. Everything else locks
// to its two nearest walls. See SINGLE_WALL_FITTING_TYPES. Auto-derivation
// (computeMeasurementLock) always produces wall refs — a tradie's laser
// reading is naturally wall-to-fitting — but either slot can be re-pointed
// at a fitting afterward instead.
export interface MeasurementLock {
  refA: MeasurementRef;
  refB?: MeasurementRef;
  note?: string; // Optional user note about where this measurement was taken
}

export const SINGLE_WALL_FITTING_TYPES: FittingType[] = [
  "gpo",
  "switch",
  "tv_point",
  "phone_point",
  "meter_box",
  "nbn_box",
  "ubo_rhood",
  "switchboard",
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

// Groups every gang and light into its wired-together "run" — a connected
// component over the gang<->light bipartite graph. The node for a gang is
// keyed by (switch id, gang index), never the switch alone — a 2-gang
// plate's two gangs are unrelated circuits (e.g. downlights on gang 1, an
// exhaust fan on gang 2) that must NOT merge into one run just because
// they share a physical plate; only an actually-shared light connects two
// gangs (from the same or different switches). Two switches also don't
// need to share the exact same light directly to be part of one
// 3-way/4-way run: switch A - light1, switch B - light1 & light2, switch C
// - light2 is still one continuous run touching 3 switches, even though no
// single light in it is directly linked from all 3.
function gangNodeId(switchId: string, gangIndex: number): string {
  return `${switchId}::gang${gangIndex}`;
}

function computeRunGroups(switches: Pick<SetoutFitting, "id" | "specs">[]): {
  groups: Map<string, Set<string>>;
  switchOfGangNode: Map<string, string>;
} {
  const adjacency = new Map<string, Set<string>>();
  const switchOfGangNode = new Map<string, string>();
  const connect = (a: string, b: string) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  };
  for (const sw of switches) {
    gangsFor(sw).forEach((gang, gangIndex) => {
      const node = gangNodeId(sw.id, gangIndex);
      switchOfGangNode.set(node, sw.id);
      for (const lightId of gang) connect(node, lightId);
    });
  }
  const groups = new Map<string, Set<string>>();
  const visited = new Set<string>();
  for (const start of adjacency.keys()) {
    if (visited.has(start)) continue;
    const group = new Set<string>();
    const stack = [start];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (group.has(current)) continue;
      group.add(current);
      visited.add(current);
      for (const next of adjacency.get(current) ?? []) stack.push(next);
    }
    for (const id of group) groups.set(id, group);
  }
  return { groups, switchOfGangNode };
}

// How many switches are wired into the same run as a light — the "N-way"
// count a tradie would mark on a real plan. Follows the whole connected
// run (see computeRunGroups), not just direct links, so an indirect chain
// still reads as one 3-way rather than two separate 2-ways — but never
// crosses into an unrelated gang on the same switch plate. Single source
// of truth for the canvas connector labels, SwitchLinksPanel's badges, and
// the PDF cable-run list.
export function wayCountForTarget(targetId: string, switches: Pick<SetoutFitting, "id" | "specs">[]): number {
  const { groups, switchOfGangNode } = computeRunGroups(switches);
  const group = groups.get(targetId);
  if (!group) return 0;
  const switchIds = new Set<string>();
  for (const nodeId of group) {
    const switchId = switchOfGangNode.get(nodeId);
    if (switchId) switchIds.add(switchId);
  }
  return switchIds.size;
}

// Every other switch/light fitting id in the same run as `id` (id's own
// fitting included) — used to highlight a whole 2-way/3-way/4-way run
// together the moment any one member is selected. `id` can be a light's id
// (unambiguous — a light only ever belongs to one run) or a switch's id;
// for a switch, pass `gangIndex` too so only that specific gang's run
// lights up rather than every unrelated gang on the same plate.
export function runGroupFittingIds(
  id: string,
  switches: Pick<SetoutFitting, "id" | "specs">[],
  gangIndex?: number
): Set<string> {
  const { groups, switchOfGangNode } = computeRunGroups(switches);
  const isSwitch = switches.some((s) => s.id === id);
  const startNode = isSwitch ? gangNodeId(id, gangIndex ?? 0) : id;
  const group = groups.get(startNode);
  if (!group) return new Set(isSwitch ? [id] : []);
  const fittingIds = new Set<string>();
  for (const nodeId of group) {
    const switchId = switchOfGangNode.get(nodeId);
    fittingIds.add(switchId ?? nodeId);
  }
  return fittingIds;
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

// A pin dropped on the plan marking where a site photo was taken from —
// e.g. what was behind a wall before it got sheeted. Not an electrical
// fitting (no category/specs/circuit), so it's its own table rather than
// riding on SetoutFitting.
export interface SetoutPhotoPoint {
  id: string;
  plan_id: string;
  position: Point;
  storage_path: string;
  // Degrees clockwise from plan "up" — the direction the tradie was facing
  // when they took the photo. Null until set.
  direction_degrees: number | null;
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
  photoPoints: boolean;
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
  photoPoints: true,
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
  photoPoints: "Photo points",
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
  exterior: 0.03, // 30mm — clean, thin line for the plan
  interior: 0.015, // 15mm — clean, thin line for the plan
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
