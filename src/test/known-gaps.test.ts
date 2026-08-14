import { describe, it, expect } from "vitest";
import {
  extractSignificantTerms,
  extractExplicitRefs,
  matchesFailedItem,
  describeFailedItem,
  buildKnownGapsContext,
  type FailedItem,
} from "../../supabase/functions/query/known-gaps";

// Guards the "known gap" detection that intercepts the refusal gate — a
// false positive here means falsely telling a user something failed, so
// precision matters more than recall.

const item = (over: Partial<FailedItem> = {}): FailedItem => ({
  standard_id: "std-1",
  clause_number: "TABLE 5.1",
  clause_title: "Minimum Size of Earthing Conductor",
  page_number: 42,
  ...over,
});

describe("extractExplicitRefs", () => {
  it("matches 'table N' and 'figure N' case-insensitively", () => {
    expect(extractExplicitRefs("show me table 5.1")).toEqual(["5.1"]);
    expect(extractExplicitRefs("what does Figure 3.2 show")).toEqual(["3.2"]);
    expect(extractExplicitRefs("FIGURE B2 and table C1")).toEqual(["B2", "C1"]);
  });

  it("finds nothing in a question with no explicit reference", () => {
    expect(extractExplicitRefs("what is the minimum earth size")).toEqual([]);
  });
});

describe("matchesFailedItem — explicit reference", () => {
  it("matches on an exact explicit table number", () => {
    const failed = item({ clause_number: "TABLE 5.1", clause_title: null });
    expect(matchesFailedItem(failed, new Set(), ["5.1"])).toBe(true);
  });

  it("does not match a different number", () => {
    const failed = item({ clause_number: "TABLE 5.1", clause_title: null });
    expect(matchesFailedItem(failed, new Set(), ["5.2"])).toBe(false);
  });
});

describe("matchesFailedItem — caption overlap", () => {
  it("matches when most of the caption's distinctive words appear in the question", () => {
    const failed = item({ clause_title: "Minimum Size of Earthing Conductor" });
    const terms = extractSignificantTerms("what is the minimum earth conductor size");
    expect(matchesFailedItem(failed, terms, [])).toBe(true);
  });

  it("does not match on a single shared generic word", () => {
    const failed = item({ clause_title: "Minimum Size of Earthing Conductor" });
    // "size" alone is one shared word out of three distinctive title terms —
    // below the >=2-and-50% bar.
    const terms = extractSignificantTerms("what size cable do I need for a shed");
    expect(matchesFailedItem(failed, terms, [])).toBe(false);
  });

  it("does not match a genuinely unrelated question", () => {
    const failed = item({ clause_title: "Minimum Size of Earthing Conductor" });
    const terms = extractSignificantTerms("can I install a switchboard near a pool");
    expect(matchesFailedItem(failed, terms, [])).toBe(false);
  });

  it("returns false when the failed item has no caption and no explicit ref matches", () => {
    const failed = item({ clause_title: null });
    const terms = extractSignificantTerms("what is the minimum earth conductor size");
    expect(matchesFailedItem(failed, terms, [])).toBe(false);
  });
});

describe("describeFailedItem — garbage-caption guard", () => {
  // Confirmed live against Kyle's real AS/NZS 3000: several permanently-
  // failed tables carry an extraction-artifact clause_title, not a real
  // caption. Without a guard, the sentence read as visibly broken.
  it("omits a caption that's just punctuation", () => {
    const failed = item({ clause_number: "TABLE C1", clause_title: "]" });
    const result = describeFailedItem(failed, "AS/NZS 3000");
    expect(result.sentence).not.toContain(" — ]");
    expect(result.sentence).toContain("Table C1 in AS/NZS 3000");
  });

  it("omits a caption that's a single dot", () => {
    const failed = item({ clause_number: "TABLE 3.1", clause_title: "." });
    const result = describeFailedItem(failed, "AS/NZS 3000");
    expect(result.sentence).not.toContain(" — .");
  });

  it("omits a caption that's letter-digit noise with no real words", () => {
    const failed = item({ clause_number: "TABLE S20S", clause_title: "11S5 S3 S1" });
    const result = describeFailedItem(failed, "AS/NZS 3000");
    expect(result.sentence).not.toContain("11S5");
  });

  it("still includes a real caption", () => {
    const failed = item({ clause_number: "TABLE 5.1", clause_title: "Minimum Size of Earthing Conductor" });
    const result = describeFailedItem(failed, "AS/NZS 3000");
    expect(result.sentence).toContain("Minimum Size of Earthing Conductor");
  });

  it("does not caption-match on a garbage title even with strong question overlap", () => {
    // Guards the matching side too, not just the display side.
    const failed = item({ clause_number: "TABLE 125", clause_title: ">100>100>100>100>100" });
    const terms = extractSignificantTerms("what does table 100 100 100 mean");
    expect(matchesFailedItem(failed, terms, [])).toBe(false);
  });
});

describe("buildKnownGapsContext — garbage-caption guard", () => {
  it("omits punctuation captions from the context block", () => {
    const ctx = buildKnownGapsContext(
      [item({ clause_number: "TABLE C1", clause_title: "]" })],
      () => "AS/NZS 3000",
    );
    expect(ctx).not.toContain(": ]");
    expect(ctx).toContain("Table C1 (AS/NZS 3000)");
  });
});

describe("describeFailedItem", () => {
  it("describes a table plainly, naming the standard and caption", () => {
    const failed = item({ clause_number: "TABLE 5.1", clause_title: "Minimum Size of Earthing Conductor" });
    const result = describeFailedItem(failed, "AS/NZS 3000");
    expect(result.kind).toBe("Table");
    expect(result.number).toBe("5.1");
    expect(result.sentence).toContain("Table 5.1");
    expect(result.sentence).toContain("Minimum Size of Earthing Conductor");
    expect(result.sentence).toContain("AS/NZS 3000");
    expect(result.sentence).toContain("wasn't able to automatically read");
  });

  it("describes a figure as a diagram, not a table", () => {
    const failed = item({ clause_number: "FIGURE 2.3", clause_title: "Main earthing arrangement" });
    const result = describeFailedItem(failed, "AS/NZS 3000");
    expect(result.kind).toBe("Figure");
    expect(result.sentence).toContain("diagram");
  });
});

describe("buildKnownGapsContext", () => {
  it("returns empty string for no matches", () => {
    expect(buildKnownGapsContext([], () => "AS/NZS 3000")).toBe("");
  });

  it("lists each match with standard, label and caption", () => {
    const ctx = buildKnownGapsContext(
      [item({ clause_number: "TABLE 5.1", clause_title: "Minimum Size of Earthing Conductor" })],
      () => "AS/NZS 3000",
    );
    expect(ctx).toContain("[KNOWN GAPS");
    expect(ctx).toContain("Table 5.1");
    expect(ctx).toContain("Minimum Size of Earthing Conductor");
    expect(ctx).toContain("AS/NZS 3000");
  });
});
