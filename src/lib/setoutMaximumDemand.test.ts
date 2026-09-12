import { describe, expect, it } from "vitest";
import { calculateMaximumDemand } from "./setoutMaximumDemand";
import type { FittingSpecs, SetoutFitting, SetoutLoadItem } from "./setoutTypes";

type F = Pick<SetoutFitting, "type" | "specs">;
type L = Pick<SetoutLoadItem, "load_group" | "rating_w" | "quantity">;

function fitting(type: F["type"], specs: FittingSpecs = {}): F {
  return { type, specs };
}

function loadItem(load_group: string, rating_w: number, quantity = 1): L {
  return { load_group, rating_w, quantity };
}

describe("calculateMaximumDemand — supply phase", () => {
  it("defaults to single-phase when the param is omitted (same as always)", () => {
    const result = calculateMaximumDemand([], [loadItem("storage_water_heater", 4800)]);
    expect(result.supplyPhase).toBe("single");
    expect(result.totalAmps).toBeCloseTo(20.87, 1);
  });

  it("three-phase divides the single-phase-equivalent total by roughly sqrt(3) x (400/230) ~= 3.01", () => {
    const singlePhase = calculateMaximumDemand([], [loadItem("storage_water_heater", 4800)], "single");
    const threePhase = calculateMaximumDemand([], [loadItem("storage_water_heater", 4800)], "three");
    // Same total kVA either way — the load itself doesn't change, only how
    // much current the incoming supply needs to carry to deliver it.
    expect(threePhase.totalKva).toBeCloseTo(singlePhase.totalKva, 6);
    expect(threePhase.totalAmps).toBeCloseTo(singlePhase.totalAmps / (Math.sqrt(3) * 400 / 230), 6);
    expect(threePhase.supplyPhase).toBe("three");
  });

  it("per-group amps stay the same 230V branch figures regardless of supply phase", () => {
    const single = calculateMaximumDemand([fitting("cooktop", { ratingW: 10000 })], [], "single");
    const three = calculateMaximumDemand([fitting("cooktop", { ratingW: 10000 })], [], "three");
    expect(three.groups.find((g) => g.key === "cooking_laundry")?.amps).toBe(
      single.groups.find((g) => g.key === "cooking_laundry")?.amps,
    );
  });
});

// Reproduces AS/NZS 3000:2018 Appendix C, clause C2.3.2.1 "Example 1" —
// the standard's own worked example for a single domestic installation,
// expected total 84.4 A. Point counts are built from equivalent fittings
// rather than the exact appliance list (e.g. 25 lighting-type fittings + a
// 10m LED run stand in for "24 lighting points + 10m of lighting track",
// both totalling 45 points either way) since only the point TOTAL feeds the
// Table C1 formula, not which fitting produced each point.
describe("calculateMaximumDemand — AS/NZS 3000:2018 Example 1", () => {
  it("matches the standard's own worked example (84.4 A)", () => {
    const fittings: F[] = [
      // 45 lighting points -> group (a)(i): 3 + 2 blocks * 2 = 7 A
      ...Array.from({ length: 25 }, () => fitting("downlight")),
      fitting("led_strip", { path: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }), // 10m -> 20 points
      // 25 socket points (9 single + 8 double) -> group (b)(i): 10 + 1 block * 5 = 15 A
      ...Array.from({ length: 9 }, () => fitting("gpo")),
      ...Array.from({ length: 8 }, () => fitting("gpo", { count: 2 })),
    ];

    const loadItems: L[] = [
      loadItem("outdoor_lighting", 3000), // group (a)(ii): 3000/230 * 0.75 = 9.78 A
      loadItem("socket_15a_present", 0), // group (b)(ii) flag: +10 A
      loadItem("cooking_laundry", 10000), // group (c): 10000/230 * 0.5 = 21.74 A
      loadItem("storage_water_heater", 4800), // group (f): 4800/230 = 20.87 A
    ];

    const result = calculateMaximumDemand(fittings, loadItems);

    expect(result.groups.find((g) => g.key === "lighting_point")?.points).toBe(45);
    expect(result.groups.find((g) => g.key === "lighting_point")?.amps).toBeCloseTo(7, 5);
    expect(result.groups.find((g) => g.key === "socket_10a")?.points).toBe(25);
    expect(result.groups.find((g) => g.key === "socket_10a")?.amps).toBeCloseTo(15, 5);
    expect(result.totalAmps).toBeCloseTo(84.4, 1);
  });
});

// AS/NZS 3000:2018 Appendix C, clause C2.3.2.2 "Example 2" gives the
// instantaneous-water-heater and space-heating/aircon percentages
// independently of Example 1, so they're checked against that example's own
// per-phase figures instead.
describe("calculateMaximumDemand — AS/NZS 3000:2018 Example 2 percentages", () => {
  it("instantaneous water heater is 33.3% of connected load", () => {
    const result = calculateMaximumDemand([], [loadItem("instantaneous_water_heater", 4320)]);
    expect(result.groups.find((g) => g.key === "instantaneous_water_heater")?.amps).toBeCloseTo(6.3, 1);
  });

  it("fixed air-conditioning is 75% of connected load", () => {
    const result = calculateMaximumDemand([], [loadItem("space_heating_cooling", 4000)]);
    expect(result.groups.find((g) => g.key === "space_heating_cooling")?.amps).toBeCloseTo(13.0, 1);
  });
});

describe("calculateMaximumDemand — points formula banding", () => {
  it("gives the flat allowance for 1-20 points with no extra fittings", () => {
    const result = calculateMaximumDemand([fitting("downlight")], []);
    expect(result.groups.find((g) => g.key === "lighting_point")?.amps).toBe(3);
  });

  it("adds a block for every additional 20 points, including a partial block", () => {
    const fittings = Array.from({ length: 21 }, () => fitting("downlight"));
    const result = calculateMaximumDemand(fittings, []);
    expect(result.groups.find((g) => g.key === "lighting_point")?.amps).toBe(5); // 3 + 1 block * 2
  });

  it("contributes zero with no fittings placed", () => {
    const result = calculateMaximumDemand([], []);
    expect(result.groups.find((g) => g.key === "lighting_point")?.amps).toBe(0);
    expect(result.totalAmps).toBe(0);
  });
});

describe("calculateMaximumDemand — appliance ratings set directly on a placed symbol", () => {
  it("counts a cooktop's own ratingW under cooking_laundry with no manual load-item needed", () => {
    const result = calculateMaximumDemand([fitting("cooktop", { ratingW: 10000 })], []);
    // Same 50% diversity as the manual cooking_laundry entry in Example 1.
    expect(result.groups.find((g) => g.key === "cooking_laundry")?.amps).toBeCloseTo(21.74, 1);
  });

  it("counts an oven's own ratingW under cooking_laundry too, additive with a cooktop on the same job", () => {
    const result = calculateMaximumDemand(
      [fitting("cooktop", { ratingW: 7000 }), fitting("oven", { ratingW: 3000 })],
      [],
    );
    expect(result.groups.find((g) => g.key === "cooking_laundry")?.amps).toBeCloseTo(21.74, 1);
  });

  it("a cooktop_isolator contributes nothing to Maximum Demand — it's a switch, not a load", () => {
    const result = calculateMaximumDemand([fitting("cooktop_isolator")], []);
    expect(result.totalAmps).toBe(0);
  });

  it("defaults hot_water_unit to storage (100% diversity) when waterHeaterType is unset", () => {
    const result = calculateMaximumDemand([fitting("hot_water_unit", { ratingW: 4800 })], []);
    expect(result.groups.find((g) => g.key === "storage_water_heater")?.amps).toBeCloseTo(20.87, 1);
    expect(result.groups.find((g) => g.key === "instantaneous_water_heater")?.amps).toBe(0);
  });

  it("routes hot_water_unit to instantaneous_water_heater (33.3%) when explicitly set", () => {
    const result = calculateMaximumDemand([fitting("hot_water_unit", { ratingW: 4320, waterHeaterType: "instantaneous" })], []);
    expect(result.groups.find((g) => g.key === "instantaneous_water_heater")?.amps).toBeCloseTo(6.3, 1);
    expect(result.groups.find((g) => g.key === "storage_water_heater")?.amps).toBe(0);
  });

  it("adds to (not replaces) a manual load-item in the same group", () => {
    const result = calculateMaximumDemand(
      [fitting("other_appliance", { ratingW: 1000 })],
      [loadItem("other_load", 500)],
    );
    // (1000 + 500) / 230 * 1.0 (no diversity on "other")
    expect(result.groups.find((g) => g.key === "other_load")?.amps).toBeCloseTo(6.52, 1);
  });

  it("a fitting with no ratingW set contributes nothing", () => {
    const result = calculateMaximumDemand([fitting("cooktop")], []);
    expect(result.groups.find((g) => g.key === "cooking_laundry")?.amps).toBe(0);
  });

  it("routes heated_towel_rail and underfloor_heating_stat to space_heating_cooling (75%), not the uncapped 'other' group", () => {
    const result = calculateMaximumDemand(
      [fitting("heated_towel_rail", { ratingW: 1000 }), fitting("underfloor_heating_stat", { ratingW: 3000 })],
      [],
    );
    // (1000 + 3000) / 230 * 0.75
    expect(result.groups.find((g) => g.key === "space_heating_cooling")?.amps).toBeCloseTo(13.04, 1);
    expect(result.groups.find((g) => g.key === "other_load")?.amps).toBe(0);
  });

  it("counts HVAC unit types under space_heating_cooling", () => {
    const result = calculateMaximumDemand(
      [
        fitting("ac_condenser", { ratingW: 2000 }),
        fitting("ducted_heating_unit", { ratingW: 5000 }),
        fitting("evap_cooling_unit", { ratingW: 1000 }),
      ],
      [],
    );
    // (2000 + 5000 + 1000) / 230 * 0.75
    expect(result.groups.find((g) => g.key === "space_heating_cooling")?.amps).toBeCloseTo(26.09, 1);
  });

  it("counts a spa_pool_heater under its own AS3000 group (75%), not other_load", () => {
    const result = calculateMaximumDemand([fitting("spa_pool_heater", { ratingW: 3000 })], []);
    expect(result.groups.find((g) => g.key === "spa_pool_heater")?.amps).toBeCloseTo(9.78, 1);
  });
});

describe("calculateMaximumDemand — 15A/20A socket-outlet note", () => {
  it("a 20A outlet absorbs the 15A allowance rather than stacking with it (Note 10)", () => {
    const result = calculateMaximumDemand(
      [],
      [loadItem("socket_15a_present", 0), loadItem("socket_20a_present", 0)],
    );
    expect(result.groups.find((g) => g.key === "socket_15a_present")?.amps).toBe(0);
    expect(result.groups.find((g) => g.key === "socket_20a_present")?.amps).toBe(15);
    expect(result.totalAmps).toBe(15);
  });

  it("auto-detects a 15A/20A GPO placed on the plan — no manual flag needed", () => {
    const result = calculateMaximumDemand([fitting("gpo", { ratingAmps: 15 })], []);
    expect(result.groups.find((g) => g.key === "socket_15a_present")?.amps).toBe(10);
  });

  it("a plain 10A GPO does not trigger the 15A/20A flags", () => {
    const result = calculateMaximumDemand([fitting("gpo")], []);
    expect(result.groups.find((g) => g.key === "socket_15a_present")?.amps).toBe(0);
    expect(result.groups.find((g) => g.key === "socket_20a_present")?.amps).toBe(0);
  });

  it("a placed 20A GPO absorbs a manually-flagged 15A the same way two manual flags do (Note 10)", () => {
    const result = calculateMaximumDemand([fitting("gpo", { ratingAmps: 20 })], [loadItem("socket_15a_present", 0)]);
    expect(result.groups.find((g) => g.key === "socket_15a_present")?.amps).toBe(0);
    expect(result.groups.find((g) => g.key === "socket_20a_present")?.amps).toBe(15);
  });
});
