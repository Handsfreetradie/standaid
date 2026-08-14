import { describe, it, expect } from "vitest";
import { formatFailedLabels } from "../pages/Standards";

// This message is what tells a tradie whether a permanently-failed
// figure/table matters to them — a raw count gives no way to judge that.

describe("formatFailedLabels", () => {
  it("title-cases raw clause_number labels", () => {
    expect(formatFailedLabels(["TABLE 5.1"], 1)).toBe("Table 5.1");
    expect(formatFailedLabels(["FIGURE 3.2"], 1)).toBe("Figure 3.2");
  });

  it("joins up to 3 labels with commas", () => {
    expect(formatFailedLabels(["TABLE 5.1", "FIGURE 3.2"], 2)).toBe("Table 5.1, Figure 3.2");
    expect(formatFailedLabels(["TABLE 5.1", "FIGURE 3.2", "TABLE 8.2"], 3)).toBe(
      "Table 5.1, Figure 3.2, Table 8.2",
    );
  });

  it("shows the first 3 and counts the rest", () => {
    expect(
      formatFailedLabels(["TABLE 5.1", "FIGURE 3.2", "TABLE 8.2", "FIGURE 4.1", "TABLE 9.3"], 5),
    ).toBe("Table 5.1, Figure 3.2, Table 8.2 and 2 more");
  });

  it("falls back to the count when labels haven't been backfilled yet", () => {
    expect(formatFailedLabels([], 7)).toBe("7 figures/tables");
    expect(formatFailedLabels(null, 1)).toBe("1 figure/table");
    expect(formatFailedLabels(undefined, 1)).toBe("1 figure/table");
  });

  it("drops blank/falsy entries from a partially-populated array", () => {
    expect(formatFailedLabels(["TABLE 5.1", "", null as unknown as string], 1)).toBe("Table 5.1");
  });
});
