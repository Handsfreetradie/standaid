import { describe, it, expect } from "vitest";
import { classifyChunk, tagClauseNormativity, stripBreadcrumb } from "../../scripts/backfill-chunk-tags.mjs";

// Synthetic rows shaped exactly like existing (pre-migration) standard_chunks
// rows: clause_number, clause_title, content (breadcrumb + body, matching
// buildBreadcrumb()'s output), no chunk_type/is_normative. Proves the
// backfill's classifier reproduces the live tagger's intent (extraction.ts)
// for the categories that are recoverable from stored columns alone, and
// that it degrades honestly (is_normative: null) where it can't.

function row(clause_number: string | null, clause_title: string | null, body: string, standard = "AS/NZS 3000", version = "2018") {
  const clausePart = clause_number ? `Clause ${clause_number}${clause_title ? `: ${clause_title}` : ""}` : clause_title || "";
  const breadcrumb = `[${standard} ${version}]${clausePart ? ` ${clausePart}` : ""}\n\n`;
  return { id: "test-id", clause_number, clause_title, content: breadcrumb + body };
}

describe("tagClauseNormativity (copied from extraction.ts — must stay in sync)", () => {
  it("shall -> true", () => expect(tagClauseNormativity("Conductors shall be insulated.")).toBe(true));
  it("should, no shall -> false", () => expect(tagClauseNormativity("Conductors should be insulated.")).toBe(false));
  it("NOTE, no shall -> false", () => expect(tagClauseNormativity("NOTE: This is guidance only.")).toBe(false));
  it("neither -> null", () => expect(tagClauseNormativity("This describes the general arrangement.")).toBeNull());
  it("lowercase 'note that' is not a NOTE", () => expect(tagClauseNormativity("Please note that this varies.")).toBeNull());
});

describe("stripBreadcrumb", () => {
  it("removes the [STANDARD VERSION] Clause X: Title breadcrumb", () => {
    const r = row("2.5", "Selection", "Body text here.");
    expect(stripBreadcrumb(r.content)).toBe("Body text here.");
  });
});

describe("classifyChunk", () => {
  it("tags table chunks (100% reliable — clause_number is always 'TABLE <n>')", () => {
    const r = row("TABLE 8.1", "MINIMUM INSULATION RESISTANCE", "Circuit type | Minimum value\nAll circuits | 1 MΩ");
    const c = classifyChunk(r);
    expect(c.chunk_type).toBe("table");
    expect(c.is_normative).toBeNull();
  });

  it("tags figure chunks (100% reliable — clause_number is always 'FIGURE <n>')", () => {
    const r = row("FIGURE 3.1", "Zone dimensions for baths", "This figure appears on page 7.");
    const c = classifyChunk(r);
    expect(c.chunk_type).toBe("figure");
    expect(c.is_normative).toBeNull();
  });

  it("tags the document map chunk (100% reliable — fixed clause_title constant)", () => {
    const r = { id: "x", clause_number: null, clause_title: "Document map — sections and contents", content: "[AS/NZS 3000 2018] Document map — sections, appendices and contents of this standard\n\nSECTION 2 (page 5)" };
    const c = classifyChunk(r);
    expect(c.chunk_type).toBe("map");
    expect(c.is_normative).toBe(false);
  });

  it("tags definitions by clause_title (100% reliable)", () => {
    const r = row("1.3", "Definitions", "In this Standard, 'installation' means...");
    const c = classifyChunk(r);
    expect(c.chunk_type).toBe("definition");
    expect(c.is_normative).toBe(false);
  });

  it("tags definitions by clause_number 1.4.x (100% reliable)", () => {
    const r = row("1.4.2", "Terminology", "Some term means a specific thing.");
    const c = classifyChunk(r);
    expect(c.chunk_type).toBe("definition");
    expect(c.is_normative).toBe(false);
  });

  it("tags a NOTE-only chunk (100% reliable — content starts with NOTE)", () => {
    const r = row("2.5.1", "Clearances", "NOTE: This clearance is a guide only and may vary by manufacturer.");
    const c = classifyChunk(r);
    expect(c.chunk_type).toBe("note");
    expect(c.is_normative).toBe(false);
  });

  it("does NOT treat 'note that...' prose as a NOTE chunk", () => {
    const r = row("2.5.1", "Clearances", "Please note that clearances shall be maintained at all times.");
    const c = classifyChunk(r);
    expect(c.chunk_type).toBe("clause"); // falls through to the default bucket
    expect(c.is_normative).toBe(true); // contains "shall"
  });

  it("tags an appendix clause with no (Informative)/(Normative) marker as undeterminable", () => {
    const r = row("C2.1", "Maximum demand for domestic installations", "The maximum demand shall be calculated in accordance with Table C1.");
    const c = classifyChunk(r);
    expect(c.chunk_type).toBe("appendix");
    // Honest limitation: the marker lives on a sibling heading row, not here.
    expect(c.is_normative).toBeNull();
  });

  it("recovers is_normative for an appendix row that still carries its own marker", () => {
    const r = row("C1", "SCOPE", "(Informative)\nThis appendix sets out methods for calculating maximum demand.");
    const c = classifyChunk(r);
    expect(c.chunk_type).toBe("appendix");
    expect(c.is_normative).toBe(false);
  });

  it("tags a plain shall-clause as normative", () => {
    const r = row("2.5", "Selection of protective devices", "Protective devices shall be selected to match the load.");
    const c = classifyChunk(r);
    expect(c.chunk_type).toBe("clause");
    expect(c.is_normative).toBe(true);
  });

  it("tags a plain should-only clause as guidance", () => {
    const r = row("2.6", "Installation practice", "Cables should be run in the shortest practicable route.");
    const c = classifyChunk(r);
    expect(c.chunk_type).toBe("clause");
    expect(c.is_normative).toBe(false);
  });

  it("tags an ambiguous clause (neither shall/should/NOTE) as null", () => {
    const r = row("2.1", "Scope", "This clause covers the general arrangement of the installation.");
    const c = classifyChunk(r);
    expect(c.chunk_type).toBe("clause");
    expect(c.is_normative).toBeNull();
  });

  it("never re-derives a table/figure clause_number as an appendix, even though both are letter-ish", () => {
    // Sanity check the precedence order matches chunkSections(): table/figure
    // checks run before the appendix-shape check.
    const r = row("TABLE C1", "MAXIMUM DEMAND", "Load group A: lighting 3 A plus 2 A per additional circuit");
    expect(classifyChunk(r).chunk_type).toBe("table");
  });
});
