// Pure helpers for the structured circuit schedule (20260917020000) —
// sensible Australian domestic defaults for a new circuit's device/cable
// fields, compact display formatting for the switchboard legend/PDF, and
// the site-safety warnings shown under a circuit in CircuitsPanel. No
// React/DB/Supabase calls, same convention as setoutMaximumDemand.ts.
import type { FittingType } from "@/components/setout/symbols";
import { CATEGORY_FOR_TYPE, type CircuitCableType, type CircuitDeviceType, type SetoutCircuit } from "@/lib/setoutTypes";

// Practical Australian domestic circuit "purposes" used only to prefill a
// new circuit's schedule fields when it's created in CircuitsPanel — this is
// NOT a stored column. setout_circuits.circuit_type (SetoutTypes.CircuitType,
// "standard" | "solar") is a separate, unrelated distinction already in the
// schema (solar circuits carry their own voltage-rise fields); nothing in
// this codebase already carries per-purpose device/cable defaults, so this
// is a new, small, UI-only enum rather than a duplicate of anything.
export type CircuitPurpose = "lighting" | "power" | "oven" | "cooktop" | "hot_water" | "ac" | "ev_charger";

export const CIRCUIT_PURPOSE_LABELS: Record<CircuitPurpose, string> = {
  lighting: "Lighting",
  power: "Power (GPO)",
  oven: "Oven",
  cooktop: "Cooktop",
  hot_water: "Hot water",
  ac: "Air conditioning",
  ev_charger: "EV charger",
};

export const CIRCUIT_DEVICE_TYPE_LABELS: Record<CircuitDeviceType, string> = {
  mcb: "MCB",
  rcbo: "RCBO",
  rcd_mcb: "RCD+MCB",
  main_switch: "Main switch",
  other: "Other",
};

export const CIRCUIT_CABLE_TYPE_LABELS: Record<CircuitCableType, string> = {
  tps: "TPS",
  xlpe: "XLPE",
  orange_circular: "Orange circular",
};

export interface CircuitDeviceDefaults {
  device_type: CircuitDeviceType;
  poles: 1 | 3;
  breaker_rating: string;
  cable_csa_mm2: number;
  cable_type: CircuitCableType;
  rcd_protected: boolean;
}

// Sensible Australian residential defaults per circuit purpose — a starting
// point the tradie can override in CircuitsPanel, never a rule. RCBO/
// rcd_protected=true is the default device for every purpose here because
// AS/NZS 3000:2018 Amdt 2 Clause 2.6.3.2.2 requires 30 mA RCD protection on
// every final subcircuit in a domestic installation (see circuitWarnings
// below) — a new circuit starts compliant instead of needing the tradie to
// remember to tick RCD every time. `threePhase` swaps in the 3-pole variant
// for a circuit landed on a three-phase supply — relevant for oven/cooktop/
// EV charger; lighting/power/hot water/AC are always single-phase final
// subcircuits in a home.
export function defaultCircuitSpec(purpose: CircuitPurpose, opts?: { threePhase?: boolean }): CircuitDeviceDefaults {
  const threePhase = opts?.threePhase ?? false;
  const base: Pick<CircuitDeviceDefaults, "breaker_rating" | "cable_csa_mm2" | "cable_type"> = (() => {
    switch (purpose) {
      case "lighting":
        return { breaker_rating: "10 A", cable_csa_mm2: 1.5, cable_type: "tps" };
      case "power":
        return { breaker_rating: "20 A", cable_csa_mm2: 2.5, cable_type: "tps" };
      case "hot_water":
        return { breaker_rating: "20 A", cable_csa_mm2: 2.5, cable_type: "tps" };
      case "ac":
        return { breaker_rating: "20 A", cable_csa_mm2: 2.5, cable_type: "tps" };
      case "cooktop":
        return { breaker_rating: "32 A", cable_csa_mm2: 6, cable_type: "tps" };
      case "oven":
        return { breaker_rating: "32 A", cable_csa_mm2: 6, cable_type: "tps" };
      case "ev_charger":
        return { breaker_rating: "32 A", cable_csa_mm2: 6, cable_type: "tps" };
    }
  })();
  return {
    device_type: "rcbo",
    rcd_protected: true,
    poles: threePhase ? 3 : 1,
    ...base,
  };
}

// Conservative "clipped direct / in thermal insulation" guide figures for
// common TPS sizes, keyed by conductor CSA in mm² — deliberately the lower
// end of AS/NZS 3008.1.1's installation-method range, so a breaker at or
// under this figure is safe for every common method in that table, not just
// the best case (free air/spaced). This is a guide only, not a substitute
// for a real AS/NZS 3008.1.1 lookup against the actual installation method,
// run length and grouping — circuitWarnings below says so every time it
// fires.
export const CABLE_MAX_BREAKER_AMPS: Record<number, number> = {
  1.5: 16,
  2.5: 20,
  4: 25,
  6: 32,
  10: 40,
  16: 63,
};

function parseAmps(rating: string | null | undefined): number | null {
  if (!rating) return null;
  const match = rating.match(/(\d+(\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

const SOCKET_OUTLET_TYPES: FittingType[] = ["gpo", "gpo_switch_combo"];

// Warnings shown as small amber lines under a circuit in CircuitsPanel.
// Every check here is advisory/a guide, never a hard block — the tradie is
// the licensed person who signs off the actual installation, not this app.
export function circuitWarnings(
  circuit: Pick<SetoutCircuit, "device_type" | "rcd_protected" | "breaker_rating" | "cable_csa_mm2">,
  fittingsOnCircuit: { type: FittingType }[],
): string[] {
  const warnings: string[] = [];
  const amps = parseAmps(circuit.breaker_rating);

  // 1. RCD protection — AS/NZS 3000:2018 Amendment 2 Clause 2.6.3.2.2
  // requires 30 mA RCD protection on all final subcircuits in domestic
  // installations. rcbo/rcd_mcb carry it built into the device; a plain mcb
  // can still be RCD-protected by a separate shared RCD upstream, recorded
  // via rcd_protected. main_switch isn't a final subcircuit, so it's never
  // flagged. An unrecorded breaker rating is treated as "could be ≤32 A"
  // rather than skipped, since that's the common domestic case this rule
  // targets.
  const deviceHasBuiltInRcd = circuit.device_type === "rcbo" || circuit.device_type === "rcd_mcb";
  const isFinalSubcircuit = circuit.device_type !== "main_switch";
  if (isFinalSubcircuit && !deviceHasBuiltInRcd && circuit.rcd_protected !== true && (amps === null || amps <= 32)) {
    warnings.push(
      "No RCD protection recorded — AS/NZS 3000:2018 Amdt 2 Cl 2.6.3.2.2 requires 30 mA RCD protection on domestic final subcircuits.",
    );
  }

  // 2. Point-count guidance — a practical guide (Cl 2.2 / Appendix C
  // diversity treatment assumes point counts in this range), not a hard
  // rule against putting more points on one circuit.
  const lightingPoints = fittingsOnCircuit.filter((f) => CATEGORY_FOR_TYPE[f.type] === "lighting").length;
  if (lightingPoints > 20) {
    warnings.push(
      `${lightingPoints} lighting points on this circuit — more than the usual 20-point guide (Cl 2.2/Appendix C). Check loading before finalising.`,
    );
  }
  const socketPoints = fittingsOnCircuit.filter((f) => SOCKET_OUTLET_TYPES.includes(f.type)).length;
  if (socketPoints > 20) {
    warnings.push(
      `${socketPoints} socket outlets on this circuit — more than the usual 20-point guide (Cl 2.2/Appendix C). Check loading before finalising.`,
    );
  }

  // 3. Breaker rating vs cable size — conservative guide only, see
  // CABLE_MAX_BREAKER_AMPS above.
  if (amps !== null && circuit.cable_csa_mm2 != null) {
    const maxAmps = CABLE_MAX_BREAKER_AMPS[circuit.cable_csa_mm2];
    if (maxAmps !== undefined && amps > maxAmps) {
      warnings.push(
        `${amps} A breaker exceeds the ${maxAmps} A conservative guide for ${circuit.cable_csa_mm2} mm² cable — guide only, check AS/NZS 3008.1.1 for the actual installation method.`,
      );
    }
  }

  return warnings;
}

// "20 A RCBO 1P" — the compact device summary printed on the switchboard
// legend (on-screen preview and PDF alike). Falls back to the free-text
// breaker_rating alone, or "—", when the structured fields are unset, so a
// circuit saved before this schedule existed still prints something useful.
export function formatCircuitDevice(circuit: Pick<SetoutCircuit, "device_type" | "breaker_rating" | "poles">): string {
  const parts: string[] = [];
  if (circuit.breaker_rating) parts.push(circuit.breaker_rating);
  if (circuit.device_type) parts.push(CIRCUIT_DEVICE_TYPE_LABELS[circuit.device_type]);
  if (circuit.poles) parts.push(`${circuit.poles}P`);
  return parts.length > 0 ? parts.join(" ") : "—";
}

// "2.5 mm² TPS" — the compact cable summary for the same legend/report row.
export function formatCircuitCable(circuit: Pick<SetoutCircuit, "cable_csa_mm2" | "cable_type">): string {
  const parts: string[] = [];
  if (circuit.cable_csa_mm2 != null) parts.push(`${circuit.cable_csa_mm2} mm²`);
  if (circuit.cable_type) parts.push(CIRCUIT_CABLE_TYPE_LABELS[circuit.cable_type]);
  return parts.length > 0 ? parts.join(" ") : "—";
}

// RCD status for the legend/report's RCD column — true/false only when it's
// actually known (a built-in RCD device, or rcd_protected explicitly set);
// null means "not recorded" (old plan, or never set) rather than a
// confirmed "no RCD", so the UI can render a dash instead of a false tick.
export function circuitHasRcd(circuit: Pick<SetoutCircuit, "device_type" | "rcd_protected">): boolean | null {
  if (circuit.device_type === "rcbo" || circuit.device_type === "rcd_mcb") return true;
  if (circuit.rcd_protected === true) return true;
  if (circuit.rcd_protected === false) return false;
  return null;
}
