// Materials takeoff engine: turns the fittings on a plan into an order list.
//
// Two different kinds of input drive a line item:
//  1. Specs on the fitting itself (a GPO's gang count, a switch's plate
//     size, a downlight's diameter, an LED run's length) — these are
//     computed here, not looked up, because the quantity genuinely depends
//     on what the tradie set on that fitting.
//  2. Everything else comes from BASE_MATERIALS_BY_TYPE below, a flat
//     starting-point list per fitting type. That table is trade knowledge,
//     not geometry, so it's kept as one plain object the electrician can
//     correct directly rather than buried in per-type logic.
//
// Cable metres and conduit are deliberately NOT produced here — that's a
// whole-plan calculation (run lengths between fittings) owned elsewhere;
// this file only knows about a single fitting's own hardware.
import {
  CATEGORY_FOR_TYPE,
  LAYER_LABELS,
  distance,
  gangsFor,
  type FittingSpecs,
  type SetoutFitting,
} from "./setoutTypes";
import type { FittingType } from "@/components/setout/symbols";

export interface MaterialLine {
  item: string; // e.g. "GPO mech, double" / "LED extrusion, 2m length"
  qty: number;
  unit: "ea" | "m";
  group: string; // grouping heading for the report, e.g. "Lighting", "Power", "Data", "LED", "Accessories"
}

// Extrusion comes in fixed lengths off the shelf and suppliers vary, so the
// stock length is set by the tradie — per strip, seeded from the job default
// (see PlanDefaults). This is only the fallback for a strip drawn before
// either was set. Watts per metre works the same way.
export const DEFAULT_EXTRUSION_STOCK_LENGTH_M = 2;
export const DEFAULT_LED_WATTS_PER_METRE = 14;
export const DEFAULT_DRIVER_HEADROOM_PCT = 20;

// What the tradie buys on THIS job: the extrusion length off the shelf, the
// driver sizes they stock, and how much headroom they size a driver with.
// Passed in at takeoff time rather than copied onto each strip when it's
// drawn — these are job-wide, so changing one has to change every strip
// already on the plan, which a copy stamped on the fitting would not.
export interface MaterialsJobSettings {
  extrusionStockLengthM?: number;
  driverSizesW?: number[];
  driverHeadroomPct?: number;
}

// Common AU constant-voltage driver wattages. Picking from a fixed ladder
// instead of "exactly enough" means an off-the-shelf part actually exists
// at the size chosen. A run bigger than the largest rung splits across
// multiple of the largest driver rather than inventing a bigger size.
export const DEFAULT_DRIVER_SIZES_W = [30, 60, 100, 150, 200];

// Sizes are the tradie's own list, so they can't be trusted to arrive sorted,
// positive, or non-empty — a bad list would otherwise pick a nonsense driver
// or divide by zero.
function usableDriverSizes(sizes: number[] | undefined): number[] {
  const clean = (sizes ?? []).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  return clean.length > 0 ? clean : DEFAULT_DRIVER_SIZES_W;
}

function pickDriver(totalWattsWithHeadroom: number, sizes: number[]): { sizeW: number; qty: number } {
  const maxSize = sizes[sizes.length - 1];
  if (totalWattsWithHeadroom <= maxSize) {
    const size = sizes.find((s) => s >= totalWattsWithHeadroom) ?? maxSize;
    return { sizeW: size, qty: 1 };
  }
  // Bigger than anything they carry: split across multiples of the largest
  // rather than inventing a size that can't be bought.
  return { sizeW: maxSize, qty: Math.ceil(totalWattsWithHeadroom / maxSize) };
}

// Sum of segment lengths along an LED run's path, in metres. Returns 0 for
// a missing/degenerate path (no run drawn yet, or a single stray point)
// rather than throwing — a plan mid-edit shouldn't crash the takeoff.
function ledStripLengthMetres(specs: FittingSpecs): number {
  const path = specs.path;
  if (!path || path.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < path.length; i++) total += distance(path[i - 1], path[i]);
  return total;
}

function ledStripMaterials(specs: FittingSpecs, job: MaterialsJobSettings): MaterialLine[] {
  const metres = ledStripLengthMetres(specs);
  if (metres <= 0) return [];

  const roundedMetres = Math.round(metres * 10) / 10; // nearest 100mm — plenty precise for an order
  const wattsPerMetre = specs.ledWattsPerMetre ?? DEFAULT_LED_WATTS_PER_METRE;
  const profile = specs.ledProfile ?? "surface";
  // A zero or missing stock length would divide to Infinity and order an
  // impossible number of lengths, so it falls back rather than trusting it.
  // A strip may override the job's stock length (one room run in a different
  // profile), otherwise the job setting decides.
  const stockLengthM =
    (specs.ledExtrusionStockLengthM && specs.ledExtrusionStockLengthM > 0 && specs.ledExtrusionStockLengthM) ||
    (job.extrusionStockLengthM && job.extrusionStockLengthM > 0 && job.extrusionStockLengthM) ||
    DEFAULT_EXTRUSION_STOCK_LENGTH_M;
  const stockLengths = Math.ceil(metres / stockLengthM);
  const headroom = 1 + (job.driverHeadroomPct ?? DEFAULT_DRIVER_HEADROOM_PCT) / 100;
  const clips = Math.ceil(metres / 0.5); // roughly 1 clip per 500mm
  const driver = pickDriver(metres * wattsPerMetre * headroom, usableDriverSizes(job.driverSizesW));
  const group = "LED";

  return [
    { item: `LED strip, ${roundedMetres}m`, qty: roundedMetres, unit: "m", group },
    { item: `LED extrusion (${profile}), ${stockLengthM}m length`, qty: stockLengths, unit: "ea", group },
    { item: `LED diffuser (${profile}), ${stockLengthM}m length`, qty: stockLengths, unit: "ea", group },
    { item: `LED end cap (${profile})`, qty: 2, unit: "ea", group },
    { item: `LED mounting clip (${profile})`, qty: clips, unit: "ea", group },
    { item: `LED driver, ${driver.sizeW}W constant-voltage`, qty: driver.qty, unit: "ea", group },
  ];
}

// A GPO plate's size name, keyed by mech count — "quad" covers the 4-gang
// case rather than inventing a "double-double" name.
const GPO_PLATE_SIZE_NAME: Record<number, string> = { 1: "single", 2: "double", 4: "quad" };

function gpoMaterials(specs: FittingSpecs): MaterialLine[] {
  const count = specs.count ?? 1;
  const sizeName = GPO_PLATE_SIZE_NAME[count] ?? "single";
  const plateItem = specs.gpoVariant === "external" ? `GPO plate, weatherproof (${sizeName})` : `GPO plate, ${sizeName}`;
  const group = groupFor("gpo");
  return [
    { item: plateItem, qty: 1, unit: "ea", group },
    { item: "GPO mech", qty: count, unit: "ea", group },
  ];
}

function dataMaterials(specs: FittingSpecs): MaterialLine[] {
  const ports = specs.ports ?? 1;
  const group = groupFor("data");
  return [
    { item: "Data plate", qty: 1, unit: "ea", group },
    { item: "RJ45 mech", qty: ports, unit: "ea", group },
    // Cable metres are the lead's job — this just counts the runs themselves.
    { item: "Data cable run", qty: ports, unit: "ea", group },
  ];
}

function switchMaterials(fitting: Pick<SetoutFitting, "type" | "specs">): MaterialLine[] {
  const gangCount = gangsFor(fitting).length;
  const group = groupFor("switch");
  return [
    { item: `Switch plate, ${gangCount}-gang`, qty: 1, unit: "ea", group },
    { item: "Switch mech", qty: gangCount, unit: "ea", group },
  ];
}

function downlightMaterials(specs: FittingSpecs): MaterialLine[] {
  const sizeMm = specs.downlightSizeMm ?? 90;
  const qty = specs.twin ? 2 : 1;
  return [{ item: `Downlight, ${sizeMm}mm`, qty, unit: "ea", group: groupFor("downlight") }];
}

// para_flood and fluoro_1200 also carry `count`, but there it means
// single-vs-double FITTING (two physical flood lights / one 1200 batten vs
// two side by side) — not a plate-plus-mechs GPO-style breakdown. Handled
// as their own thing per the spec note, so they don't get mistaken for a
// GPO's mech count.
function paraFloodMaterials(specs: FittingSpecs): MaterialLine[] {
  const qty = specs.count ?? 1;
  return [{ item: "Para flood light", qty, unit: "ea", group: groupFor("para_flood") }];
}

function fluoro1200Materials(specs: FittingSpecs): MaterialLine[] {
  const qty = specs.count ?? 1;
  const group = groupFor("fluoro_1200");
  return [
    { item: "1200mm fluoro batten", qty, unit: "ea", group },
    { item: "1200mm LED tube", qty, unit: "ea", group }, // TODO: confirm — assumes LED retrofit tube, not a fluorescent tube
  ];
}

// A fitting's report group, derived from the same category mapping the rest
// of the app already uses (CATEGORY_FOR_TYPE / LAYER_LABELS) — so the
// materials report always groups a fitting the same way its layer toggle
// and PDF legend do, rather than keeping a second copy of that mapping here.
function groupFor(type: FittingType): string {
  return LAYER_LABELS[CATEGORY_FOR_TYPE[type]];
}

// Types with their own spec-driven handling above — excluded from the flat
// table below because their quantities/names come from specs, not a fixed
// list. led_strip is handled purely by path length and never touches the
// table at all.
type SpecDrivenFittingType = "gpo" | "data" | "switch" | "downlight" | "para_flood" | "fluoro_1200" | "led_strip";
type TableFittingType = Exclude<FittingType, SpecDrivenFittingType>;

// A base material line without its group — the group is always derived via
// groupFor() when the line is read out, so every entry below only needs to
// say what gets ordered, not which report section it lands in.
type BaseLine = Omit<MaterialLine, "group">;

// ============================================================================
// BASE MATERIALS BY FITTING TYPE — starting point only.
//
// This is trade knowledge, not something worked out from geometry, so treat
// it as a first draft: Kyle, correct anything here that doesn't match how
// you actually order for a job. Entries marked `// TODO: confirm` are ones
// genuinely guessed at (unsure if the item is normally supplied by the
// sparky at all, unsure of the exact accessory, etc.) — check those first.
//
// Quantities that depend on a fitting's specs (GPO gang count, switch plate
// size, downlight size, LED run length) are NOT in this table — they're
// computed above. Everything here is a flat "1 of these per fitting"
// starting list.
// ============================================================================
export const BASE_MATERIALS_BY_TYPE: Record<TableFittingType, BaseLine[]> = {
  // Lighting
  batten_holder: [{ item: "Batten holder", qty: 1, unit: "ea" }],
  wall_batten_holder: [{ item: "Wall batten holder", qty: 1, unit: "ea" }],
  wall_stair_light: [{ item: "Wall stair light fitting", qty: 1, unit: "ea" }],
  external_light: [
    { item: "External light fitting, weatherproof", qty: 1, unit: "ea" }, // TODO: confirm — IP rating/style varies by fixture chosen
  ],
  heater_fan_light_2: [
    { item: "Heater/fan/light unit, 2-heat-lamp", qty: 1, unit: "ea" },
    { item: "Heat lamp globe", qty: 2, unit: "ea" }, // TODO: confirm — often supplied with the unit, not ordered separately
  ],
  heater_fan_light_4: [
    { item: "Heater/fan/light unit, 4-heat-lamp", qty: 1, unit: "ea" },
    { item: "Heat lamp globe", qty: 4, unit: "ea" }, // TODO: confirm — often supplied with the unit, not ordered separately
  ],
  junction_box: [{ item: "Junction box", qty: 1, unit: "ea" }],
  ceiling_fan: [
    { item: "Ceiling fan", qty: 1, unit: "ea" },
    { item: "Fan mounting bracket/brace", qty: 1, unit: "ea" }, // TODO: confirm — some fans include their own brace
  ],
  ceiling_fan_light: [
    { item: "Ceiling fan with light", qty: 1, unit: "ea" },
    { item: "Fan mounting bracket/brace", qty: 1, unit: "ea" }, // TODO: confirm — some fans include their own brace
  ],
  round_fluoro: [
    { item: "Round fluoro fitting", qty: 1, unit: "ea" },
    { item: "Round LED tube", qty: 1, unit: "ea" }, // TODO: confirm — assumes LED retrofit, not fluorescent
  ],
  motion_sensor: [{ item: "Motion sensor", qty: 1, unit: "ea" }],
  exhaust_fan: [{ item: "Exhaust fan", qty: 1, unit: "ea" }],
  exhaust_fan_light: [{ item: "Exhaust fan with light", qty: 1, unit: "ea" }],
  pendant: [{ item: "Pendant fitting", qty: 1, unit: "ea" }],

  // Switches — see switchMaterials for the actual switch type

  // Power
  tv_point: [
    { item: "TV point plate", qty: 1, unit: "ea" },
    { item: "TV/coax (F-type) mech", qty: 1, unit: "ea" },
  ],
  phone_point: [
    { item: "Phone point plate", qty: 1, unit: "ea" },
    { item: "RJ12 mech", qty: 1, unit: "ea" }, // TODO: confirm — some jobs run RJ45 for phone points now
  ],
  meter_box: [{ item: "Meter box enclosure", qty: 1, unit: "ea" }], // TODO: confirm — often supplied/installed by the DNSP, not ordered by the sparky
  nbn_box: [{ item: "NBN connection box (NTD)", qty: 1, unit: "ea" }], // TODO: confirm — supplied by NBN Co, sparky usually just provides conduit/power
  ubo_rhood: [{ item: "UBO/RHOOD enclosure", qty: 1, unit: "ea" }], // TODO: confirm — check local distributor requirements
  switchboard: [{ item: "Switchboard enclosure", qty: 1, unit: "ea" }], // TODO: confirm — pole count/size varies too much for a fixed list

  // Data
  data_cabinet: [{ item: "Data cabinet / patch panel enclosure", qty: 1, unit: "ea" }], // TODO: confirm — size/port count varies per job

  // Safety
  smoke_detector: [{ item: "Smoke alarm, interconnected", qty: 1, unit: "ea" }],

  // Heat/cool — sparky typically wires/isolates these rather than supplying
  // the mechanical equipment itself; flagged for Kyle to correct.
  heating_duct: [{ item: "Heating duct outlet", qty: 1, unit: "ea" }], // TODO: confirm — mechanical trade item
  ducted_heating_unit: [{ item: "Ducted heating unit", qty: 1, unit: "ea" }], // TODO: confirm — usually supplied by HVAC contractor
  heat_cool_duct: [{ item: "Heat/cool duct outlet", qty: 1, unit: "ea" }], // TODO: confirm — mechanical trade item
  rev_cycle_unit: [{ item: "Reverse-cycle unit", qty: 1, unit: "ea" }], // TODO: confirm — usually supplied by HVAC contractor
  thermostat: [
    { item: "Thermostat", qty: 1, unit: "ea" },
    { item: "Thermostat wall plate", qty: 1, unit: "ea" }, // TODO: confirm — not all thermostats need a separate plate
  ],
  return_air: [{ item: "Return air grille", qty: 1, unit: "ea" }], // TODO: confirm — mechanical trade item
  evap_cooling_duct: [{ item: "Evap cooling duct outlet", qty: 1, unit: "ea" }], // TODO: confirm — mechanical trade item
  evap_cooling_unit: [{ item: "Evaporative cooling unit", qty: 1, unit: "ea" }], // TODO: confirm — usually supplied by HVAC contractor
  ac_condenser: [{ item: "AC isolator switch", qty: 1, unit: "ea" }], // TODO: confirm — condenser itself is HVAC-supplied, sparky provides the isolator
  ac_head_unit: [{ item: "AC head unit", qty: 1, unit: "ea" }], // TODO: confirm — usually supplied by HVAC contractor
  cooling_unit: [{ item: "Cooling unit", qty: 1, unit: "ea" }], // TODO: confirm — usually supplied by HVAC contractor

  // Ducted vacuum
  vacuum_unit: [{ item: "Ducted vacuum power unit", qty: 1, unit: "ea" }], // TODO: confirm — usually supplied by the vacuum installer
  vacuum_outlet: [
    { item: "Ducted vacuum outlet", qty: 1, unit: "ea" },
    { item: "Vacuum outlet plate", qty: 1, unit: "ea" },
  ],
};

/** Materials for ONE fitting, driven by its type AND its specs. */
export function materialsForFitting(
  fitting: Pick<SetoutFitting, "type" | "specs">,
  job: MaterialsJobSettings = {}
): MaterialLine[] {
  const { type, specs } = fitting;
  if (type === "led_strip") return ledStripMaterials(specs, job);
  if (type === "gpo") return gpoMaterials(specs);
  if (type === "data") return dataMaterials(specs);
  if (type === "switch") return switchMaterials(fitting);
  if (type === "downlight") return downlightMaterials(specs);
  if (type === "para_flood") return paraFloodMaterials(specs);
  if (type === "fluoro_1200") return fluoro1200Materials(specs);

  const base = BASE_MATERIALS_BY_TYPE[type];
  if (!base) return []; // shouldn't happen — every TableFittingType has an entry above
  const group = groupFor(type);
  return base.map((line) => ({ ...line, group }));
}

/** Roll up a whole plan: sum identical {item, unit, group} lines, sorted by group then item. */
export function aggregateMaterials(
  fittings: Pick<SetoutFitting, "type" | "specs">[],
  job: MaterialsJobSettings = {}
): MaterialLine[] {
  const totals = new Map<string, MaterialLine>();
  for (const fitting of fittings) {
    for (const line of materialsForFitting(fitting, job)) {
      const key = `${line.group} ${line.item} ${line.unit}`;
      const existing = totals.get(key);
      if (existing) existing.qty += line.qty;
      else totals.set(key, { ...line });
    }
  }
  return Array.from(totals.values()).sort((a, b) => a.group.localeCompare(b.group) || a.item.localeCompare(b.item));
}
