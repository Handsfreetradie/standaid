import { describe, it, expect } from "vitest";
import { buildOcrResume, isStalledResume } from "../../supabase/functions/process-standard/resume.ts";

describe("buildOcrResume", () => {
  it("returns undefined for a fresh job row (ocr_next_page null)", () => {
    expect(buildOcrResume({ ocr_text: null, ocr_next_page: null })).toBeUndefined();
  });

  it("returns undefined for a null/undefined job", () => {
    expect(buildOcrResume(null)).toBeUndefined();
    expect(buildOcrResume(undefined)).toBeUndefined();
  });

  it("returns undefined when ocr_next_page is 1 (nothing transcribed yet)", () => {
    expect(buildOcrResume({ ocr_text: "", ocr_next_page: 1 })).toBeUndefined();
  });

  it("returns resume state when a checkpoint exists", () => {
    expect(buildOcrResume({ ocr_text: "partial text so far", ocr_next_page: 37 }))
      .toEqual({ priorText: "partial text so far", startPage: 37 });
  });

  it("treats a null ocr_text at a real checkpoint as an empty prior text", () => {
    expect(buildOcrResume({ ocr_text: null, ocr_next_page: 12 }))
      .toEqual({ priorText: "", startPage: 12 });
  });
});

describe("isStalledResume", () => {
  it("is false when there is no resume state (fresh run)", () => {
    expect(isStalledResume(undefined, 7)).toBe(false);
  });

  it("is false when nextPage advances past the resume start page", () => {
    expect(isStalledResume({ priorText: "", startPage: 37 }, 43)).toBe(false);
  });

  it("is true when nextPage doesn't advance past the resume start page", () => {
    expect(isStalledResume({ priorText: "", startPage: 37 }, 37)).toBe(true);
  });

  it("is true when nextPage regresses behind the resume start page", () => {
    expect(isStalledResume({ priorText: "", startPage: 37 }, 20)).toBe(true);
  });
});
