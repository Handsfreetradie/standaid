import { describe, it, expect } from "vitest";
import {
  convertPdfToBase64,
  matchClauseHeading,
  sortIntoSections,
  chunkSections,
  extractTableChunks,
  extractFigureChunks,
  parseExtractedText,
  computeQualityScore,
  hasGoodTextQuality,
  buildDocumentMapChunk,
} from "../../supabase/functions/process-standard/extraction";

describe("convertPdfToBase64", () => {
  it("handles files far larger than the call-stack limit", () => {
    // The old spread-based version crashed with RangeError above ~125KB
    const bytes = new Uint8Array(2 * 1024 * 1024);
    bytes.set([0x25, 0x50, 0x44, 0x46]); // %PDF
    const b64 = convertPdfToBase64(bytes);
    expect(b64.length).toBeGreaterThan(0);
    expect(atob(b64.slice(0, 8)).startsWith("%PDF")).toBe(true);
  });

  it("round-trips content correctly", () => {
    const bytes = new TextEncoder().encode("AS/NZS 3000:2018 test content");
    expect(atob(convertPdfToBase64(bytes))).toBe("AS/NZS 3000:2018 test content");
  });
});

describe("matchClauseHeading", () => {
  it("matches genuine clause headings", () => {
    expect(matchClauseHeading("2.5 Selection of protective devices")).toEqual({
      number: "2.5",
      title: "Selection of protective devices",
    });
    expect(matchClauseHeading("8.3.9.2 Insulation resistance")).toEqual({
      number: "8.3.9.2",
      title: "Insulation resistance",
    });
    // Undotted top-level clauses are ALL CAPS in AU/NZ standards
    expect(matchClauseHeading("2 SCOPE AND GENERAL")).toEqual({
      number: "2",
      title: "SCOPE AND GENERAL",
    });
  });

  it("rejects body text that starts with a number", () => {
    expect(matchClauseHeading("30 Amp circuits shall be protected")).toBeNull();
    expect(matchClauseHeading("3 Phase supplies require")).toBeNull();
    expect(matchClauseHeading("1.5 Times the rated current")).toBeNull();
    expect(matchClauseHeading("0.4 Seconds maximum disconnection time")).toBeNull();
    expect(matchClauseHeading("16 A socket-outlets in damp situations")).toBeNull();
    expect(matchClauseHeading("3.5 kg/m² loading applies")).toBeNull();
  });

  it("rejects table-of-contents entries with dotted leaders", () => {
    // These created ~500 junk chunks per standard that shadowed real clauses
    expect(matchClauseHeading("8.3 TESTING .............................. 419")).toBeNull();
    expect(matchClauseHeading("2.2 ARRANGEMENT OF INSTALLATION..........45")).toBeNull();
  });
});

describe("sortIntoSections + chunkSections", () => {
  const sample = [
    "[PAGE 3]",
    "SECTION 2 GENERAL ARRANGEMENT",
    "Intro text for the section.",
    "2.1 Scope",
    "This clause covers the scope of the section in detail.",
    "[PAGE 4]",
    "2.2 Application",
    "Application details continue here with enough length to keep the chunk.",
  ].join("\n");

  it("tracks pages from [PAGE N] markers and detects clauses", () => {
    const sections = sortIntoSections(sample);
    const clause21 = sections.find((s) => s.clauseNumber === "2.1");
    const clause22 = sections.find((s) => s.clauseNumber === "2.2");
    expect(clause21?.pageNumber).toBe(3);
    expect(clause22?.pageNumber).toBe(4);
  });

  it("prefixes chunks with the standard breadcrumb", () => {
    const chunks = chunkSections(sortIntoSections(sample), "AS/NZS 3000", "2018");
    const c = chunks.find((ch) => ch.clause_number === "2.1");
    expect(c?.content.startsWith("[AS/NZS 3000 2018] Clause 2.1: Scope")).toBe(true);
  });
});

describe("extractTableChunks", () => {
  const sample = [
    "[PAGE 10]",
    "TABLE 8.1 — MINIMUM INSULATION RESISTANCE",
    "Circuit type | Minimum value",
    "All circuits | 1 MΩ",
    "[PAGE 42]",
    "The insulation resistance shall comply with Table 8.1 as noted.",
    "[PAGE 55]",
    "Refer to Table 8.1 for minimum values, and see Table 9.2 for test currents.",
  ].join("\n");

  it("creates exactly one chunk per table, anchored to the caption page", () => {
    const chunks = extractTableChunks(sample, "AS/NZS 3000", "2018");
    const t81 = chunks.filter((c) => c.clause_number === "TABLE 8.1");
    expect(t81).toHaveLength(1);
    expect(t81[0].page_number).toBe(10); // caption page, not a reference page
    expect(t81[0].clause_title).toBe("MINIMUM INSULATION RESISTANCE");
  });

  it("still captures reference-only tables once", () => {
    const chunks = extractTableChunks(sample, "AS/NZS 3000", "2018");
    const t92 = chunks.filter((c) => c.clause_number === "TABLE 9.2");
    expect(t92).toHaveLength(1);
    expect(t92[0].page_number).toBe(55);
  });

  it("captures appendix tables with letter prefixes (TABLE C1)", () => {
    const doc = [
      "[PAGE 555]",
      "TABLE C1",
      "MAXIMUM DEMAND — SINGLE AND MULTIPLE DOMESTIC ELECTRICAL INSTALLATIONS",
      "Load group A: lighting 3 A plus 2 A per additional circuit",
      "[PAGE 560]",
      "See Table C2 for energy demand values.",
    ].join("\n");
    const chunks = extractTableChunks(doc, "AS/NZS 3000", "2018");
    const c1 = chunks.find((c) => c.clause_number === "TABLE C1");
    expect(c1).toBeDefined();
    expect(c1!.page_number).toBe(555);
    expect(c1!.clause_title).toContain("MAXIMUM DEMAND");
    expect(chunks.some((c) => c.clause_number === "TABLE C2")).toBe(true);
  });

  it("prefers the uppercase caption over a sentence starting with 'Table X.X'", () => {
    // Found in the real AS/NZS 3000: "Table 8.1 contains calculated examples..."
    // starts a line on p318 but the real TABLE 8.1 caption is on p431.
    const doc = [
      "[PAGE 318]",
      "Table 8.1 contains calculated examples of the maximum values of earth",
      "[PAGE 431]",
      "TABLE   8.1",
      "MAXIMUM EARTH FAULT-LOOP IMPEDANCE",
    ].join("\n");
    const chunks = extractTableChunks(doc, "AS/NZS 3000", "2018");
    const t81 = chunks.filter((c) => c.clause_number === "TABLE 8.1");
    expect(t81).toHaveLength(1);
    expect(t81[0].page_number).toBe(431);
  });
});

describe("extractFigureChunks", () => {
  it("dedupes figures and prefers the caption", () => {
    const sample = [
      "[PAGE 7]",
      "Figure 3.1 — Zone dimensions for baths",
      "diagram content",
      "[PAGE 20]",
      "See Figures 3.1 and 3.4 for details.",
    ].join("\n");
    const chunks = extractFigureChunks(sample, "AS/NZS 3000", "2018");
    const f31 = chunks.filter((c) => c.clause_number === "FIGURE 3.1");
    expect(f31).toHaveLength(1);
    expect(f31[0].page_number).toBe(7);
    expect(f31[0].clause_title).toBe("Zone dimensions for baths");
    expect(chunks.some((c) => c.clause_number === "FIGURE 3.4")).toBe(true);
  });
});

describe("parseExtractedText", () => {
  it("splits client-extracted text on page markers", () => {
    const raw = "[PAGE 1]\nfirst page content here\n[PAGE 2]\nsecond page content here";
    const result = parseExtractedText(raw);
    expect(result.totalPages).toBe(2);
    expect(result.pagesWithContent).toBe(2);
    expect(result.text).not.toContain("[PAGE");
  });
});

describe("computeQualityScore", () => {
  it("scores a realistic clause-dense extract well above the 35 reject line", () => {
    const good = Array.from({ length: 40 }, (_, i) =>
      `${(i % 8) + 1}.${(i % 5) + 1} Requirements for circuit ${i} rated at 20 A with 2.5 mm conductors installed per the wiring rules.`
    ).join("\n");
    expect(computeQualityScore(good, 10, 10)).toBeGreaterThan(35);
  });

  it("scores empty extraction at or below the reject line", () => {
    expect(computeQualityScore("", 100, 0)).toBeLessThan(35);
  });
});

describe("hasGoodTextQuality", () => {
  const cleanText = Array.from({ length: 40 }, (_, i) =>
    `${(i % 8) + 1}.${(i % 5) + 1} Requirements for circuit ${i} rated at 20 A with 2.5 mm conductors and a maximum resistance of 0.5 ohms measured at the switchboard.`
  ).join("\n");

  it("passes clean standards text", () => {
    expect(hasGoodTextQuality(cleanText)).toBe(true);
  });

  it("fails text with fused digit-word tokens (join-without-spaces corruption)", () => {
    const fused = Array.from({ length: 40 }, (_, i) =>
      `${(i % 8) + 1}.${(i % 5) + 1}Requirements for circuit ${i} rated at 20A with 2.5Selection of conductors shall comply with 0.5Where the installation permits.`
    ).join("\n");
    expect(hasGoodTextQuality(fused)).toBe(false);
  });

  it("fails text with fused word-word tokens", () => {
    const fused = Array.from({ length: 40 }, (_, i) =>
      `${(i % 8) + 1}.${(i % 5) + 1} Requirements 20 A for theInstallation of circuitProtection and cableSelection in dampSituations near swimmingPools.`
    ).join("\n");
    expect(hasGoodTextQuality(fused)).toBe(false);
  });

  it("fails text with truncated decimals (glyph-swallowed digits)", () => {
    const truncated = Array.from({ length: 40 }, (_, i) =>
      `${(i % 8) + 1}.${(i % 5) + 1} The maximum resistance shall be 0. measured with a resistance of 1. at the point of supply for circuit ${i}.`
    ).join("\n");
    expect(hasGoodTextQuality(truncated)).toBe(false);
  });
});

describe("appendix clause detection", () => {
  it("detects letter-prefixed clauses inside an appendix", () => {
    const text = [
      "[PAGE 90]",
      "APPENDIX C",
      "C1 SCOPE",
      "This appendix sets out methods for calculating maximum demand.",
      "C2.1 Maximum demand for domestic installations",
      "The maximum demand shall be calculated in accordance with Table C1.",
    ].join("\n");
    const sections = sortIntoSections(text);
    const nums = sections.map((s) => s.clauseNumber);
    expect(nums).toContain("C1");
    expect(nums).toContain("C2.1");
  });

  it("ignores letter-number cross-references outside appendices", () => {
    const text = [
      "[PAGE 10]",
      "SECTION 2 GENERAL",
      "2.1 SCOPE",
      "B1 Requirements are detailed in Appendix B for special cases.",
    ].join("\n");
    const sections = sortIntoSections(text);
    expect(sections.map((s) => s.clauseNumber)).not.toContain("B1");
  });
});

describe("extractTableChunks body capture", () => {
  it("captures the full table body up to the next heading (no 500-char cap)", () => {
    const rows = Array.from({ length: 40 }, (_, i) =>
      `${i + 1} 2.5 25 ${30 + i} 0.${i} 41 55 63 72 80 95 110 125 140 155`
    ).join("\n");
    const text = [
      "[PAGE 12]",
      "TABLE 4.1 — CURRENT-CARRYING CAPACITY",
      rows,
      "4.2 CONDUCTOR OPERATING TEMPERATURE",
      "Body of the next clause.",
    ].join("\n");
    const chunks = extractTableChunks(text, "AS 3008.1.1", "2017");
    const t = chunks.find((c) => c.clause_number === "TABLE 4.1");
    expect(t).toBeDefined();
    expect(t!.content.length).toBeGreaterThan(800);
    expect(t!.content).not.toContain("CONDUCTOR OPERATING TEMPERATURE");
    expect(t!.page_number).toBe(12);
    expect(t!.content).toContain("transcription of this table will be generated shortly");
  });

  it("demotes a wrapped 'Table N' sentence reference and takes no junk title", () => {
    const text = [
      "[PAGE 3]",
      "the three-phase voltage drop is given in",
      "Table 40",
      "as 0.563 mV/A.m.",
      "The voltage drop on the neutral conductor is calculated separately.",
    ].join("\n");
    const chunks = extractTableChunks(text, "AS 3008.1.1", "2017");
    const t = chunks.find((c) => c.clause_number === "TABLE 40");
    expect(t).toBeDefined();
    expect(t!.clause_title).toBeNull();
    expect(t!.content).not.toContain("transcription of this table");
  });
});

describe("splitOversized (hard chunk cap)", () => {
  it("splits blank-line-free text into chunks under the cap", () => {
    // Client-extracted text has no blank lines — the paragraph splitter used
    // to no-op and produce one giant chunk, only the first 8000 chars of
    // which ever got embedded.
    const lines = Array.from({ length: 300 }, (_, i) =>
      `Requirement ${i}: conductors shall be selected per the relevant table with a rating of ${i} A.`
    ).join("\n"); // ~28,000 chars, zero blank lines
    const sections = sortIntoSections(`[PAGE 5]\n2.1 SELECTION OF CABLES\n${lines}`);
    const chunks = chunkSections(sections, "AS/NZS 3000", "2018");
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) {
      expect(c.content.length).toBeLessThan(3000);
    }
    // No content silently dropped: every requirement line survives somewhere
    const all = chunks.map((c) => c.content).join("\n");
    expect(all).toContain("Requirement 0:");
    expect(all).toContain("Requirement 299:");
  });
});

describe("buildDocumentMapChunk", () => {
  it("assembles a map from sections, appendices and top-level clauses", () => {
    const text = [
      "[PAGE 5]",
      "SECTION 2 GENERAL ARRANGEMENT AND PROTECTION",
      "2.1 SCOPE",
      "Scope body text.",
      "2.2 ARRANGEMENT OF INSTALLATION",
      "Arrangement body text.",
      "2.2.1 Detail sub-clause",
      "Sub body.",
      "[PAGE 90]",
      "SECTION 6 DAMP SITUATIONS",
      "6.3 Swimming pools and spas",
      "Pool body text.",
      "[PAGE 200]",
      "APPENDIX P",
      "P1 Electric vehicle charging",
      "EV body text.",
    ].join("\n");
    const map = buildDocumentMapChunk(sortIntoSections(text), "AS/NZS 3000", "2018");
    expect(map).not.toBeNull();
    expect(map!.chunk_index).toBe(0);
    expect(map!.content).toContain("SECTION 2 GENERAL ARRANGEMENT AND PROTECTION (page 5)");
    expect(map!.content).toContain("SECTION 6 DAMP SITUATIONS (page 90)");
    expect(map!.content).toContain("APPENDIX P (page 200)");
    expect(map!.content).toContain("6.3 Swimming pools and spas");
    expect(map!.content).not.toContain("2.2.1"); // deep clauses excluded
  });

  it("returns null for unstructured documents", () => {
    const map = buildDocumentMapChunk(sortIntoSections("Just some prose\nwith no headings at all."), "AS X", "");
    expect(map).toBeNull();
  });
});
