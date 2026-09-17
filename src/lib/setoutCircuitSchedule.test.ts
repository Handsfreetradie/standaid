import { describe, expect, it } from "vitest";
import {
  CABLE_MAX_BREAKER_AMPS,
  circuitHasRcd,
  circuitWarnings,
  defaultCircuitSpec,
  formatCircuitCable,
  formatCircuitDevice,
} from "./setoutCircuitSchedule";
import type { SetoutCircuit } from "./setoutTypes";

type C = Pick<SetoutCircuit, "device_type" | "rcd_protected" | "breaker_rating" | "cable_csa_mm2">;

function circuit(overrides: Partial<C> = {}): C {
  return {
    device_type: null,
    rcd_protected: null,
    breaker_rating: null,
    cable_csa_mm2: null,
    ...overrides,
  };
}

describe("defaultCircuitSpec", () => {
  it("defaults lighting to 10 A RCBO, 1 pole, 1.5 mm² TPS", () => {
    expect(defaultCircuitSpec("lighting")).toEqual({
      device_type: "rcbo",
      rcd_protected: true,
      poles: 1,
      breaker_rating: "10 A",
      cable_csa_mm2: 1.5,
      cable_type: "tps",
    });
  });

  it("defaults power/GPO to 20 A RCBO, 2.5 mm² TPS", () => {
    const spec = defaultCircuitSpec("power");
    expect(spec.breaker_rating).toBe("20 A");
    expect(spec.cable_csa_mm2).toBe(2.5);
    expect(spec.cable_type).toBe("tps");
    expect(spec.device_type).toBe("rcbo");
  });

  it("defaults oven/cooktop/EV charger to 32 A RCBO, 6 mm² TPS", () => {
    for (const purpose of ["oven", "cooktop", "ev_charger"] as const) {
      const spec = defaultCircuitSpec(purpose);
      expect(spec.breaker_rating).toBe("32 A");
      expect(spec.cable_csa_mm2).toBe(6);
    }
  });

  it("defaults hot water and AC to 20 A RCBO, 2.5 mm² TPS", () => {
    for (const purpose of ["hot_water", "ac"] as const) {
      const spec = defaultCircuitSpec(purpose);
      expect(spec.breaker_rating).toBe("20 A");
      expect(spec.cable_csa_mm2).toBe(2.5);
    }
  });

  it("always defaults to RCD-protected regardless of purpose", () => {
    (["lighting", "power", "oven", "cooktop", "hot_water", "ac", "ev_charger"] as const).forEach((purpose) => {
      expect(defaultCircuitSpec(purpose).rcd_protected).toBe(true);
    });
  });

  it("switches to 3 poles when threePhase is requested", () => {
    expect(defaultCircuitSpec("oven", { threePhase: true }).poles).toBe(3);
    expect(defaultCircuitSpec("oven").poles).toBe(1);
  });
});

describe("circuitWarnings — RCD protection (AS/NZS 3000:2018 Amdt 2 Cl 2.6.3.2.2)", () => {
  it("warns when a plain MCB with no recorded RCD protection is ≤32 A", () => {
    const warnings = circuitWarnings(circuit({ device_type: "mcb", breaker_rating: "20 A" }), []);
    expect(warnings.some((w) => w.includes("RCD"))).toBe(true);
  });

  it("does not warn when the device is an RCBO", () => {
    const warnings = circuitWarnings(circuit({ device_type: "rcbo", breaker_rating: "20 A" }), []);
    expect(warnings.some((w) => w.includes("RCD"))).toBe(false);
  });

  it("does not warn when the device is an RCD+MCB", () => {
    const warnings = circuitWarnings(circuit({ device_type: "rcd_mcb", breaker_rating: "20 A" }), []);
    expect(warnings.some((w) => w.includes("RCD"))).toBe(false);
  });

  it("does not warn for a plain MCB when rcd_protected is explicitly true (shared upstream RCD)", () => {
    const warnings = circuitWarnings(circuit({ device_type: "mcb", rcd_protected: true, breaker_rating: "20 A" }), []);
    expect(warnings.some((w) => w.includes("RCD"))).toBe(false);
  });

  it("never flags a main switch", () => {
    const warnings = circuitWarnings(circuit({ device_type: "main_switch", breaker_rating: "63 A" }), []);
    expect(warnings.some((w) => w.includes("RCD"))).toBe(false);
  });

  it("still warns when device_type/breaker_rating are entirely unrecorded (old plan)", () => {
    const warnings = circuitWarnings(circuit(), []);
    expect(warnings.some((w) => w.includes("RCD"))).toBe(true);
  });
});

describe("circuitWarnings — point-count guidance (Cl 2.2 / Appendix C)", () => {
  const compliant = circuit({ device_type: "rcbo", breaker_rating: "20 A", cable_csa_mm2: 2.5 });

  it("warns above 20 lighting points", () => {
    const fittings = Array.from({ length: 21 }, () => ({ type: "downlight" as const }));
    const warnings = circuitWarnings(compliant, fittings);
    expect(warnings.some((w) => w.includes("lighting points"))).toBe(true);
  });

  it("does not warn at exactly 20 lighting points", () => {
    const fittings = Array.from({ length: 20 }, () => ({ type: "downlight" as const }));
    const warnings = circuitWarnings(compliant, fittings);
    expect(warnings.some((w) => w.includes("lighting points"))).toBe(false);
  });

  it("warns above 20 socket outlets (gpo/gpo_switch_combo only)", () => {
    const fittings = Array.from({ length: 21 }, () => ({ type: "gpo" as const }));
    const warnings = circuitWarnings(compliant, fittings);
    expect(warnings.some((w) => w.includes("socket outlets"))).toBe(true);
  });

  it("does not count non-socket power fittings (e.g. oven) toward the socket-outlet guide", () => {
    const fittings = Array.from({ length: 25 }, () => ({ type: "oven" as const }));
    const warnings = circuitWarnings(compliant, fittings);
    expect(warnings.some((w) => w.includes("socket outlets"))).toBe(false);
  });
});

describe("circuitWarnings — breaker rating vs cable size (AS/NZS 3008.1.1 guide)", () => {
  it("warns when the breaker exceeds the conservative rating for 1.5 mm² TPS", () => {
    const warnings = circuitWarnings(
      circuit({ device_type: "rcbo", breaker_rating: "20 A", cable_csa_mm2: 1.5 }),
      [],
    );
    expect(warnings.some((w) => w.includes("mm² cable"))).toBe(true);
  });

  it("does not warn when the breaker matches the cable's table figure", () => {
    for (const [csa, maxAmps] of Object.entries(CABLE_MAX_BREAKER_AMPS)) {
      const warnings = circuitWarnings(
        circuit({ device_type: "rcbo", breaker_rating: `${maxAmps} A`, cable_csa_mm2: Number(csa) }),
        [],
      );
      expect(warnings.some((w) => w.includes("mm² cable"))).toBe(false);
    }
  });

  it("says nothing about cable size when cable_csa_mm2 is unrecorded", () => {
    const warnings = circuitWarnings(circuit({ device_type: "rcbo", breaker_rating: "63 A" }), []);
    expect(warnings.some((w) => w.includes("mm² cable"))).toBe(false);
  });
});

describe("formatCircuitDevice / formatCircuitCable / circuitHasRcd", () => {
  it("formats a full device summary", () => {
    expect(formatCircuitDevice({ device_type: "rcbo", breaker_rating: "20 A", poles: 1 })).toBe("20 A RCBO 1P");
  });

  it("falls back to breaker_rating alone when structured fields are unset (old plan)", () => {
    expect(formatCircuitDevice({ device_type: null, breaker_rating: "16A", poles: null })).toBe("16A");
  });

  it("falls back to an em dash when nothing is recorded", () => {
    expect(formatCircuitDevice({ device_type: null, breaker_rating: null, poles: null })).toBe("—");
  });

  it("formats a full cable summary", () => {
    expect(formatCircuitCable({ cable_csa_mm2: 2.5, cable_type: "tps" })).toBe("2.5 mm² TPS");
  });

  it("falls back to an em dash when cable fields are unset", () => {
    expect(formatCircuitCable({ cable_csa_mm2: null, cable_type: null })).toBe("—");
  });

  it("circuitHasRcd is true for rcbo/rcd_mcb, follows rcd_protected for mcb, null when unknown", () => {
    expect(circuitHasRcd({ device_type: "rcbo", rcd_protected: null })).toBe(true);
    expect(circuitHasRcd({ device_type: "rcd_mcb", rcd_protected: null })).toBe(true);
    expect(circuitHasRcd({ device_type: "mcb", rcd_protected: true })).toBe(true);
    expect(circuitHasRcd({ device_type: "mcb", rcd_protected: false })).toBe(false);
    expect(circuitHasRcd({ device_type: "mcb", rcd_protected: null })).toBeNull();
    expect(circuitHasRcd({ device_type: null, rcd_protected: null })).toBeNull();
  });
});
