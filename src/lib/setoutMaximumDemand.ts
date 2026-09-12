// Maximum Demand calculation for a domestic (single dwelling) rough-in plan,
// assessed to AS/NZS 3000:2018 Appendix C, Table C1, column 1 — "Single
// domestic electrical installation or individual living unit."
//
// Every figure below was verified against AS/NZS 3000:2018's own worked
// examples (Appendix C, clause C2.3.2.1 and C2.3.2.2), not just the table
// text, because the table's OCR text alone was ambiguous about which column
// applies to a single dwelling for the percentage-based groups. The examples
// gave unambiguous computed numbers to check against — see
// setoutMaximumDemand.test.ts, which reproduces C2.3.2.1's 84.4 A result.
//
// Table C5 (domestic cooking appliances) is deliberately NOT used here — it
// sizes the final subcircuit's own breaker for a cooking appliance, a
// different calculation from the whole-installation demand total this file
// computes. Group (c) below uses Table C1's own 50%-connected-load rule
// instead, which is what the worked examples actually use for the total.
//
// Multi-storey jobs and commercial (non-domestic, Table C2) installations
// are out of scope here — this only ever sees one plan's fittings/load items
// at a time, and Table C2's calculation shape ("highest-rated appliance +
// % of the remainder") is different enough from Table C1's per-point/
// per-group-percentage shape that it needs its own function, not a flag on
// this one, when that's built.
import type { FittingType } from "@/components/setout/symbols";
import { pathLength } from "@/lib/setoutPathGeometry";
import type { SetoutFitting, SetoutLoadItem } from "@/lib/setoutTypes";

const SUPPLY_VOLTAGE = 230;
// Line voltage for a three-phase supply — used only to convert the
// installation's total demand (kVA) into a line current, once every
// individual group's own 230V-branch amps have already been summed into a
// phase-independent kVA figure. See calculateMaximumDemand's totalAmps.
const THREE_PHASE_LINE_VOLTAGE = 400;

export type SupplyPhase = "single" | "three";

export type LoadGroupKey =
  | "lighting_point"
  | "socket_10a"
  | "outdoor_lighting"
  | "socket_15a_present"
  | "socket_20a_present"
  | "cooking_laundry"
  | "space_heating_cooling"
  | "instantaneous_water_heater"
  | "storage_water_heater"
  | "spa_pool_heater"
  | "other_load";

interface PointsLoadGroup {
  key: "lighting_point" | "socket_10a";
  kind: "points";
  label: string;
  clauseRef: string;
  /** Flat allowance for the first 20 points. */
  base: number;
  /** Added for every additional block of 20 points (or part thereof). */
  perBlock: number;
}

interface PercentLoadGroup {
  key: "outdoor_lighting" | "cooking_laundry" | "space_heating_cooling" | "instantaneous_water_heater" | "storage_water_heater" | "spa_pool_heater" | "other_load";
  kind: "percent";
  label: string;
  clauseRef: string;
  /** Fraction of the total connected load (W) that counts toward demand. */
  percentOfLoad: number;
  /** Shown in the UI next to groups that are a reasonable approximation
   * rather than a directly-verified AS3000 figure. */
  note?: string;
}

// A 15 A or 20 A socket-outlet isn't wattage-based — its presence on the job
// just adds a flat allowance to group (b) once (Note 10). There's no
// current-rating field on a placed GPO fitting to detect this automatically,
// so it's a manual "is there one of these on the job?" entry — rating_w/
// quantity on the load item are ignored for these two groups, only whether
// at least one exists matters.
interface FlagLoadGroup {
  key: "socket_15a_present" | "socket_20a_present";
  kind: "flag";
  label: string;
  clauseRef: string;
  amps: number;
}

export type LoadGroupDef = PointsLoadGroup | PercentLoadGroup | FlagLoadGroup;

// Manually-added loads (hot water, oven, hotplate, 15A/20A outlets, etc.)
// pick one of these — the auto-counted point groups (lighting_point,
// socket_10a) aren't offered as manual options since they're tallied from
// what's actually on the plan.
export const LOAD_GROUPS: LoadGroupDef[] = [
  {
    key: "lighting_point",
    kind: "points",
    label: "Lighting points",
    clauseRef: "Table C1, group (a)(i)",
    base: 3,
    perBlock: 2,
  },
  {
    key: "outdoor_lighting",
    kind: "percent",
    label: "Outdoor lighting over 1000 W (floodlight, tennis court, etc.)",
    clauseRef: "Table C1, group (a)(ii)",
    percentOfLoad: 0.75,
  },
  {
    key: "socket_10a",
    kind: "points",
    label: "10 A socket-outlets",
    clauseRef: "Table C1, group (b)(i)",
    base: 10,
    perBlock: 5,
  },
  {
    key: "socket_15a_present",
    kind: "flag",
    label: "Has a 15 A socket-outlet",
    clauseRef: "Table C1, group (b)(ii), Note 10",
    amps: 10,
  },
  {
    key: "socket_20a_present",
    kind: "flag",
    label: "Has a 20 A socket-outlet",
    clauseRef: "Table C1, group (b)(iii), Note 10",
    amps: 15,
  },
  {
    key: "cooking_laundry",
    kind: "percent",
    label: "Cooking appliances / laundry equipment (oven, hotplate, cooktop, dryer)",
    clauseRef: "Table C1, group (c)",
    percentOfLoad: 0.5,
  },
  {
    key: "space_heating_cooling",
    kind: "percent",
    label: "Fixed space heating / air-conditioning",
    clauseRef: "Table C1, group (d)",
    percentOfLoad: 0.75,
  },
  {
    key: "instantaneous_water_heater",
    kind: "percent",
    label: "Instantaneous water heater",
    clauseRef: "Table C1, group (e)",
    percentOfLoad: 1 / 3,
  },
  {
    key: "storage_water_heater",
    kind: "percent",
    label: "Storage water heater / hot water system",
    clauseRef: "Table C1, group (f)",
    percentOfLoad: 1,
  },
  {
    key: "spa_pool_heater",
    kind: "percent",
    label: "Spa / swimming pool heater",
    clauseRef: "Table C1, group (g)",
    percentOfLoad: 0.75,
    note: "Simplified for one spa/pool — AS3000 has an extra allowance if there's more than one.",
  },
  {
    key: "other_load",
    kind: "percent",
    label: "Other (EV charger, etc.)",
    clauseRef: "Table C1",
    percentOfLoad: 1,
    note: "Full connected load, no diversity applied — check the specific AS3000 provision for this equipment.",
  },
];

const LOAD_GROUP_BY_KEY = new Map(LOAD_GROUPS.map((g) => [g.key, g]));

// Every lighting-category fitting type except led_strip counts as one
// lighting point each — matches Table C1's point-counting method. led_strip
// is a continuous run rather than a discrete fitting, so it's excluded here
// and handled by length in lightingPointsFromFittings below (Note 4: a
// lighting run is regarded as two points per metre).
const LIGHTING_POINT_TYPES: ReadonlySet<FittingType> = new Set([
  "downlight",
  "batten_holder",
  "wall_batten_holder",
  "wall_stair_light",
  "external_light",
  "heater_fan_light_2",
  "heater_fan_light_4",
  "junction_box",
  "ceiling_fan",
  "ceiling_fan_light",
  "para_flood",
  "round_fluoro",
  "fluoro_1200",
  "motion_sensor",
  "exhaust_fan_light",
  "pendant",
]);

function pointsToAmps(points: number, group: PointsLoadGroup): number {
  if (points <= 0) return 0;
  const additionalBlocks = Math.ceil(Math.max(0, points - 20) / 20);
  return group.base + additionalBlocks * group.perBlock;
}

function lightingPointsFromFittings(fittings: Pick<SetoutFitting, "type" | "specs">[]): number {
  let points = 0;
  for (const f of fittings) {
    if (f.type === "led_strip") {
      points += pathLength(f.specs.path ?? []) * 2;
    } else if (LIGHTING_POINT_TYPES.has(f.type)) {
      points += 1;
    }
  }
  return points;
}

function socketPointsFromFittings(fittings: Pick<SetoutFitting, "type" | "specs">[]): number {
  let points = 0;
  for (const f of fittings) {
    if (f.type === "gpo") points += f.specs.count ?? 1;
  }
  return points;
}

// Appliance-type fittings that count straight into Maximum Demand once given
// a rating on the symbol itself (see FittingPalette's "Rating (W)" field) —
// no separate manual "Other loads" entry needed for these. hot_water_unit
// isn't listed here since its group depends on specs.waterHeaterType
// (handled separately in applianceLoadGroupForFitting below).
const APPLIANCE_LOAD_GROUP_BY_TYPE: Partial<Record<FittingType, LoadGroupKey>> = {
  cooktop: "cooking_laundry",
  oven: "cooking_laundry",
  other_appliance: "other_load",
  // Fixed heating appliances — Table C1 group (d), not the "other" catch-all.
  heated_towel_rail: "space_heating_cooling",
  underfloor_heating_stat: "space_heating_cooling",
  // HVAC unit symbols. A split system is usually drawn as an outdoor
  // condenser + indoor head as a PAIR — set the rating on the unit that
  // actually carries the connection (typically the outdoor condenser) and
  // leave the other at 0, or the same job's total will double up.
  ducted_heating_unit: "space_heating_cooling",
  rev_cycle_unit: "space_heating_cooling",
  evap_cooling_unit: "space_heating_cooling",
  ac_condenser: "space_heating_cooling",
  ac_head_unit: "space_heating_cooling",
  cooling_unit: "space_heating_cooling",
  spa_pool_heater: "spa_pool_heater",
};

function applianceLoadGroupForFitting(fitting: Pick<SetoutFitting, "type" | "specs">): LoadGroupKey | null {
  if (fitting.type === "hot_water_unit") {
    return fitting.specs.waterHeaterType === "instantaneous" ? "instantaneous_water_heater" : "storage_water_heater";
  }
  return APPLIANCE_LOAD_GROUP_BY_TYPE[fitting.type] ?? null;
}

// Sum of every placed appliance fitting's own ratingW that maps to this
// group — additive with the manual load-items list, not a replacement for
// it, so a tradie can still record something with no symbol on the plan
// (e.g. a dryer with no dedicated fitting type).
function applianceWattageForGroup(fittings: Pick<SetoutFitting, "type" | "specs">[], groupKey: LoadGroupKey): number {
  let total = 0;
  for (const f of fittings) {
    if (applianceLoadGroupForFitting(f) === groupKey) total += f.specs.ratingW ?? 0;
  }
  return total;
}

export interface LoadGroupResult {
  key: LoadGroupKey;
  label: string;
  clauseRef: string;
  /** Lighting/socket points only. */
  points?: number;
  /** Total connected watts contributing to this group — percent-based groups only. */
  connectedW?: number;
  amps: number;
}

export interface MaximumDemandResult {
  groups: LoadGroupResult[];
  totalAmps: number;
  totalKva: number;
  supplyPhase: SupplyPhase;
}

// Every individual group's own `amps` is always a 230V figure — even on a
// three-phase job, ordinary circuits (lighting, GPOs, a single cooktop, etc.)
// are still 230V single-phase branches, just balanced A/B/C across the
// three phases, so that per-group number stays meaningful and unchanged
// either way. What actually depends on supplyPhase is the FINAL total
// current: single-phase sums those 230V branch amps directly (unchanged
// from before this param existed); three-phase instead works out the line
// current for a balanced three-phase supply from the installation's total
// apparent power (kVA), which is phase-independent — I = kVA*1000 /
// (sqrt(3) x 400V).
export function calculateMaximumDemand(
  fittings: Pick<SetoutFitting, "type" | "specs">[],
  loadItems: Pick<SetoutLoadItem, "load_group" | "rating_w" | "quantity">[],
  supplyPhase: SupplyPhase = "single",
): MaximumDemandResult {
  const groups: LoadGroupResult[] = [];

  const lightingGroup = LOAD_GROUP_BY_KEY.get("lighting_point") as PointsLoadGroup;
  const lightingPoints = lightingPointsFromFittings(fittings);
  groups.push({
    key: "lighting_point",
    label: lightingGroup.label,
    clauseRef: lightingGroup.clauseRef,
    points: lightingPoints,
    amps: pointsToAmps(lightingPoints, lightingGroup),
  });

  const socketGroup = LOAD_GROUP_BY_KEY.get("socket_10a") as PointsLoadGroup;
  const socketPoints = socketPointsFromFittings(fittings);
  groups.push({
    key: "socket_10a",
    label: socketGroup.label,
    clauseRef: socketGroup.clauseRef,
    points: socketPoints,
    amps: pointsToAmps(socketPoints, socketGroup),
  });

  for (const group of LOAD_GROUPS) {
    if (group.kind === "percent") {
      const manualW = loadItems
        .filter((item) => item.load_group === group.key)
        .reduce((sum, item) => sum + item.rating_w * item.quantity, 0);
      const connectedW = manualW + applianceWattageForGroup(fittings, group.key);
      groups.push({
        key: group.key,
        label: group.label,
        clauseRef: group.clauseRef,
        connectedW,
        amps: (connectedW / SUPPLY_VOLTAGE) * group.percentOfLoad,
      });
    } else if (group.kind === "flag") {
      // Auto-detected from any placed GPO already set to that rating (see
      // GPO_RATING_OPTIONS in FittingPalette.tsx) — additive with the manual
      // flag entry so either source is enough to trigger it.
      const ratingAmps = group.key === "socket_15a_present" ? 15 : 20;
      const presentOnPlan = fittings.some((f) => f.type === "gpo" && f.specs.ratingAmps === ratingAmps);
      const present = presentOnPlan || loadItems.some((item) => item.load_group === group.key);
      groups.push({
        key: group.key,
        label: group.label,
        clauseRef: group.clauseRef,
        amps: present ? group.amps : 0,
      });
    }
  }

  // Note 10: if both a 15A and a 20A outlet are present, the increase is
  // 15A total, not 25A — the 20A allowance absorbs the 15A one rather than
  // stacking with it.
  const has15a = groups.find((g) => g.key === "socket_15a_present");
  const has20a = groups.find((g) => g.key === "socket_20a_present");
  if (has15a && has20a && has15a.amps > 0 && has20a.amps > 0) {
    has15a.amps = 0;
  }

  const singlePhaseEquivalentAmps = groups.reduce((sum, g) => sum + g.amps, 0);
  const totalKva = (singlePhaseEquivalentAmps * SUPPLY_VOLTAGE) / 1000;
  const totalAmps =
    supplyPhase === "three" ? (totalKva * 1000) / (Math.sqrt(3) * THREE_PHASE_LINE_VOLTAGE) : singlePhaseEquivalentAmps;
  return { groups, totalAmps, totalKva, supplyPhase };
}
