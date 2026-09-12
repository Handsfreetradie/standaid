import type { FittingType } from "@/components/setout/symbols";

export type FittingCategory = "lighting" | "power" | "switches" | "data" | "safety" | "heatCool" | "network";

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
  led_strip: "lighting",
  // Switches
  switch: "switches",
  cooktop_isolator: "switches",
  // Power
  gpo: "power",
  gpo_switch_combo: "power",
  tv_point: "power",
  phone_point: "power",
  meter_box: "power",
  nbn_box: "power",
  ubo_rhood: "power",
  switchboard: "power",
  cooktop: "power",
  oven: "power",
  hot_water_unit: "power",
  spa_pool_heater: "power",
  other_appliance: "power",
  solar_inverter: "power",
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
  heated_towel_rail: "heatCool",
  underfloor_heating_stat: "heatCool",
  // Network
  wifi_ap: "network",
};

export interface Point {
  x: number;
  y: number;
}

// A point in a tapped-out chain (wall trace, LED-strip run) that may carry a
// curve control point for the segment ARRIVING at it from the previous
// point. Absent = a plain straight segment, matching every point saved
// before curve mode existed — old data needs no migration.
export interface PathPoint extends Point {
  curveControl?: Point;
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
  // Quadratic Bézier control point (start -> curveControl -> end). Absent
  // means straight, so every wall saved before curve mode existed keeps
  // rendering/measuring exactly as before.
  curveControl?: Point;
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
  // single-vs-double glyph convention across all three). GPO also comes as a
  // 4-gang plate; para flood and 1200mm fluoro do not, so the palette offers
  // 4 only for GPO rather than this type being narrowed per fitting.
  count?: 1 | 2 | 4;
  gpoVariant?: GpoVariant;
  // A GPO's current rating — absent means the standard 10 A. 32 A is
  // available for either single- or three-phase (threePhase distinguishes
  // them); 15 A/20 A are always single-phase in practice, so threePhase is
  // only meaningful alongside 32.
  ratingAmps?: 15 | 20 | 32;
  threePhase?: boolean;
  // 100mm is the older-style "can" downlight (bigger halogen-format housing)
  // vs the slimmer modern LED sizes below it.
  downlightSizeMm?: 50 | 70 | 90 | 100;
  // Outlets on one data plate. A plate's outlets all home-run back to the
  // same cabinet — one comms cabinet per house is the norm — so this is a
  // count beside the single dataCabinetId below, not an outlet-by-outlet
  // mapping. What it changes is how many cables the run list orders.
  ports?: 1 | 2 | 3 | 4 | 5 | 6;
  // Two lamps in one downlight fixture, at a set centre-to-centre spacing.
  // Seeded from the plan's default when placed (see SetoutPlan.defaults) and
  // then owned by the fitting, so changing the plan default later doesn't
  // silently move downlights the tradie has already set out.
  twin?: boolean;
  twinSpacingMm?: number;
  // A switch plate's independent gangs — each gang is its own ordered
  // loop-in chain (switch -> target[0] -> target[1] -> ...), e.g. one
  // 2-gang plate where gang 1 runs 4 downlights and gang 2 runs a separate
  // exhaust fan. Replaces the old flat `linked_to` for switches, which
  // could only represent a single gang; `linked_to` is left in the schema
  // unused rather than migrated away, since JSONB specs can hold this
  // without a DB change.
  gangs?: string[][];
  // Indices into `gangs` that are dimmers rather than a plain switch — kept
  // as a parallel array of indices (not a field on each gang) since gangs
  // itself is a plain string[][] with no per-gang metadata slot. A standard
  // (rotary/slide) dimmer mechanism is physically wider than a plain switch
  // and takes an extra position on the plate; a push-button dimmer doesn't —
  // it's the same size as an ordinary switch mech. pushButtonDimmerGangs is
  // the subset of dimmerGangs that are the push-button style — see
  // switchMaterials in setoutMaterials.ts for how that split is reflected in
  // the order list.
  dimmerGangs?: number[];
  pushButtonDimmerGangs?: number[];
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
  // An LED strip is drawn as a run rather than dropped as a point, so it
  // carries a polyline (plan-local metres) that can turn corners. Kept in
  // specs rather than a new column because specs is JSONB — the same reason
  // `gangs` lives here. `position` stays in step with path[0] so every
  // existing position-based feature (measurements, selection, circuits,
  // switch links) keeps working on a strip with no special-casing.
  path?: PathPoint[];
  ledWattsPerMetre?: number;
  ledProfile?: string;
  // Stock length the extrusion is bought in, which decides how many lengths
  // the takeoff orders. Suppliers differ, so it's the tradie's to set.
  ledExtrusionStockLengthM?: number;
  ledColourTempK?: number;
  // Indicative WiFi coverage radius, in metres, drawn as a circle the same
  // way lightPoolRadius draws a downlight's — NOT a real RF survey. Real
  // range depends heavily on wall construction (a wall or two of brick/
  // masonry cuts it hard; several stud/plasterboard walls barely touch it),
  // interference, and the AP's own hardware, so this is a rough "will this
  // reach that far room" guide only, and must always read as one.
  wifiRangeM?: number;
  // A placed appliance's connected load, set on the symbol itself so Maximum
  // Demand can count it automatically instead of needing a duplicate manual
  // "Other loads" entry — see APPLIANCE_LOAD_GROUP_BY_TYPE in
  // setoutMaximumDemand.ts. Used by cooktop/other_appliance/heated_towel_rail/
  // underfloor_heating_stat directly, and by hot_water_unit alongside
  // waterHeaterType below (which AS3000 group it counts under depends on
  // that).
  ratingW?: number;
  // hot_water_unit only — "storage" (a tank, AS3000 Table C1 group (f), 100%
  // diversity) vs "instantaneous" (group (e), 1/3 diversity). Defaults to
  // storage when unset, since that's the more common Australian residential
  // case and this symbol's own label ("Hot water system") reads as one.
  waterHeaterType?: "instantaneous" | "storage";
  // Solar inverter (solar_inverter fitting only) — the AC output circuit's
  // own rating/cable, checked against AS/NZS 4777.1's 2% voltage-rise limit
  // in setoutSolarVoltageRise.ts. Cable run length is NOT stored here — it's
  // measured live from this fitting's position to the nearest switchboard
  // (see MaximumDemandPanel.tsx), so it stays correct if either is moved.
  inverterOutputAmps?: number;
  inverterSystemType?: "ac" | "dc";
  inverterPhase?: "single" | "three";
  inverterCableMaterial?: "copper" | "aluminium";
  inverterCableCsaMm2?: string;
}

// Centre-to-centre spacing for a twin downlight when the plan has no default
// set — a common batten-fix spacing, and the tradie can change it per plan or
// per fitting.
export const DEFAULT_TWIN_SPACING_MM = 300;

// A practical middle ground for one AP through typical Australian home
// construction — comfortably inside range through several stud/plasterboard
// walls, but already generous for masonry (1-2 brick walls kills a link
// regardless of this number). Deliberately conservative rather than the
// open-plan best case; the tradie adjusts per AP for their build.
export const DEFAULT_WIFI_RANGE_M = 10;

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

// A measurement taken off a line printed on the imported plan rather than a
// traced wall — the case where tracing was skipped and the drawing itself is
// the only reference there is.
//
// Stores the geometry rather than an id, unlike every other ref here. The id
// indirection exists so a measurement survives its wall being edited; a line
// on an imported drawing has no id to point at and cannot move, so freezing
// the point it was taken to is both simpler and safe. `point` is the face
// measured to, in scene units.
export interface StrokeRef {
  kind: "stroke";
  point: Point;
  // Unit direction of the line this was measured to. Kept so the measurement
  // can be re-taken square to the SAME line after the fitting moves — without
  // it, only the point survives and there is no way to tell which way the line
  // ran, so a move could only start again from scratch.
  dirX: number;
  dirY: number;
  distance: number;
}

export type MeasurementRef = WallRef | FittingRef | OpeningRef | StrokeRef;

/**
 * The id of whatever a measurement points at, whichever kind it is.
 *
 * Reading `.fittingId` after only ruling out `"wall"` is a type error, because
 * an opening ref has no such field — it was reached in three places and would
 * have produced `undefined` at runtime rather than an opening's id.
 */
export function measurementRefId(ref: MeasurementRef): string {
  switch (ref.kind) {
    case "wall":
      return ref.wallId;
    case "fitting":
      return ref.fittingId;
    case "opening":
      return ref.openingId;
    case "stroke":
      // No id to give: a line on the drawing is identified by where it is.
      return `${ref.point.x.toFixed(4)},${ref.point.y.toFixed(4)}`;
  }
}

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
  // Set once the tradie has chosen what this measures to. Auto-derivation
  // picks the nearest walls, which is a fine starting point but a guess; once
  // they've said otherwise, moving the fitting re-measures against THEIR
  // reference rather than silently reverting to the nearest thing.
  userSet?: boolean;
}

export const SINGLE_WALL_FITTING_TYPES: FittingType[] = [
  "gpo",
  "gpo_switch_combo",
  "switch",
  "cooktop_isolator",
  "tv_point",
  "phone_point",
  "meter_box",
  "nbn_box",
  "ubo_rhood",
  "switchboard",
  "cooktop",
  "oven",
  "hot_water_unit",
  "spa_pool_heater",
  "other_appliance",
  "solar_inverter",
  "data",
  "data_cabinet",
  "wall_batten_holder",
  "wall_stair_light",
  "external_light",
  "thermostat",
  "ac_head_unit",
  "heated_towel_rail",
  "underfloor_heating_stat",
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
    const count = specs.count ?? 1;
    // Only a GPO comes as a 4-gang plate. Clamping here means a fitting that
    // was switched from GPO to one of the other two can't render a glyph that
    // doesn't exist for it.
    if (type === "gpo") return { count, variant: specs.gpoVariant ?? "standard" };
    return { count: count === 4 ? 2 : count };
  }
  if (type === "downlight") {
    return { sizeMm: specs.downlightSizeMm ?? 90, twin: specs.twin ?? false };
  }
  if (type === "data") return { ports: specs.ports ?? 1 };
  if (type === "switch") return { gangCount: Math.min(4, gangsFor(fitting).length), hasDimmer: (specs.dimmerGangs?.length ?? 0) > 0 };
  return {};
}

export type FittingStatus = "placed" | "confirmed";

export interface SetoutFitting {
  id: string;
  plan_id: string;
  canvas_id: string;
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
export type PhotoPointType = "flat" | "360";

export interface SetoutPhotoPoint {
  id: string;
  plan_id: string;
  canvas_id: string;
  position: Point;
  storage_path: string;
  // Degrees clockwise from plan "up" — the direction the tradie was facing
  // when they took the photo. Null until set.
  direction_degrees: number | null;
  // "360" is always an uploaded file, never a live capture — there's no way
  // for a website to trigger a phone's native panorama/photo-sphere capture
  // mode, so a genuine 360 photo has to be shot in the phone's own camera
  // app first. See PhotoPointDialog for the two different viewers this
  // drives.
  photo_type: PhotoPointType;
  created_at: string;
  updated_at: string;
}

// Gallery of photos at a single location (grouped by position)
export interface SetoutPhotoGallery {
  position: Point;
  photos: SetoutPhotoPoint[];
}

export type VoiceNoteStatus = "pending" | "transcribing" | "done" | "failed";

// A spoken note recorded during a customer walkthrough — general narration
// about the job, not pinned to a spot on the plan (unlike a photo point), so
// it carries no `position`. Transcribed server-side via Deepgram — see
// supabase/functions/transcribe-setout-voice-note.
export interface SetoutVoiceNote {
  id: string;
  plan_id: string;
  storage_path: string;
  content_type: string;
  duration_seconds: number | null;
  transcript: string | null;
  status: VoiceNoteStatus;
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
  network: boolean;
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
  network: true,
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
  network: "Network",
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

// Job-wide starting values the tradie sets once rather than re-entering on
// every fitting. Deliberately only the seed: a fitting copies the value it
// needs when it's placed, so changing a default later never moves anything
// that's already been set out.
export interface PlanDefaults {
  // Floor-to-ceiling height for this job, in metres — a downlight sits flush
  // in the ceiling, so this doubles as its mounting height and is what the
  // coverage-pool radius is actually worked out from (see lightPoolRadius).
  // Only 2.4m by coincidence of being the most common residential ceiling;
  // wrong for anything raked, commercial, or just a different build.
  ceilingHeightM?: number;
  twinDownlightSpacingMm?: number;
  ledWattsPerMetre?: number;
  ledProfile?: string;
  ledExtrusionStockLengthM?: number;
  // The driver sizes this tradie actually stocks, and how much headroom they
  // size one with. Job-wide: they apply to every strip on the plan at takeoff
  // time, so changing them re-sizes what's already drawn.
  ledDriverSizesW?: number[];
  ledDriverHeadroomPct?: number;
  // Whether this job's incoming supply is single-phase (230V) or three-phase
  // (400V line) — changes how Maximum Demand's total current is worked out
  // (see calculateMaximumDemand in setoutMaximumDemand.ts). Defaults to
  // single-phase, the common residential case.
  supplyPhase?: "single" | "three";
}

export interface SetoutPlan {
  id: string;
  user_id: string;
  name: string;
  job_reference: string | null;
  // Job-wide settings only from here on — every per-drawing-surface field
  // (walls, openings, scale, background image, etc.) now lives on
  // SetoutCanvas instead, one row per floor/area within this job. The
  // columns below still exist on the DB row for old data (deliberately not
  // dropped in the canvases migration) but are unused going forward — don't
  // read plan.walls/openings/scale_calibration/etc, read the active
  // SetoutCanvas's fields instead.
  source_type: PlanSourceType;
  scale_calibration: ScaleCalibration | null;
  walls: WallSegment[];
  openings: WallOpening[];
  layer_visibility: LayerVisibility;
  wall_thickness: WallThickness;
  background_image_path: string | null;
  source_file_path?: string | null;
  source_file_content_type?: string | null;
  background_image_content_type: string | null;
  // Optional so a plan row saved before this column existed still satisfies
  // the type — every read goes through `plan.plan_defaults?.x ?? fallback`.
  plan_defaults?: PlanDefaults;
  created_at: string;
  updated_at: string;
}

// One drawable surface within a job — a floor, or an area that isn't on the
// house plan at all (e.g. outdoor lighting). A job (SetoutPlan) holds one or
// more of these; everything that's specific to a single drawing (walls,
// openings, scale, background image, wall thickness, layer visibility) lives
// here rather than on SetoutPlan, so a job can have as many as it needs.
// Circuits, load items, and voice notes stay plan_id-scoped (shared across
// every canvas in the job) — only fittings and photo points are pinned to
// one canvas, via their own canvas_id.
export interface SetoutCanvas {
  id: string;
  plan_id: string;
  name: string;
  // Tab order — assigned by creation order, not user-reorderable (yet).
  sort_order: number;
  source_type: PlanSourceType;
  scale_calibration: ScaleCalibration | null;
  walls: WallSegment[];
  openings: WallOpening[];
  wall_thickness: WallThickness;
  layer_visibility: LayerVisibility;
  background_image_path: string | null;
  background_image_content_type: string | null;
  source_file_path?: string | null;
  source_file_content_type?: string | null;
  created_at: string;
  updated_at: string;
}

// Display order for category-grouped UI (fitting picker dropdown, PDF
// legend) — mirrors the reference sheet's grouping (Lighting, Heat/Cool,
// Power, Ducted Vacuum) with Switches/Data/Safety, which this app tracks
// as their own categories, slotted in alongside.
export const FITTING_CATEGORY_ORDER: FittingCategory[] = ["lighting", "switches", "power", "data", "safety", "heatCool", "network"];

// "standard" covers everything the app already handled (lighting/power/etc
// circuits via breaker_rating). "solar" is the first circuit type that needs
// its own extra fields (see CircuitSpecs) — kept as an open string union
// rather than a DB enum so a future type (e.g. EV charging, flagged as
// likely in setoutMaximumDemand.ts's own comments) is just a new TS variant,
// no migration.
export type CircuitType = "standard" | "solar";

export interface CircuitSpecs {
  // Solar (circuit_type "solar") — enough to run a voltage-rise check per
  // AS/NZS 4777.1 against AS/NZS 3008.1.1 cable figures. cableCsaMm2 uses
  // the same size-string convention as the Trade Tools cable data
  // (src/components/tools/electricalData.ts), e.g. "6", "10".
  inverterOutputAmps?: number;
  inverterRatedKw?: number;
  cableRunLengthM?: number; // one-way run, inverter to point of connection
  cableCsaMm2?: string;
  cableMaterial?: "copper" | "aluminium";
  systemType?: "ac" | "dc"; // AC inverter-output run vs DC string run
  phase?: "single" | "three";
  // Which of the three physical supply lines (A/B/C) this circuit is landed
  // on, for a three-phase job — distinct from the solar `phase` field above
  // (that's the inverter's OWN output circuit's phase, not which of the
  // three incoming lines it's balanced onto). Settable per circuit, and
  // pre-filled by recommendPhaseSplit in setoutPhaseBalance.ts.
  boardPhase?: "A" | "B" | "C";
}

export interface SetoutCircuit {
  id: string;
  plan_id: string;
  label: string;
  description: string | null;
  breaker_rating: string | null;
  // Display order on the switchboard legend — user-arranged, not tied to
  // creation order. See useReorderSetoutCircuit in useSetoutCircuits.ts.
  sort_order: number;
  circuit_type: CircuitType;
  specs: CircuitSpecs;
  created_at: string;
}

// A load that counts toward Maximum Demand but isn't placed as a canvas
// symbol — hot water, oven, hotplate, ducted aircon, EV charger, etc. See
// setoutMaximumDemand.ts for the load_group keys and how each is calculated.
export interface SetoutLoadItem {
  id: string;
  plan_id: string;
  label: string;
  load_group: string;
  rating_w: number;
  quantity: number;
  circuit_id: string | null;
  created_at: string;
}

// Circuits have no stored colour (no DB column for it) — instead each
// circuit gets a stable colour derived from its position in the plan's
// circuit list. Every consumer (canvas icons, circuit legend, PDF export)
// calls this rather than picking colours independently, so a fitting always
// matches its circuit's swatch.
//
// Ordered for maximum contrast between NEIGHBOURING circuits — circuit 1 and
// circuit 2 are the pair most likely to sit side by side on a plan, so they
// need to look nothing alike. A plain hue-wheel rotation (the previous
// order) puts near-identical neighbours right next to each other by
// construction; this reorders the same 20 colours so consecutive entries
// jump across the wheel instead, which matters most at the small size a
// fitting icon prints at in the PDF export.
const CIRCUIT_COLOR_PALETTE = [
  "#dc2626", // red
  "#2563eb", // blue
  "#16a34a", // green
  "#ea580c", // orange
  "#7c3aed", // violet
  "#0d9488", // teal
  "#db2777", // pink
  "#ca8a04", // gold
  "#4f46e5", // indigo
  "#0891b2", // cyan
  "#9333ea", // purple
  "#65a30d", // lime
  "#e11d48", // rose
  "#1e3a8a", // navy
  "#c026d3", // fuchsia
  "#0284c7", // sky
  "#14532d", // forest
  "#7f1d1d", // maroon
  "#d97706", // amber
  "#059669", // emerald
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
