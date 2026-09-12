import { describe, expect, it } from "vitest";
import { recommendPhaseSplit } from "./setoutPhaseBalance";
import type { SetoutCircuit, SetoutFitting } from "./setoutTypes";

type C = Pick<SetoutCircuit, "id" | "breaker_rating">;
type F = Pick<SetoutFitting, "circuit_id" | "specs">;

function circuit(id: string, breaker_rating: string | null): C {
  return { id, breaker_rating };
}

describe("recommendPhaseSplit", () => {
  it("balances three equal-rated circuits one per phase", () => {
    const circuits: C[] = [circuit("1", "16A"), circuit("2", "16A"), circuit("3", "16A")];
    const result = recommendPhaseSplit(circuits, []);
    const phases = result.recommendations.map((r) => r.phase).sort();
    expect(phases).toEqual(["A", "B", "C"]);
    expect(result.totalsByPhase.A).toBe(16);
    expect(result.totalsByPhase.B).toBe(16);
    expect(result.totalsByPhase.C).toBe(16);
  });

  it("puts the heaviest circuits on different phases rather than piling them up", () => {
    // Two big 32A circuits and four small 10A ones — a naive first-come
    // assignment would stack both 32A circuits on the same phase; the
    // greedy lightest-phase heuristic should spread them instead.
    const circuits: C[] = [
      circuit("big1", "32A"),
      circuit("big2", "32A"),
      circuit("s1", "10A"),
      circuit("s2", "10A"),
      circuit("s3", "10A"),
      circuit("s4", "10A"),
    ];
    const result = recommendPhaseSplit(circuits, []);
    const big1Phase = result.recommendations.find((r) => r.circuitId === "big1")?.phase;
    const big2Phase = result.recommendations.find((r) => r.circuitId === "big2")?.phase;
    expect(big1Phase).not.toBe(big2Phase);
    // Perfectly balanced: 32+10, 32+10, 10+10 = 42, 42, 20... actually with
    // the greedy heuristic the two 32s land on different phases first (the
    // two lightest, both 0), then the four 10s fill in the lightest each
    // time — check the totals are as close to even as this input allows.
    const totals = Object.values(result.totalsByPhase);
    expect(Math.max(...totals) - Math.min(...totals)).toBeLessThanOrEqual(12);
  });

  it("excludes an inherently three-phase circuit (a 3-phase GPO assigned to it) from the single-phase split", () => {
    const circuits: C[] = [circuit("threephase", "32A"), circuit("normal", "16A")];
    const fittings: F[] = [{ circuit_id: "threephase", specs: { threePhase: true, ratingAmps: 32 } }];
    const result = recommendPhaseSplit(circuits, fittings);
    expect(result.threePhaseCircuitIds).toEqual(["threephase"]);
    expect(result.recommendations.map((r) => r.circuitId)).not.toContain("threephase");
    expect(result.recommendations.map((r) => r.circuitId)).toContain("normal");
  });

  it("a solar inverter fitting's own AC/three inverterPhase also marks its circuit as three-phase", () => {
    const circuits: C[] = [circuit("solar", "20A")];
    const fittings: F[] = [{ circuit_id: "solar", specs: { inverterPhase: "three" } }];
    const result = recommendPhaseSplit(circuits, fittings);
    expect(result.threePhaseCircuitIds).toEqual(["solar"]);
  });

  it("round-robins circuits with no parseable breaker rating instead of stacking them on one phase", () => {
    const circuits: C[] = [circuit("1", null), circuit("2", ""), circuit("3", "not a number"), circuit("4", null)];
    const result = recommendPhaseSplit(circuits, []);
    expect(result.recommendations.every((r) => r.weightAmps === null)).toBe(true);
    const phases = result.recommendations.map((r) => r.phase);
    expect(phases).toEqual(["A", "B", "C", "A"]);
  });

  it("parses the actual amp rating out of '2 x 20A', not the '2' multiplier", () => {
    const circuits: C[] = [circuit("1", "2 x 20A")];
    const result = recommendPhaseSplit(circuits, []);
    expect(result.recommendations[0].weightAmps).toBe(20);
  });

  it("falls back to a plain number with no unit at all", () => {
    const circuits: C[] = [circuit("1", "16")];
    const result = recommendPhaseSplit(circuits, []);
    expect(result.recommendations[0].weightAmps).toBe(16);
  });
});
