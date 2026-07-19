import { describe, it, expect } from "vitest";
import { scanTooLargeForOcr, AI_OCR_FILE_LIMIT } from "@/lib/scanned-check";

const MB = 1024 * 1024;

function doc(pages: string[]): string {
  return pages.map((p, i) => `\n[PAGE ${i + 1}]\n${p}`).join("");
}

const textPage = "1.2.3 EARTHING REQUIREMENTS\nThe resistance shall not exceed 0.5 ohms as measured between the main earthing terminal and the electrode.";
const blankPage = "";
const nearBlankPage = "  3  ";

describe("scanTooLargeForOcr", () => {
  it("flags a big fully-scanned document", () => {
    expect(scanTooLargeForOcr(doc(Array(20).fill(blankPage)), 30 * MB)).toBe(true);
  });

  it("treats pages with only stray characters as scanned", () => {
    expect(scanTooLargeForOcr(doc(Array(20).fill(nearBlankPage)), 30 * MB)).toBe(true);
  });

  it("passes a big digital document", () => {
    expect(scanTooLargeForOcr(doc(Array(20).fill(textPage)), 30 * MB)).toBe(false);
  });

  it("passes a small scanned document (server OCR can handle it)", () => {
    expect(scanTooLargeForOcr(doc(Array(20).fill(blankPage)), 5 * MB)).toBe(false);
  });

  it("passes exactly at the OCR size limit", () => {
    expect(scanTooLargeForOcr(doc(Array(20).fill(blankPage)), AI_OCR_FILE_LIMIT)).toBe(false);
  });

  it("passes a mostly-digital document with some scanned pages", () => {
    // 15 text pages + 5 blank = 25% scanned, well under the 85% ratio
    const pages = [...Array(15).fill(textPage), ...Array(5).fill(blankPage)];
    expect(scanTooLargeForOcr(doc(pages), 30 * MB)).toBe(false);
  });

  it("defers to the server when extraction failed outright", () => {
    expect(scanTooLargeForOcr("", 30 * MB)).toBe(false);
  });

  it("defers to the server when text has no page markers", () => {
    expect(scanTooLargeForOcr("some unmarked text", 30 * MB)).toBe(false);
  });
});
