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
  it("flags a big fully-scanned document beyond the page window", () => {
    expect(scanTooLargeForOcr(doc(Array(150).fill(blankPage)), 30 * MB)).toBe(true);
  });

  it("treats pages with only stray characters as scanned", () => {
    expect(scanTooLargeForOcr(doc(Array(150).fill(nearBlankPage)), 30 * MB)).toBe(true);
  });

  it("passes a big digital document", () => {
    expect(scanTooLargeForOcr(doc(Array(150).fill(textPage)), 30 * MB)).toBe(false);
  });

  it("passes a high-resolution scan within the 100-page OCR window", () => {
    // Big file but few pages — whole-document OCR via the Files API takes it
    expect(scanTooLargeForOcr(doc(Array(60).fill(blankPage)), 30 * MB)).toBe(false);
  });

  it("passes a small scanned document (server OCR can handle it)", () => {
    expect(scanTooLargeForOcr(doc(Array(150).fill(blankPage)), 5 * MB)).toBe(false);
  });

  it("passes exactly at the OCR size limit", () => {
    expect(scanTooLargeForOcr(doc(Array(150).fill(blankPage)), AI_OCR_FILE_LIMIT)).toBe(false);
  });

  it("passes a mostly-digital document with some scanned pages", () => {
    // 110 text pages + 40 blank = ~27% scanned, well under the 85% ratio
    const pages = [...Array(110).fill(textPage), ...Array(40).fill(blankPage)];
    expect(scanTooLargeForOcr(doc(pages), 30 * MB)).toBe(false);
  });

  it("defers to the server when extraction failed outright", () => {
    expect(scanTooLargeForOcr("", 30 * MB)).toBe(false);
  });

  it("defers to the server when text has no page markers", () => {
    expect(scanTooLargeForOcr("some unmarked text", 30 * MB)).toBe(false);
  });
});
