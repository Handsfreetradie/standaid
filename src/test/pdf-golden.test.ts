import { describe, it, expect } from "vitest";
import { assembleLines, type PositionedItem } from "../lib/pdf-text";
import {
  sortIntoSections,
  chunkSections,
  extractTableChunks,
  hasGoodTextQuality,
} from "../../supabase/functions/process-standard/extraction";

// Golden regression suite for the extraction traps found in the July 2026
// audit. Every case here corresponds to corruption that actually shipped:
// stripped decimals ("0.5 ohms" → "05 ohms"), fused table columns
// ("2.5 25 40" → "2.52540"), lost appendix clauses, and giant unembeddable
// chunks. If any of these fail, real answers WILL be wrong on site.

// Shorthand: an item at (x, y) with typical 10pt glyphs
const item = (str: string, x: number, y: number, w?: number, h = 10): PositionedItem => ({
  str,
  x,
  y,
  w: w ?? str.length * 5,
  h,
});

describe("golden: PDF line assembly (assembleLines)", () => {
  it("reassembles a kerned decimal split into separate items — the 0.5→05 bug", () => {
    // Real PDFs emit "0", ".", "5" as separate runs; the period's Y is often
    // fractionally different. The old fixed 3pt grid put it on another line
    // and join("") produced "05".
    const lines = assembleLines([
      item("maximum resistance of ", 50, 100.0, 110),
      item("0", 160, 100.49),
      item(".", 165, 100.51, 2.5), // straddles the old bucket boundary
      item("5", 167.5, 100.0),
      item(" ohms measured", 175, 100.02, 70),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("0.5 ohms");
    expect(lines[0]).not.toContain("05 ohms");
  });

  it("keeps table columns separated by real gaps — no fused numbers", () => {
    // One visual row of a cable table: cells are separate items with big
    // X-gaps. join("") used to produce "2.5254063".
    const lines = assembleLines([
      item("2.5", 60, 500),
      item("25", 140, 500),
      item("40", 220, 500),
      item("63", 300, 500),
    ]);
    expect(lines).toEqual(["2.5 25 40 63"]);
  });

  it("orders items by X within a line even when emitted out of order", () => {
    const lines = assembleLines([
      item("capacity", 120, 300, 40),
      item("carrying", 75, 300, 40),
      item("Current-", 30, 300, 40),
    ]);
    expect(lines).toEqual(["Current- carrying capacity"]);
  });

  it("separates genuinely different lines", () => {
    const lines = assembleLines([
      item("3.4.4 Cables buried direct in the ground", 30, 320, 200),
      item("An ambient soil temperature of 25°C applies.", 30, 306, 220),
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("3.4.4");
  });
});

describe("golden: full pipeline from assembled text to chunks", () => {
  // A realistic AS/NZS-shaped document exercising every audit trap at once:
  // decimals, an appendix with letter clauses, a captioned multi-row table,
  // and body text with NO blank lines (client extraction never emits them).
  const goldenDoc = [
    "[PAGE 40]",
    "SECTION 3 SELECTION AND INSTALLATION",
    "3.4.4 Cables buried direct in the ground",
    "For cables buried direct in the ground, the current-carrying capacities",
    "shall be based on an ambient soil temperature of 25°C, a depth of laying",
    "of 0.5 m measured from the ground surface, and a soil thermal resistivity",
    "of 1.2°C.m/W. The maximum earth fault-loop impedance shall not exceed",
    "0.5 ohms for the circuit under consideration.",
    "[PAGE 41]",
    "TABLE 3.1 — CURRENT-CARRYING CAPACITY, BURIED DIRECT",
    "Conductor size mm² | Two cables flat | Three cables trefoil",
    "2.5 | 36 | 31",
    "4 | 47 | 41",
    "6 | 59 | 51",
    "[PAGE 90]",
    "APPENDIX C",
    "C1 SCOPE",
    "This appendix sets out the method for calculating maximum demand.",
    "C2.1 Maximum demand for domestic installations",
    "The maximum demand shall be determined in accordance with Table C1.",
  ].join("\n");

  it("passes the quality gate (no corruption markers)", () => {
    expect(hasGoodTextQuality(goldenDoc.repeat(3))).toBe(true);
  });

  it("preserves decimals exactly through sectioning and chunking", () => {
    const chunks = chunkSections(sortIntoSections(goldenDoc), "AS/NZS 3000", "2018");
    const all = chunks.map((c) => c.content).join("\n");
    expect(all).toContain("0.5 m");
    expect(all).toContain("0.5 ohms");
    expect(all).toContain("1.2°C.m/W");
    expect(all).not.toMatch(/\b05 ohms\b/);
  });

  it("detects the clause, the appendix clauses, and their pages", () => {
    const sections = sortIntoSections(goldenDoc);
    const c344 = sections.find((s) => s.clauseNumber === "3.4.4");
    expect(c344?.pageNumber).toBe(40);
    expect(sections.some((s) => s.clauseNumber === "C1")).toBe(true);
    expect(sections.some((s) => s.clauseNumber === "C2.1")).toBe(true);
  });

  it("captures the captioned table with full body, right page, and placeholder", () => {
    const tables = extractTableChunks(goldenDoc, "AS/NZS 3000", "2018");
    const t31 = tables.find((t) => t.clause_number === "TABLE 3.1");
    expect(t31).toBeDefined();
    expect(t31!.page_number).toBe(41);
    expect(t31!.clause_title).toContain("CURRENT-CARRYING CAPACITY");
    expect(t31!.content).toContain("2.5 | 36 | 31"); // rows intact
    expect(t31!.content).toContain("transcription of this table will be generated shortly");
    // Appendix table referenced by C2.1 is captured too
    expect(tables.some((t) => t.clause_number === "TABLE C1")).toBe(true);
  });

  it("rejects the same document with fused-column corruption", () => {
    // Simulate the old join("") output: spaces removed around numbers
    const corrupted = goldenDoc
      .replace(/(\d) \| (\d)/g, "$1$2")
      .replace(/0\.5 ohms/g, "05 ohms")
      .replace(/ (?=[A-Z][a-z])/g, "");
    expect(hasGoodTextQuality(corrupted.repeat(3))).toBe(false);
  });
});
