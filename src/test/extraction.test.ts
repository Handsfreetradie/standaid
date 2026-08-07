import { describe, it, expect } from "vitest";
import {
  convertPdfToBase64,
  matchClauseHeading,
  isSectionHeading,
  sortIntoSections,
  chunkSections,
  extractTableChunks,
  extractFigureChunks,
  parseExtractedText,
  computeQualityScore,
  hasGoodTextQuality,
  buildDocumentMapChunk,
  stripRepeatedPageFurniture,
  findGapPages,
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

describe("NCC structure detection", () => {
  const nccDoc = [
    "[PAGE 30]",
    "SECTION C FIRE RESISTANCE",
    "C1P1 Fire spread",
    "A building must avoid the spread of fire to exits and adjoining buildings.",
    "C3D5 Fire-resistance of building elements",
    "Building elements must have the required FRL per Specification 5.",
    "[PAGE 60]",
    "Part 3.7 Fire safety",
    "3.7.2.4 Smoke alarm location",
    "Smoke alarms must be installed on or near the ceiling.",
    "P2.3.1 Protection from the spread of fire",
    "A Class 1 building must be protected from the spread of fire.",
    "[PAGE 90]",
    "SECTION H SPECIAL USE BUILDINGS",
    "H1D4 Entertainment venues",
    "Requirements for stages and backstage areas apply.",
  ].join("\n");

  it("detects lettered sections, NCC 2022 codes, and legacy clauses", () => {
    const sections = sortIntoSections(nccDoc);
    const nums = sections.map((s) => s.clauseNumber);
    const headings = sections.map((s) => s.heading);
    expect(headings).toContain("SECTION C FIRE RESISTANCE");
    expect(headings).toContain("Part 3.7 Fire safety");
    expect(nums).toContain("C1P1");
    expect(nums).toContain("C3D5");
    expect(nums).toContain("3.7.2.4");
    expect(nums).toContain("P2.3.1");
  });

  it("builds a document map from NCC structure", () => {
    const map = buildDocumentMapChunk(sortIntoSections(nccDoc), "NCC Volume Two", "2022");
    expect(map).not.toBeNull();
    expect(map!.content).toContain("SECTION C FIRE RESISTANCE (page 30)");
    expect(map!.content).toContain("C3D5 Fire-resistance of building elements");
  });

  it("does not treat prose mentioning sections as headings", () => {
    const sections = sortIntoSections([
      "[PAGE 5]",
      "2.1 SCOPE",
      "Section C of the code covers fire. Part 3 also applies here.",
    ].join("\n"));
    expect(sections.map((s) => s.heading)).not.toContain("Section C of the code covers fire. Part 3 also applies here.");
  });
});

describe("amendment asterisk stripping", () => {
  it("matches clause headings behind a leading amendment mark", () => {
    // AS/NZS 3000:2018 Amendment 1/2 print a margin "*" beside changed
    // clauses; extraction puts it at line start and hid ~7% of clauses
    expect(matchClauseHeading("* 2.9.2 Type")).toEqual({ number: "2.9.2", title: "Type" });
    expect(matchClauseHeading("* 2.5.3.2 Position of overload protective device—General arrangement")).toEqual({
      number: "2.5.3.2",
      title: "Position of overload protective device—General arrangement",
    });
    expect(matchClauseHeading("*7.2.1 General")).toEqual({ number: "7.2.1", title: "General" });
    expect(matchClauseHeading("* B5.2.3 Fault protection", true)).toEqual({ number: "B5.2.3", title: "Fault protection" });
  });

  it("matches section headings behind a leading amendment mark", () => {
    expect(isSectionHeading("* SECTION 7 SPECIAL INSTALLATIONS")).toBe(true);
    expect(isSectionHeading("* APPENDIX B")).toBe(true);
  });

  it("still rejects non-headings and markdown bold captions", () => {
    expect(matchClauseHeading("* 1.5 Times the rated current")).toBeNull();
    expect(matchClauseHeading("* bullet point prose, not a clause")).toBeNull();
    // "**TABLE 8.1" is caption territory (tolerated by the caption patterns),
    // never a clause heading — the single-mark strip must not consume it
    expect(matchClauseHeading("**TABLE 8.1 — LIMITS**")).toBeNull();
  });

  it("opens a section for an asterisk-marked clause instead of merging it", () => {
    const sections = sortIntoSections([
      "[PAGE 90]",
      "2.9.1 General",
      "Switchboard requirements apply generally to the installation as described.",
      "* 2.9.2 Type",
      "Every switchboard shall be of a type suitable for the installation conditions.",
    ].join("\n"));
    expect(sections.map((s) => s.clauseNumber)).toContain("2.9.2");
  });
});

describe("stripRepeatedPageFurniture", () => {
  // Synthetic 25-page doc: every page carries licence boilerplate, COPYRIGHT
  // and a running header (leading page number form), plus unique body text
  const licence = "Licensed to Williams Electrical Service Pty Ltd on 27-Jun-2018. 3 concurrent user network licenses.";
  const permission = "Get permission to copy from or network this publication www.saiglobal.com/licensing";
  const doc = Array.from({ length: 25 }, (_, i) => [
    `[PAGE ${i + 1}]`,
    `${i + 1} AS/NZS 3000:2018`,
    `2.${i + 1} Clause heading for page ${i + 1}`,
    `Unique body text for page ${i + 1} describing installation requirements in detail.`,
    licence,
    permission,
    "COPYRIGHT",
  ].join("\n")).join("\n");

  it("drops licence, copyright and running-header lines", () => {
    const stripped = stripRepeatedPageFurniture(doc);
    expect(stripped).not.toContain(licence);
    expect(stripped).not.toContain(permission);
    expect(stripped).not.toContain("COPYRIGHT");
    expect(stripped).not.toContain("3 AS/NZS 3000:2018");
  });

  it("keeps body text, headings, captions and [PAGE N] markers", () => {
    // Repeat a clause heading and a table caption on every page — structure
    // must survive the frequency threshold
    const withStructure = doc.replace(/COPYRIGHT/g, "COPYRIGHT\n8.3 TESTING\nTABLE 8.1 — LIMITS");
    const stripped = stripRepeatedPageFurniture(withStructure);
    expect(stripped).toContain("Unique body text for page 12");
    expect(stripped).toContain("2.12 Clause heading for page 12");
    expect(stripped).toContain("[PAGE 12]");
    expect(stripped).toContain("8.3 TESTING");
    expect(stripped).toContain("TABLE 8.1 — LIMITS");
  });

  it("pools trailing-dot variants of the same line", () => {
    // Real PDFs stamp the licence line with a trailing full stop on most pages
    // but not all; each variant alone can sit under the page threshold
    const variantDoc = Array.from({ length: 25 }, (_, i) => [
      `[PAGE ${i + 1}]`,
      i % 3 === 0 ? `${licence}.` : licence,
      `Unique body text for page ${i + 1}.`,
    ].join("\n")).join("\n");
    const stripped = stripRepeatedPageFurniture(variantDoc);
    expect(stripped).not.toContain(licence);
    expect(stripped).toContain("Unique body text for page 7");
  });

  it("catches a watermark confined to front-matter pages only (real AS3017 pattern)", () => {
    // Real observed pattern from AS/NZS 3017:2007 (personal licence, not a
    // network licence): the licence line is stamped on pages 2-5 and 7-12
    // (10 of the first 12 pages) but never appears again in the remaining 45
    // pages of actual technical content — nowhere near the whole-document 30%
    // bar (10/57 ≈ 17.5%), which is exactly why it survived the first fix.
    const frontMatterLicence =
      "Licensed to Ms Nyree Smart on 28 April 2011. 1 user personal user licence only. Storage, distribution or use on network prohibited (10203309).";
    const pages: string[] = [];
    for (let i = 1; i <= 57; i++) {
      const bodyLines = [`Technical content unique to page ${i} describing a test procedure in detail.`];
      // Watermark only on pages 2-5 and 7-12 (10 of the first 12) — never after
      if ((i >= 2 && i <= 5) || (i >= 7 && i <= 12)) bodyLines.push(frontMatterLicence);
      pages.push([`[PAGE ${i}]`, ...bodyLines].join("\n"));
    }
    const doc = pages.join("\n");
    const stripped = stripRepeatedPageFurniture(doc);
    expect(stripped).not.toContain(frontMatterLicence);
    expect(stripped).toContain("Technical content unique to page 40");
    expect(stripped).toContain("[PAGE 40]");
  });

  it("does not strip technical text that happens to repeat only within the front-matter window", () => {
    // A phrase repeated a handful of times only near the start of the document
    // (below the front-matter threshold) must survive — guards against the
    // new pass being trigger-happy on short, coincidentally-repeated phrases.
    const pages: string[] = [];
    for (let i = 1; i <= 57; i++) {
      const bodyLines = [`Technical content unique to page ${i}.`];
      if (i === 3 || i === 9) bodyLines.push("See the referenced installation diagram for details.");
      pages.push([`[PAGE ${i}]`, ...bodyLines].join("\n"));
    }
    const stripped = stripRepeatedPageFurniture(pages.join("\n"));
    expect(stripped).toContain("See the referenced installation diagram for details.");
  });

  it("leaves short documents untouched", () => {
    const shortDoc = Array.from({ length: 5 }, (_, i) => [
      `[PAGE ${i + 1}]`,
      licence,
      `Body text for page ${i + 1}.`,
    ].join("\n")).join("\n");
    expect(stripRepeatedPageFurniture(shortDoc)).toBe(shortDoc);
  });
});

describe("findGapPages", () => {
  const REAL_CONTENT = "This page has plenty of real transcribed body text on it, well past the threshold.";

  // 200-page doc with real content everywhere except the given 1-indexed
  // page numbers, which are left empty (simulating a silently-dropped page).
  function docWithGaps(gapPages: number[], total = 200): string[] {
    const pages = Array.from({ length: total }, () => REAL_CONTENT);
    for (const p of gapPages) pages[p - 1] = "";
    return pages;
  }

  it("returns nothing for an empty pages array", () => {
    expect(findGapPages([])).toEqual([]);
  });

  it("returns nothing when every page has real content", () => {
    expect(findGapPages(docWithGaps([]))).toEqual([]);
  });

  it("finds a single isolated gap page in the middle of the document", () => {
    expect(findGapPages(docWithGaps([100]))).toEqual([100]);
  });

  it("excludes a gap within the front-matter guard", () => {
    // 200 pages -> edgeGuard = round(200*0.02) = 4, so pages 1-4 are guarded.
    expect(findGapPages(docWithGaps([2]))).toEqual([]);
  });

  it("excludes a gap within the back-matter guard", () => {
    expect(findGapPages(docWithGaps([199]))).toEqual([]);
  });

  it("does NOT exclude a long consecutive run — a catastrophic OCR early-stop must still surface", () => {
    // Pages 50-59 all missing (10-page run). The run-length-exclusion idea
    // was deliberately rejected: it would hide exactly this failure mode.
    const gaps = Array.from({ length: 10 }, (_, i) => 50 + i);
    const found = findGapPages(docWithGaps(gaps), 5);
    expect(found.length).toBe(5);
    for (const p of found) expect(gaps).toContain(p);
  });

  it("prioritises shorter runs over longer ones when trimming to the cap", () => {
    const longRun = Array.from({ length: 8 }, (_, i) => 40 + i); // 8-page run
    const shortRun = [100]; // isolated single-page gap
    const found = findGapPages(docWithGaps([...longRun, ...shortRun]), 3);
    // The isolated single-page run should win a slot before the long run does.
    expect(found).toContain(100);
  });

  it("respects the maxCandidates cap", () => {
    const gaps = [30, 60, 90, 120, 150, 180];
    const found = findGapPages(docWithGaps(gaps), 3);
    expect(found.length).toBe(3);
  });

  it("treats whitespace-only pages the same as empty ones", () => {
    const pages = Array.from({ length: 200 }, () => REAL_CONTENT);
    pages[99] = "   \n\n  ";
    expect(findGapPages(pages)).toEqual([100]);
  });
});
