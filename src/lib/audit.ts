// Pure helpers for the Site Audit feature — no React/DB, unit-testable.

export type Severity = "compliant" | "concern" | "non_compliant" | "cant_tell";

export interface AuditPhoto {
  id: string;
  label: string | null;
  status: "pending" | "analyzing" | "done" | "failed";
  what_i_see: string | null;
  assessments: { point: string; verdict: Severity; clause?: string }[];
  needs_to_know: string[];
  severity: Severity | null;
  user_notes: string | null;
}

// Ordered worst → best for sorting/summarising a report.
export const SEVERITY_RANK: Record<Severity, number> = {
  non_compliant: 0,
  concern: 1,
  cant_tell: 2,
  compliant: 3,
};

export const SEVERITY_META: Record<Severity, { label: string; tone: "danger" | "warning" | "muted" | "success"; icon: string }> = {
  non_compliant: { label: "Non-compliant", tone: "danger", icon: "❌" },
  concern: { label: "Concern", tone: "warning", icon: "⚠️" },
  cant_tell: { label: "Needs info", tone: "muted", icon: "❓" },
  compliant: { label: "Compliant", tone: "success", icon: "✅" },
};

// Photo tag options — a tag sharpens the AI's retrieval for that photo.
export const PHOTO_LABELS = [
  "Switchboard", "Main switch", "RCD / safety switch", "Earthing / MEN",
  "Socket outlet", "Wet area", "Lighting", "Smoke alarm", "Cabling", "Other",
];

export interface AuditSummary {
  total: number;
  analysed: number;
  counts: Record<Severity, number>;
  openQuestions: number;   // total needs_to_know across analysed photos
  overall: Severity | null; // worst severity present, or null if nothing analysed
}

export function summariseAudit(photos: AuditPhoto[]): AuditSummary {
  const counts: Record<Severity, number> = { non_compliant: 0, concern: 0, cant_tell: 0, compliant: 0 };
  let analysed = 0;
  let openQuestions = 0;
  let worst: Severity | null = null;

  for (const p of photos) {
    if (p.status !== "done" || !p.severity) continue;
    analysed++;
    counts[p.severity]++;
    // A question only counts as "open" until the tradie has answered (user_notes set)
    if (!p.user_notes) openQuestions += p.needs_to_know?.length ?? 0;
    if (worst === null || SEVERITY_RANK[p.severity] < SEVERITY_RANK[worst]) worst = p.severity;
  }

  return { total: photos.length, analysed, counts, openQuestions, overall: worst };
}

// Photos ordered for the report: worst severity first, unanalysed last.
export function sortForReport(photos: AuditPhoto[]): AuditPhoto[] {
  return [...photos].sort((a, b) => {
    const ra = a.severity ? SEVERITY_RANK[a.severity] : 99;
    const rb = b.severity ? SEVERITY_RANK[b.severity] : 99;
    return ra - rb;
  });
}
