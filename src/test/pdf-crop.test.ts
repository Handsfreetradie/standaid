import { describe, it, expect } from "vitest";
import {
  assemblePositionedLines,
  findLabelLine,
  computeCropRect,
  type PositionedItem,
} from "../lib/pdf-text";

// Crop geometry for the inline table/figure images in chat. These run against
// synthetic pages because the failure they guard against is silent: a wrong
// rect doesn't throw, it just shows the tradie the wrong half of the page —
// or worse, a table with its bottom rows cut off, which reads as authoritative.
//
// Remember the axis: pdf.js user space has its origin BOTTOM-left, so a larger
// y is further UP the page. Test pages below are 595x842 (A4 portrait).

const PAGE_W = 595;
const PAGE_H = 842;

const item = (str: string, x: number, y: number, w?: number, h = 10): PositionedItem => ({
  str,
  x,
  y,
  w: w ?? str.length * 5,
  h,
});

/** Build a page from top-down lines, converting to bottom-left coordinates. */
const page = (rows: Array<{ text: string; fromTop: number }>): PositionedItem[] =>
  rows.map((r) => item(r.text, 50, PAGE_H - r.fromTop));

describe("findLabelLine", () => {
  it("finds an uppercase caption", () => {
    const lines = assemblePositionedLines(
      page([
        { text: "Some preamble text", fromTop: 100 },
        { text: "TABLE 3 — CURRENT-CARRYING CAPACITY", fromTop: 200 },
        { text: "1.5 18 20", fromTop: 220 },
      ]),
    );
    expect(findLabelLine(lines, "Table", "3")).toBe(1);
  });

  it("finds a title-case caption", () => {
    const lines = assemblePositionedLines(
      page([{ text: "Figure 3.2 — Main earthing arrangement", fromTop: 120 }]),
    );
    expect(findLabelLine(lines, "Figure", "3.2")).toBe(0);
  });

  it("finds a caption whose label is split across kerned items", () => {
    // pdf.js routinely emits "TABLE" and "3" as separate runs; matching on raw
    // items instead of assembled lines would miss every one of these.
    const lines = assemblePositionedLines([
      item("TABLE", 50, 700, 32),
      item("3", 85, 700, 6),
      item("Current ratings", 100, 700, 70),
    ]);
    expect(findLabelLine(lines, "Table", "3")).toBe(0);
  });

  it("finds a caption ending in a full stop", () => {
    // AS/NZS 3000 writes many captions as "Figure 3.16." — a guard that
    // rejected any following dot missed every one of these on the real PDF.
    const lines = assemblePositionedLines(
      page([{ text: "Figure 3.16. Earthing arrangement", fromTop: 120 }]),
    );
    expect(findLabelLine(lines, "Figure", "3.16")).toBe(0);
  });

  it("does not match a longer number that merely starts with the ref", () => {
    // Asking for Table 3 on a page carrying Table 3.1 must not crop Table 3.1.
    const lines = assemblePositionedLines(
      page([
        { text: "TABLE 3.1 — DERATING FACTORS", fromTop: 100 },
        { text: "TABLE 30 — SOMETHING ELSE", fromTop: 300 },
      ]),
    );
    expect(findLabelLine(lines, "Table", "3")).toBe(-1);
  });

  it("ignores a prose reference in favour of the real caption", () => {
    const lines = assemblePositionedLines(
      page([
        { text: "The values in Table 3 apply to buried cables.", fromTop: 100 },
        { text: "TABLE 3 — CURRENT-CARRYING CAPACITY", fromTop: 400 },
      ]),
    );
    expect(findLabelLine(lines, "Table", "3")).toBe(1);
  });

  it("returns -1 when the label is absent", () => {
    const lines = assemblePositionedLines(page([{ text: "Nothing here", fromTop: 100 }]));
    expect(findLabelLine(lines, "Table", "3")).toBe(-1);
  });
});

describe("computeCropRect", () => {
  it("crops from the caption down to the next block heading", () => {
    const lines = assemblePositionedLines(
      page([
        { text: "TABLE 3 — CURRENT-CARRYING CAPACITY", fromTop: 200 },
        { text: "1.5 18 20", fromTop: 230 },
        { text: "2.5 25 27", fromTop: 250 },
        { text: "FIGURE 4 — CABLE ARRANGEMENT", fromTop: 400 },
        { text: "diagram content", fromTop: 430 },
      ]),
    );
    const rect = computeCropRect(lines, findLabelLine(lines, "Table", "3"), PAGE_W, PAGE_H);
    expect(rect).not.toBeNull();
    // Top edge sits just above the caption (fromTop 200 → y 642).
    expect(rect!.y1).toBeGreaterThan(PAGE_H - 200);
    // The last data row (fromTop 250 → y 592) must be inside the crop...
    expect(rect!.y0).toBeLessThan(PAGE_H - 250);
    // ...and the Figure 4 heading (fromTop 400 → y 442, glyph top 452) must
    // fall outside it, so the crop shows the table and not the next diagram.
    expect(rect!.y0).toBeGreaterThanOrEqual(452);
    expect(rect!.x0).toBe(0);
    expect(rect!.x1).toBe(PAGE_W);
  });

  it("crops to the bottom of the page when nothing follows", () => {
    const lines = assemblePositionedLines(
      page([
        { text: "TABLE 3 — CURRENT-CARRYING CAPACITY", fromTop: 600 },
        { text: "1.5 18 20", fromTop: 630 },
      ]),
    );
    const rect = computeCropRect(lines, findLabelLine(lines, "Table", "3"), PAGE_W, PAGE_H);
    expect(rect).not.toBeNull();
    expect(rect!.y0).toBe(0);
  });

  it("does not end the crop on a table row that looks like a clause number", () => {
    // "2.5 Copper" is a cable-size row, not a heading. Cutting here would drop
    // every row below it — the exact silent-truncation failure this guards.
    const lines = assemblePositionedLines(
      page([
        { text: "TABLE 3 — CURRENT-CARRYING CAPACITY", fromTop: 200 },
        { text: "1.5 Copper 18", fromTop: 230 },
        { text: "2.5 Copper 25", fromTop: 250 },
        { text: "4.0 Copper 32", fromTop: 270 },
      ]),
    );
    const rect = computeCropRect(lines, findLabelLine(lines, "Table", "3"), PAGE_W, PAGE_H);
    expect(rect).not.toBeNull();
    // Bottom of page — the last row at fromTop 270 (y 572) must be inside.
    expect(rect!.y0).toBeLessThan(PAGE_H - 270);
  });

  it("does not stop at a 'Clause X' cross-reference printed inside the artwork", () => {
    // Real failure: Figure 2.3 of AS/NZS 3000 has "Clause 2.5.3.1" annotated
    // inside the diagram, which cut the crop off half way down the figure.
    const lines = assemblePositionedLines(
      page([
        { text: "FIGURE 2.3 MANDATORY OMISSION OF OVERLOAD", fromTop: 200 },
        { text: "Refer to Clause 2.5.2", fromTop: 240 },
        { text: "Clause 2.5.3.1. B B", fromTop: 400 },
        { text: "more of the diagram", fromTop: 500 },
      ]),
    );
    const rect = computeCropRect(lines, findLabelLine(lines, "Figure", "2.3"), PAGE_W, PAGE_H);
    expect(rect).not.toBeNull();
    // The rest of the diagram (fromTop 500 → y 342) must still be inside.
    expect(rect!.y0).toBeLessThan(PAGE_H - 500);
  });

  it("ignores a '(continued)' repeat of the same caption", () => {
    const lines = assemblePositionedLines(
      page([
        { text: "TABLE 3", fromTop: 100 },
        { text: "TABLE 3", fromTop: 300 },
        { text: "1.5 18 20", fromTop: 330 },
      ]),
    );
    const rect = computeCropRect(lines, findLabelLine(lines, "Table", "3"), PAGE_W, PAGE_H);
    expect(rect).not.toBeNull();
    expect(rect!.y0).toBe(0);
  });

  it("returns null for an implausibly short crop so the caller renders the full page", () => {
    const lines = assemblePositionedLines(
      page([
        { text: "TABLE 3 — CURRENT-CARRYING CAPACITY", fromTop: 200 },
        { text: "FIGURE 4 — CABLE ARRANGEMENT", fromTop: 225 },
      ]),
    );
    const rect = computeCropRect(lines, findLabelLine(lines, "Table", "3"), PAGE_W, PAGE_H);
    expect(rect).toBeNull();
  });

  it("returns null when the label index is invalid", () => {
    const lines = assemblePositionedLines(page([{ text: "Nothing", fromTop: 100 }]));
    expect(computeCropRect(lines, -1, PAGE_W, PAGE_H)).toBeNull();
  });
});
