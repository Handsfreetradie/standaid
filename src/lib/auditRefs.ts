// Phase 3 of the NCC + Standards Content Plan: every audit photo label maps
// to the NCC clauses and StandAId clause guides that explain WHY the item
// matters. Hand-mapped on purpose — a small fixed list, and this is
// safety-critical content, so no AI guessing. AuditDetail renders the mapped
// clauses in a "Why this matters" expandable, pulling the live text from
// ncc_chunks / clause_guides (both readable by any signed-in user via RLS).
//
// DRAFT MAPPING (2026-09-12) — reviewed by: (nobody yet). Clause numbers are
// NCC 2025 (Housing Provisions unless noted) and AS/NZS 3000 guide entries;
// each was checked against the ingested index, but the choice of WHICH
// clauses matter for a label is a trade judgement the SME should confirm.

export interface LabelRefs {
  /** NCC clause numbers, matched against ncc_chunks.clause_number (national + user's states). */
  ncc: string[];
  /** Clause guides, matched against clause_guides (standard_code, clause_ref). Only live guides render. */
  guides: Array<{ standard: string; clause: string }>;
}

const g3000 = (...clauses: string[]) => clauses.map((clause) => ({ standard: "AS/NZS 3000", clause }));

export const AUDIT_LABEL_REFS: Record<string, Record<string, LabelRefs>> = {
  electrical: {
    "Switchboard": { ncc: [], guides: g3000("2.10.2", "5.5.3.1", "2.6.3.2.4") },
    "Main switch": { ncc: [], guides: g3000("2.10.2") },
    "RCD / safety switch": { ncc: [], guides: g3000("2.6.3.2.2", "2.6.3.2.3", "2.6.3.2.4") },
    "Earthing / MEN": { ncc: [], guides: g3000("5.5.3.1", "5.3.3.1.1", "5.6.2") },
    "Socket outlet": { ncc: [], guides: g3000("2.6.3.2.2", "6.2.4") },
    "Wet area": { ncc: ["10.2.1", "10.2.2"], guides: g3000("6.2.4", "5.6.2") },
    "Lighting": { ncc: [], guides: g3000("4.5.2.3") },
    "Smoke alarm": { ncc: ["9.5.1", "9.5.2", "9.5.4", "H3D6"], guides: [] },
    "Cabling": { ncc: [], guides: g3000("3.9.3", "3.4.1", "3.6.2", "3.8.3", "3.11.4") },
  },
  plumbing: {
    "Water supply": { ncc: ["B1P1", "B1D3"], guides: [] },
    "Drainage": { ncc: ["C2P1", "C2D2"], guides: [] },
    "Hot water system": { ncc: ["B2P1", "B2D2", "B2D5", "B2V1"], guides: [] },
    "Backflow device": { ncc: ["B1P1", "B1D3"], guides: [] },
    "Fixture install": { ncc: ["B2D3", "B2D5", "10.2.1"], guides: [] },
    "Pipe support / fall": { ncc: ["C2D2", "10.2.12"], guides: [] },
  },
  building: {
    "Waterproofing": { ncc: ["10.2.1", "10.2.2", "10.2.11", "10.2.12", "H2D8"], guides: [] },
    "Stair / balustrade": { ncc: ["11.2.2", "11.3.3", "11.3.4", "H5D2"], guides: [] },
    "Roof / wall cladding": { ncc: ["H2P2", "H2F2"], guides: [] },
  },
  carpentry: {
    "Stair / balustrade": { ncc: ["11.2.2", "11.3.3", "11.3.4"], guides: [] },
  },
};

export function getLabelRefs(trade: string | null | undefined, label: string | null | undefined): LabelRefs | null {
  if (!trade || !label) return null;
  return AUDIT_LABEL_REFS[trade]?.[label] ?? null;
}
