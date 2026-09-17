import { describe, expect, it } from "vitest";
import { aggregateMaterials, aggregateMaterialsWithCableRuns } from "./setoutMaterials";
import type { CableRunCanvas, CableRunCircuit, CableRunFitting } from "./setoutCableRuns";

function fitting(overrides: Partial<CableRunFitting> & Pick<CableRunFitting, "id" | "type" | "position">): CableRunFitting {
  return { circuit_id: null, canvas_id: "canvas-1", specs: {}, ...overrides };
}

describe("aggregateMaterialsWithCableRuns", () => {
  it("keeps aggregateMaterials' own rows untouched and appends cable rows on top", () => {
    const board = fitting({ id: "board", type: "switchboard", position: { x: 0, y: 0 } });
    const gpo = fitting({ id: "gpo1", type: "gpo", position: { x: 2, y: 0 }, circuit_id: "power" });

    const fittings = [board, gpo];
    const circuits: CableRunCircuit[] = [{ id: "power", label: "Power", circuit_type: "standard", specs: {} }];
    const canvases: CableRunCanvas[] = [{ id: "canvas-1", walls: [] }];

    const plainLines = aggregateMaterials(fittings);
    const { lines, cableRuns } = aggregateMaterialsWithCableRuns(fittings, circuits, canvases);

    // Every row aggregateMaterials produces on its own is still present,
    // unchanged — this function only ever adds rows, never rewrites them.
    for (const line of plainLines) {
      expect(lines).toContainEqual(line);
    }

    // Plus the new cable rows, grouped under "Cable".
    const cableLines = lines.filter((l) => l.group === "Cable");
    expect(cableLines).toHaveLength(1);
    expect(cableLines[0].unit).toBe("m");
    expect(cableLines[0].item).toContain("mm²");

    // And the per-circuit breakdown for the report.
    expect(cableRuns).toHaveLength(1);
    expect(cableRuns[0]).toMatchObject({ circuitId: "power", label: "Power", pointsCount: 1 });
    expect(cableRuns[0].metres).toBeGreaterThanOrEqual(5);
  });

  it("returns no cable rows when no circuit has any fittings on it", () => {
    const { lines, cableRuns } = aggregateMaterialsWithCableRuns(
      [],
      [{ id: "empty", label: "Spare", circuit_type: "standard", specs: {} }],
      [{ id: "canvas-1", walls: [] }],
    );
    expect(lines.filter((l) => l.group === "Cable")).toEqual([]);
    expect(cableRuns).toEqual([]);
  });
});
