import { describe, expect, it } from "vitest";
import { wayCountForTarget, runGroupFittingIds, type SetoutFitting } from "./setoutTypes";

type Sw = Pick<SetoutFitting, "id" | "specs">;

function sw(id: string, gangs: string[][]): Sw {
  return { id, specs: { gangs } };
}

// Reproduces the exact bug useDeleteSetoutFitting/useBulkDeleteSetoutFittings
// now prune against: a light gets deleted, but (on old data saved before
// that pruning existed) a switch's specs.gangs is left holding its id. Left
// unfiltered, two otherwise-unrelated switches that both still reference
// that one ghost id get wrongly merged into a single "run" — switchA never
// actually shares a light with switchB, only a dangling reference to
// something that no longer exists.
describe("wayCountForTarget / runGroupFittingIds — defensive against ghost ids", () => {
  const switchA = sw("switchA", [["ghostLight"]]);
  const switchB = sw("switchB", [["ghostLight", "realLight"]]);
  const switches = [switchA, switchB];
  const liveIds = new Set(["switchA", "switchB", "realLight"]); // ghostLight deleted

  it("without a liveIds filter, a shared ghost id wrongly merges two unrelated switches into one run", () => {
    expect(wayCountForTarget("ghostLight", switches)).toBe(2);
    expect(runGroupFittingIds("realLight", switches).has("switchA")).toBe(true);
  });

  it("with liveIds, the ghost id is never connected, so the switches are correctly independent", () => {
    expect(wayCountForTarget("ghostLight", switches, liveIds)).toBe(0);
    expect(wayCountForTarget("realLight", switches, liveIds)).toBe(1);
    const realLightRun = runGroupFittingIds("realLight", switches, undefined, liveIds);
    expect(realLightRun.has("switchB")).toBe(true);
    expect(realLightRun.has("switchA")).toBe(false);
  });
});
