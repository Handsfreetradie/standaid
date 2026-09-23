// AS/NZS 3000:2018 Clause 6.2 — "Locations containing a bath or shower"
// wet-area zone model for the Rough-in setout plan view.
//
// ── Working assumptions (read before trusting this on a real job) ─────────
//
// AS/NZS 3000 wording has moved around between the 2007/2000 editions and
// 2018 (plus its amendments), and the exact clause text isn't reproduced
// here from a live copy of the standard — this is modelled from trade
// knowledge and flagged by confidence level per zone. ALWAYS check the
// current edition/amendment in hand before relying on this for an actual
// install; every warning this file produces says so too.
//
//  - Zone 1  (MODERATE confidence): the space directly above/around the bath
//    tub or shower recess itself — i.e. the fitting's own footprint,
//    projected straight up — from the floor/base to HEIGHT_LIMIT_M (2.25m)
//    or the ceiling, whichever is lower.
//  - Zone 2  (MODERATE confidence): a further ZONE_2_MARGIN_M (0.6m)
//    horizontally beyond Zone 1's footprint, same height limit as Zone 1.
//  - Zone 3  (LOW confidence): some editions/amendments carry a further
//    "Zone 3" beyond Zone 2 with lighter restrictions; others have dropped
//    it or define it differently. Modelled here as a further
//    ZONE_3_MARGIN_M (2.4m) beyond Zone 2 purely as a rough reference —
//    treat this one as advisory only and verify against the standard
//    edition that applies to the job. wetZoneWarningsFor deliberately never
//    flags Zone 3 on its own (only Zone 1/2), since Zone 3's restrictions
//    are the least settled of the three here.
//  - Basin (MODERATE-HIGH confidence): AS/NZS 3000 Cl 6.2's formal Zone
//    1/2/3 treatment is for a bath or shower, not a wash basin — a basin
//    doesn't get its own zone under this clause. It's still placeable as a
//    sanitary fitting for a realistic plan, but wetZonePolygonsFor
//    deliberately returns an empty array for it rather than inventing a
//    zone the standard doesn't define. (Good general practice still says
//    keep GPOs a sensible distance from a basin's splash area — that's a
//    site judgement call, not a Cl 6.2 zone, so it isn't modelled as one.)
//
// Height is a 3D concept; this plan view only shows the horizontal
// footprint. Each zone still carries its height limit in `heightLimitM` so
// a caller/report can state it in text, but nothing here draws height.
//
// Every warning this module produces is phrased as "verify against the
// standard" — this is guidance for a licensed electrician to check, never a
// pass/fail certification.

import type { Point } from "./setoutTypes";

export type SanitaryFittingType = "bath" | "shower" | "basin";

export const SANITARY_FITTING_TYPES: readonly SanitaryFittingType[] = ["bath", "shower", "basin"];

export function isSanitaryFittingType(type: string): type is SanitaryFittingType {
  return (SANITARY_FITTING_TYPES as readonly string[]).includes(type);
}

// Default real-world footprints (mm) offered as starting points in the
// palette — a tradie adjusts per job. Bath/shower figures are common
// Australian residential sizes; a basin's footprint is its own default
// though it carries no wet-area zone (see header).
export const DEFAULT_SANITARY_FOOTPRINT_MM: Record<SanitaryFittingType, { widthMm: number; depthMm: number }> = {
  bath: { widthMm: 1700, depthMm: 750 },
  shower: { widthMm: 900, depthMm: 900 },
  basin: { widthMm: 600, depthMm: 450 },
};

// Minimal shape wetZonePolygonsFor/wetZoneWarningsFor need from a placed
// sanitary fitting — deliberately not the full SetoutFitting type, so this
// module stays a pure, independently-testable geometry helper with no
// dependency on the wider fitting-creation/persistence flow.
export interface SanitaryFootprintFitting {
  id: string;
  type: SanitaryFittingType;
  position: Point; // centre of the footprint, plan-local metres
  rotationDeg: number; // degrees clockwise, same convention as specs.rotation elsewhere
  footprintWidthMm: number;
  footprintDepthMm: number;
}

// Anything else on the plan a wet-area warning might apply to — a GPO,
// switch, downlight, or any other non-sanitary fitting. Only `id`, `type`
// and `position` are needed for the inside/outside-zone check.
export interface WetZoneCheckFitting {
  id: string;
  type: string;
  position: Point;
}

export type WetZoneNumber = 1 | 2 | 3;

export interface WetZonePolygon {
  zone: WetZoneNumber;
  fittingId: string;
  // Horizontal projection only, 4 corners, plan-local metres. Order follows
  // the footprint's own corner winding (not guaranteed clockwise/CCW in
  // screen space once rotated) — fine for both point-in-polygon and SVG
  // <polygon> fill, neither of which cares about winding direction.
  polygon: Point[];
  // Metres above the floor/base this zone's restrictions apply up to (or
  // the ceiling, if lower — this module has no ceiling height input, so
  // that half of the "or lower" is on the caller to note). Not drawn — see
  // header.
  heightLimitM: number;
}

const HEIGHT_LIMIT_M = 2.25;
const ZONE_2_MARGIN_M = 0.6;
// LOW confidence — see header comment.
const ZONE_3_MARGIN_M = 2.4;

function rotatePoint(p: Point, centre: Point, rotationDeg: number): Point {
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - centre.x;
  const dy = p.y - centre.y;
  return {
    x: centre.x + dx * cos - dy * sin,
    y: centre.y + dx * sin + dy * cos,
  };
}

// Axis-aligned rectangle (in the fitting's own, unrotated local space)
// centred on `centre`, half-extents `halfWidthM`/`halfDepthM`, then rotated
// about `centre` by `rotationDeg`. Shared by every zone ring below — each
// zone is just a bigger version of the same rectangle, expanded in local
// space (not world space) before rotation, which is what keeps a rotated
// footprint's zones lining up square to the fitting rather than to the
// plan's axes.
function rotatedRectangle(centre: Point, halfWidthM: number, halfDepthM: number, rotationDeg: number): Point[] {
  const corners: Point[] = [
    { x: centre.x - halfWidthM, y: centre.y - halfDepthM },
    { x: centre.x + halfWidthM, y: centre.y - halfDepthM },
    { x: centre.x + halfWidthM, y: centre.y + halfDepthM },
    { x: centre.x - halfWidthM, y: centre.y + halfDepthM },
  ];
  return corners.map((c) => rotatePoint(c, centre, rotationDeg));
}

/**
 * Derives the Zone 1/2/3 horizontal-projection polygons for a placed bath or
 * shower — empty for a basin (see header, no formal Cl 6.2 zone applies to
 * one). Pure function of the fitting's own footprint/position/rotation, so
 * it's cheap to recompute per fitting rather than needing to be memoised
 * itself (the caller — SetoutCanvas's overlay memo — is what avoids
 * recomputing this on every drag frame for fittings that aren't moving).
 */
export function wetZonePolygonsFor(fitting: SanitaryFootprintFitting): WetZonePolygon[] {
  if (fitting.type === "basin") return [];

  const halfWidthM = fitting.footprintWidthMm / 2 / 1000;
  const halfDepthM = fitting.footprintDepthMm / 2 / 1000;
  const rotationDeg = fitting.rotationDeg ?? 0;

  const zone1Half = { w: halfWidthM, d: halfDepthM };
  const zone2Half = { w: halfWidthM + ZONE_2_MARGIN_M, d: halfDepthM + ZONE_2_MARGIN_M };
  const zone3Half = { w: zone2Half.w + ZONE_3_MARGIN_M, d: zone2Half.d + ZONE_3_MARGIN_M };

  return [
    { zone: 1, fittingId: fitting.id, polygon: rotatedRectangle(fitting.position, zone1Half.w, zone1Half.d, rotationDeg), heightLimitM: HEIGHT_LIMIT_M },
    { zone: 2, fittingId: fitting.id, polygon: rotatedRectangle(fitting.position, zone2Half.w, zone2Half.d, rotationDeg), heightLimitM: HEIGHT_LIMIT_M },
    { zone: 3, fittingId: fitting.id, polygon: rotatedRectangle(fitting.position, zone3Half.w, zone3Half.d, rotationDeg), heightLimitM: HEIGHT_LIMIT_M },
  ];
}

// Standard ray-casting point-in-polygon test — works for any simple
// polygon, rotated or not, which is all `rotatedRectangle` ever produces.
function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects = yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

const GPO_TYPES = new Set(["gpo", "gpo_switch_combo"]);

function wetZoneMessage(zone: 1 | 2, fittingType: string): string {
  const zoneNote =
    zone === 1
      ? "Zone 1 (directly above/around the bath or shower)"
      : "Zone 2 (within 0.6m of the bath/shower zone)";
  if (GPO_TYPES.has(fittingType)) {
    return `In ${zoneNote} — GPOs are generally not permitted here (a shaver supply unit may be an exception). Relocate or verify against AS/NZS 3000 Cl 6.2 before installing.`;
  }
  return `In ${zoneNote} — AS/NZS 3000 Cl 6.2 calls for RCD protection (≤30mA) and an appropriate IP rating (IPX4 or higher is typical here) for equipment in this zone. Verify against the standard before installing.`;
}

export interface WetZoneWarning {
  fittingId: string;
  zone: 1 | 2;
  message: string;
}

/**
 * Flags any non-sanitary fitting (GPO, switch, downlight, or anything else
 * passed in `otherFittings`) whose position falls inside a Zone 1 or Zone 2
 * polygon of any sanitary fitting. Zone 3 is deliberately never checked
 * here — see the header's confidence note on Zone 3.
 *
 * Always phrased as "verify against the standard" (see wetZoneMessage) —
 * this is guidance for a licensed electrician to check on site, not a
 * pass/fail certification.
 */
export function wetZoneWarningsFor(sanitaryFittings: SanitaryFootprintFitting[], otherFittings: WetZoneCheckFitting[]): WetZoneWarning[] {
  const warnings: WetZoneWarning[] = [];
  for (const sanitary of sanitaryFittings) {
    const zones = wetZonePolygonsFor(sanitary);
    const zone1 = zones.find((z) => z.zone === 1);
    const zone2 = zones.find((z) => z.zone === 2);
    if (!zone1 && !zone2) continue;
    for (const other of otherFittings) {
      if (other.id === sanitary.id) continue;
      if (isSanitaryFittingType(other.type)) continue; // bath/shower/basin don't warn against each other
      if (zone1 && pointInPolygon(other.position, zone1.polygon)) {
        warnings.push({ fittingId: other.id, zone: 1, message: wetZoneMessage(1, other.type) });
      } else if (zone2 && pointInPolygon(other.position, zone2.polygon)) {
        warnings.push({ fittingId: other.id, zone: 2, message: wetZoneMessage(2, other.type) });
      }
    }
  }
  return warnings;
}
