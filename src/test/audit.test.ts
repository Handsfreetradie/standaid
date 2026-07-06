import { describe, it, expect } from "vitest";
import { summariseAudit, sortForReport, SEVERITY_RANK, type AuditPhoto } from "../lib/audit";

const photo = (over: Partial<AuditPhoto>): AuditPhoto => ({
  id: Math.random().toString(36),
  label: null,
  status: "done",
  what_i_see: "x",
  assessments: [],
  needs_to_know: [],
  severity: "compliant",
  user_notes: null,
  ...over,
});

describe("summariseAudit", () => {
  it("counts by severity and picks the worst as overall", () => {
    const s = summariseAudit([
      photo({ severity: "compliant" }),
      photo({ severity: "concern" }),
      photo({ severity: "non_compliant" }),
      photo({ status: "pending", severity: null }), // not analysed → ignored
    ]);
    expect(s.total).toBe(4);
    expect(s.analysed).toBe(3);
    expect(s.counts.compliant).toBe(1);
    expect(s.counts.concern).toBe(1);
    expect(s.counts.non_compliant).toBe(1);
    expect(s.overall).toBe("non_compliant"); // worst wins
  });

  it("only counts unanswered questions as open", () => {
    const s = summariseAudit([
      photo({ severity: "cant_tell", needs_to_know: ["a?", "b?"], user_notes: null }),  // 2 open
      photo({ severity: "cant_tell", needs_to_know: ["c?"], user_notes: "answered" }),   // 0 open (answered)
    ]);
    expect(s.openQuestions).toBe(2);
  });

  it("returns null overall when nothing is analysed", () => {
    expect(summariseAudit([photo({ status: "pending", severity: null })]).overall).toBeNull();
  });
});

describe("sortForReport", () => {
  it("orders worst-first, unanalysed last", () => {
    const out = sortForReport([
      photo({ id: "ok", severity: "compliant" }),
      photo({ id: "bad", severity: "non_compliant" }),
      photo({ id: "new", severity: null, status: "pending" }),
      photo({ id: "warn", severity: "concern" }),
    ]);
    expect(out.map((p) => p.id)).toEqual(["bad", "warn", "ok", "new"]);
  });
});

describe("SEVERITY_RANK", () => {
  it("ranks non-compliant as the most severe", () => {
    expect(SEVERITY_RANK.non_compliant).toBeLessThan(SEVERITY_RANK.concern);
    expect(SEVERITY_RANK.concern).toBeLessThan(SEVERITY_RANK.compliant);
  });
});
