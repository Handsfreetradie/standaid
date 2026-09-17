import { describe, expect, it } from "vitest";
import {
  CABLE_WASTAGE_FACTOR,
  DEFAULT_CEILING_HEIGHT_M,
  MIN_CIRCUIT_CABLE_METRES,
  TERMINATION_ALLOWANCE_M,
  estimateCableRuns,
  type CableRunCanvas,
  type CableRunCircuit,
  type CableRunFitting,
} from "./setoutCableRuns";

function fitting(overrides: Partial<CableRunFitting> & Pick<CableRunFitting, "id" | "type" | "position">): CableRunFitting {
  return {
    circuit_id: null,
    canvas_id: "canvas-1",
    specs: {},
    ...overrides,
  };
}

function circuit(id: string, label: string): CableRunCircuit {
  return { id, label, circuit_type: "standard", specs: {} };
}

describe("estimateCableRuns", () => {
  // ── Hand-worked expectations ────────────────────────────────────────────
  // Ceiling height 2.4m (default). Board (switchboard) at (0,0), default
  // switchboard height 1.5m -> board drop = 2.4 - 1.5 = 0.9m.
  //
  // Circuit "Power" — 3 GPOs, default GPO height 0.3m -> each drop 2.1m:
  //   GPO1 (2,0), GPO2 (2,3), GPO3 (5,3)
  //   Nearest-neighbour chain from board(0,0):
  //     board->GPO1  |2-0|+|0-0| = 2
  //     GPO1->GPO2   |2-2|+|3-0| = 3   (nearer than GPO3, dist 6)
  //     GPO2->GPO3   |5-2|+|3-3| = 3
  //   horizontal = 2+3+3 = 8
  //   vertical = boardDrop(0.9) + 3 * gpoDrop(2.1) = 0.9 + 6.3 = 7.2
  //   raw = 8 + 7.2 = 15.2
  //   terminations = 1 (board) + 3 (points) = 4 ends -> +4m
  //   with wastage = 15.2 * 1.1 = 16.72; + 4 = 20.72 -> round = 21m
  //
  // Circuit "Lighting" — 2 downlights (no wall-mount default -> flush with
  // the 2.4m ceiling -> drop 0) + 1 switch controlling both:
  //   Light1 (1,1), Light2 (4,1), Switch (0,1) at default switch height 1.2m
  //   -> switch drop = 2.4 - 1.2 = 1.2
  //   Main loop chain from board(0,0):
  //     board->Light1  |1-0|+|1-0| = 2
  //     Light1->Light2 |4-1|+|1-1| = 3
  //   horizontal = 2+3 = 5; vertical = boardDrop(0.9) + 0 + 0 = 0.9
  //   main raw = 5.9; main terminations = 1 (board) + 2 (points) = 3
  //   Switch loops (switch drop + horizontal switch->light, no light drop):
  //     switch->Light1: 1.2 + (|1-0|+|1-1|=1) = 2.2
  //     switch->Light2: 1.2 + (|4-0|+|1-1|=4) = 5.2
  //   loop metres = 2.2+5.2 = 7.4; loop terminations = 2 ends * 2 loops = 4
  //   raw total = 5.9 + 7.4 = 13.3; terminations = 3 + 4 = 7 ends -> +7m
  //   with wastage = 13.3 * 1.1 = 14.63; + 7 = 21.63 -> round = 22m
  it("estimates loop-in + switch-loop cable metres per circuit, from hand-worked geometry", () => {
    const board = fitting({ id: "board", type: "switchboard", position: { x: 0, y: 0 } });

    const gpo1 = fitting({ id: "gpo1", type: "gpo", position: { x: 2, y: 0 }, circuit_id: "power" });
    const gpo2 = fitting({ id: "gpo2", type: "gpo", position: { x: 2, y: 3 }, circuit_id: "power" });
    const gpo3 = fitting({ id: "gpo3", type: "gpo", position: { x: 5, y: 3 }, circuit_id: "power" });

    const light1 = fitting({ id: "light1", type: "downlight", position: { x: 1, y: 1 }, circuit_id: "lighting" });
    const light2 = fitting({ id: "light2", type: "downlight", position: { x: 4, y: 1 }, circuit_id: "lighting" });
    const sw = fitting({
      id: "sw1",
      type: "switch",
      position: { x: 0, y: 1 },
      circuit_id: "lighting",
      specs: { gangs: [["light1", "light2"]] },
    });

    const canvases: CableRunCanvas[] = [{ id: "canvas-1", walls: [] }];
    const circuits: CableRunCircuit[] = [circuit("power", "Power"), circuit("lighting", "Lighting")];

    const result = estimateCableRuns({
      fittings: [board, gpo1, gpo2, gpo3, light1, light2, sw],
      circuits,
      canvases,
    });

    expect(result.perCircuit).toHaveLength(2);

    const power = result.perCircuit.find((c) => c.circuitId === "power")!;
    expect(power.pointsCount).toBe(3);
    expect(power.metres).toBe(21);
    expect(power.csaMm2).toBe("2.5"); // GPOs -> power -> default power cable
    expect(power.assumptions).toEqual([]); // real switchboard on the plan

    const lighting = result.perCircuit.find((c) => c.circuitId === "lighting")!;
    expect(lighting.pointsCount).toBe(2); // the switch is not a "point"
    expect(lighting.metres).toBe(22);
    expect(lighting.csaMm2).toBe("1.5"); // lights -> default lighting cable
    expect(lighting.assumptions.some((a) => a.includes("switch loop"))).toBe(true);

    // Grouped material rows, one per distinct cable size/type.
    expect(result.materialLines).toEqual(
      expect.arrayContaining([
        { item: "2.5 mm² TPS twin and earth (est.)", qty: 21, unit: "m", group: "Cable" },
        { item: "1.5 mm² TPS twin and earth (est.)", qty: 22, unit: "m", group: "Cable" },
      ]),
    );
  });

  // ── No switchboard on the plan: falls back to the room's nearest corner ─
  // Room walls form a 4m x 3m rectangle: (0,0)-(4,0)-(4,3)-(0,3).
  // GPO1 (1,1), GPO2 (3,1) on one circuit, no switchboard placed.
  //   Corners: (0,0),(0,3),(4,0),(4,3). Centroid of the two GPOs = (2,1).
  //   Manhattan distances to each corner: 3, 4, 3, 4 -> first minimum (0,0)
  //   wins the tie, so the fallback "board" = (0,0), drop = 0 (no real board).
  //   Chain from (0,0): ->GPO1 (dist 2) ->GPO2 (dist |3-1|+|1-1|=2)
  //   horizontal = 2+2 = 4; vertical = 0 + 2*(2.4-0.3=2.1) = 4.2; raw = 8.2
  //   terminations = 1 + 2 = 3 ends -> +3m
  //   with wastage = 8.2 * 1.1 = 9.02; + 3 = 12.02 -> round = 12m
  it("falls back to the plan's nearest corner and flags it when no switchboard is placed", () => {
    const gpo1 = fitting({ id: "gpo1", type: "gpo", position: { x: 1, y: 1 }, circuit_id: "power" });
    const gpo2 = fitting({ id: "gpo2", type: "gpo", position: { x: 3, y: 1 }, circuit_id: "power" });

    const canvases: CableRunCanvas[] = [
      {
        id: "canvas-1",
        walls: [
          { id: "w1", start: { x: 0, y: 0 }, end: { x: 4, y: 0 } },
          { id: "w2", start: { x: 4, y: 0 }, end: { x: 4, y: 3 } },
          { id: "w3", start: { x: 4, y: 3 }, end: { x: 0, y: 3 } },
          { id: "w4", start: { x: 0, y: 3 }, end: { x: 0, y: 0 } },
        ],
      },
    ];

    const result = estimateCableRuns({
      fittings: [gpo1, gpo2],
      circuits: [circuit("power", "Power")],
      canvases,
    });

    expect(result.perCircuit).toHaveLength(1);
    const power = result.perCircuit[0];
    expect(power.metres).toBe(12);
    expect(power.assumptions).toEqual(["No switchboard placed on this floor — measured from the nearest plan corner instead."]);
  });

  it("floors a tiny circuit at the 5m minimum", () => {
    const board = fitting({ id: "board", type: "switchboard", position: { x: 0, y: 0 } });
    const gpo = fitting({ id: "gpo1", type: "gpo", position: { x: 0.1, y: 0 }, circuit_id: "power" });
    const result = estimateCableRuns({
      fittings: [board, gpo],
      circuits: [circuit("power", "Power")],
      canvases: [{ id: "canvas-1", walls: [] }],
    });
    expect(result.perCircuit[0].metres).toBe(MIN_CIRCUIT_CABLE_METRES);
  });

  it("skips a circuit with nothing wired to it", () => {
    const result = estimateCableRuns({
      fittings: [],
      circuits: [circuit("empty", "Spare")],
      canvases: [{ id: "canvas-1", walls: [] }],
    });
    expect(result.perCircuit).toEqual([]);
    expect(result.materialLines).toEqual([]);
  });

  it("prefers cable_csa_mm2/cable_type columns over the inferred default when present", () => {
    const board = fitting({ id: "board", type: "switchboard", position: { x: 0, y: 0 } });
    const gpo = fitting({ id: "gpo1", type: "gpo", position: { x: 1, y: 0 }, circuit_id: "power" });
    const result = estimateCableRuns({
      fittings: [board, gpo],
      circuits: [{ ...circuit("power", "Power"), cable_csa_mm2: "4", cable_type: "TPS active + earth" }],
      canvases: [{ id: "canvas-1", walls: [] }],
    });
    expect(result.perCircuit[0].csaMm2).toBe("4");
    expect(result.perCircuit[0].cableType).toBe("TPS active + earth");
  });

  it("exposes its named constants for consumers/tests to reference", () => {
    expect(CABLE_WASTAGE_FACTOR).toBe(0.1);
    expect(TERMINATION_ALLOWANCE_M).toBe(1);
    expect(DEFAULT_CEILING_HEIGHT_M).toBe(2.4);
  });
});
