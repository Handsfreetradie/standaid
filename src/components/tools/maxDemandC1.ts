// Maximum demand for a single domestic electrical installation per
// AS/NZS 3000:2018 Appendix C, Table C1 (single domestic, per phase).
//
// Table C1 does NOT apply per-circuit diversity percentages — it assigns each
// load GROUP a contribution rule. This module implements those rules so the
// tool's answer matches the standard (and the capstone exam method).

export interface LoadGroupDef {
  key: string;
  label: string;
  group: string; // Table C1 load group reference
  inputKind: "points" | "amps";
  inputLabel: string;
  rule: string; // human-readable contribution rule shown in the result
  calc: (value: number) => number;
  hint?: string;
}

const per20 = (points: number, first: number, extra: number): number => {
  if (points <= 0) return 0;
  if (points <= 20) return first;
  return first + Math.ceil((points - 20) / 20) * extra;
};

export const C1_LOAD_GROUPS: LoadGroupDef[] = [
  {
    key: "lighting",
    label: "Lighting",
    group: "a(i)",
    inputKind: "points",
    inputLabel: "Number of lighting points",
    rule: "3 A for points 1–20, plus 2 A for each additional 20 points (or part)",
    calc: (points) => per20(points, 3, 2),
    hint: "Count light points, not circuits. Includes exhaust fans.",
  },
  {
    key: "gpo10",
    label: "Socket-outlets (10 A GPOs)",
    group: "b(i)",
    inputKind: "points",
    inputLabel: "Number of socket-outlet points",
    rule: "10 A for points 1–20, plus 5 A for each additional 20 points (or part)",
    calc: (points) => per20(points, 10, 5),
    hint: "Count outlet points (a double GPO = 2 points). Includes fixed appliances ≤10 A.",
  },
  {
    key: "socket15",
    label: "15 A socket-outlets",
    group: "b(ii)",
    inputKind: "points",
    inputLabel: "Number of 15 A outlets",
    rule: "10 A where the installation includes one or more 15 A socket-outlets (flat, not per outlet)",
    calc: (count) => (count > 0 ? 10 : 0),
    hint: "e.g. caravan outlet, some workshop machines. Excludes outlets supplying groups (c)–(g) equipment.",
  },
  {
    key: "socket20",
    label: "20 A socket-outlets",
    group: "b(iii)",
    inputKind: "points",
    inputLabel: "Number of 20 A outlets",
    rule: "15 A where the installation includes one or more 20 A socket-outlets (flat, not per outlet)",
    calc: (count) => (count > 0 ? 15 : 0),
    hint: "Excludes outlets supplying groups (c)–(g) equipment.",
  },
  {
    key: "cooking",
    label: "Ranges, cooking appliances, laundry equipment (>10 A)",
    group: "c",
    inputKind: "amps",
    inputLabel: "Total connected current (A)",
    rule: "50% of the connected load",
    calc: (amps) => amps * 0.5,
    hint: "Add the rated current of all group (c) appliances — the tool takes 50%.",
  },
  {
    key: "heatingAircon",
    label: "Fixed space heating / air conditioning",
    group: "d",
    inputKind: "amps",
    inputLabel: "Total connected current (A)",
    rule: "75% of the connected load",
    calc: (amps) => amps * 0.75,
    hint: "If you have both heating and cooling, count only the larger of the two.",
  },
  {
    key: "instantHws",
    label: "Instantaneous water heater",
    group: "e",
    inputKind: "amps",
    inputLabel: "Rated current (A)",
    rule: "33.3% of the connected load",
    calc: (amps) => amps / 3,
  },
  {
    key: "storageHws",
    label: "Storage water heater",
    group: "f",
    inputKind: "amps",
    inputLabel: "Rated current (A)",
    rule: "Full connected load (100%)",
    calc: (amps) => amps,
    hint: "Off-peak / controlled-load HWS on a separate tariff is excluded — don't count it here.",
  },
  {
    key: "poolSpa",
    label: "Spa / swimming pool heaters",
    group: "g",
    inputKind: "amps",
    inputLabel: "Largest heater rated current (A)",
    rule: "75% of the largest spa + 75% of the largest pool + 25% of the remainder",
    calc: (amps) => amps * 0.75,
    hint: "Enter your largest heater here (75% applied). If you have extra heaters, add 25% of their total under 'Other'.",
  },
  {
    key: "evCharger",
    label: "EV charger (dedicated)",
    group: "—",
    inputKind: "amps",
    inputLabel: "Rated current (A)",
    rule: "Full connected load (continuous load — not diversified)",
    calc: (amps) => amps,
    hint: "Not a Table C1 group — treat at 100% and check your DNSP's EV rules.",
  },
  {
    key: "other",
    label: "Other fixed appliances (>10 A)",
    group: "other",
    inputKind: "amps",
    inputLabel: "Total connected current (A)",
    rule: "Full connected load (100%)",
    calc: (amps) => amps,
  },
];

export interface DemandLine {
  key: string;
  label: string;
  group: string;
  input: number;
  inputKind: "points" | "amps";
  rule: string;
  demandA: number;
}

export interface MaxDemandResult {
  lines: DemandLine[];
  totalDemandA: number;
  mainSwitchSizeA: number;
}

// Standard main switch / protective device ratings
const MAIN_SIZES = [16, 20, 25, 32, 40, 50, 63, 80, 100];

export function calculateMaxDemandC1(inputs: Record<string, number>): MaxDemandResult {
  const lines: DemandLine[] = [];
  let total = 0;

  for (const g of C1_LOAD_GROUPS) {
    const value = inputs[g.key] || 0;
    if (value <= 0) continue;
    const demandA = Math.round(g.calc(value) * 100) / 100;
    total += demandA;
    lines.push({
      key: g.key,
      label: g.label,
      group: g.group,
      input: value,
      inputKind: g.inputKind,
      rule: g.rule,
      demandA,
    });
  }

  total = Math.round(total * 10) / 10;
  const mainSwitchSizeA = MAIN_SIZES.find((s) => s >= total) ?? MAIN_SIZES[MAIN_SIZES.length - 1];

  return { lines, totalDemandA: total, mainSwitchSizeA };
}
