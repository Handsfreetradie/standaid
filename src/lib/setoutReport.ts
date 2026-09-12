// Builds the Rough-In Setout Assistant PDF summary. Pure function — takes
// plain data (no React/DB/Supabase calls) so the caller decides how the
// plan/fittings/circuits were fetched. Follows the pattern in auditReport.ts.
import jsPDF from "jspdf";
import { createElement } from "react";
import { FITTING_LABELS, FITTING_SYMBOLS } from "@/components/setout/symbols";
import type { FittingType } from "@/components/setout/symbols";
import { aggregateMaterials } from "@/lib/setoutMaterials";
import { calculateMaximumDemand } from "@/lib/setoutMaximumDemand";
import { calculateSolarVoltageRise } from "@/lib/setoutSolarVoltageRise";
import { loadImageSize } from "@/lib/auditReport";
import {
  CATEGORY_FOR_TYPE,
  FITTING_CATEGORY_ORDER,
  colorForCircuit,
  distance,
  isSingleWallFitting,
  symbolExtraPropsFor,
  LAYER_LABELS,
  type Point,
  type SetoutCircuit,
  type SetoutFitting,
  type SetoutLoadItem,
  type SetoutPlan,
  type SetoutCanvas,
} from "@/lib/setoutTypes";
import { wallLength, pointAtOffset, wallsCentroid, roomFacingNormal, nearestMountWall, closestPointOnWall } from "@/lib/setoutGeometry";

/** The tradie's business branding — printed on the switchboard legend so the
 * sheet stuck inside the switchboard door identifies who wired it. */
export interface ReportBusiness {
  name?: string | null;
  licenceNumber?: string | null;
  phone?: string | null;
  email?: string | null;
  logoBase64?: string | null; // data URL
}

const PAGE_W = 210; // A4 mm
const PAGE_H = 297;
const MARGIN = 15;
const CONTENT_W = PAGE_W - MARGIN * 2;
const SYMBOL_SIZE_MM = 5;
const UNASSIGNED_SYMBOL_COLOR = "#1a1a1a";

/** The imported plan, positioned in scene units from the origin. */
export interface PlanImage {
  dataUrl: string;
  width: number;
  height: number;
}

// A one-line summary appended to a circuit's row description in the
// switchboard legend when a "Solar inverter" fitting is assigned to it —
// the legend table itself is generic/type-agnostic (any circuit prints
// label/breaker/points served the same way), so this is the one place solar
// needs its own text rather than a structural change. Solar specs live on
// the inverter fitting itself (set in the palette panel), not the circuit —
// same source of truth MaximumDemandPanel's Solar section reads from, cable
// run length included (straight-line distance to the nearest switchboard).
function solarCircuitDetail(circuit: SetoutCircuit, fittings: SetoutFitting[]): string | null {
  const inverter = fittings.find((f) => f.circuit_id === circuit.id && f.type === "solar_inverter");
  if (!inverter) return null;
  const specs = inverter.specs;
  const board = fittings
    .filter((f) => f.type === "switchboard")
    .reduce<{ f: SetoutFitting; d: number } | null>((best, f) => {
      const d = distance(inverter.position, f.position);
      return !best || d < best.d ? { f, d } : best;
    }, null);
  if ((specs.inverterSystemType ?? "ac") !== "ac" || !specs.inverterCableMaterial || !specs.inverterCableCsaMm2 || !board || !specs.inverterOutputAmps) {
    return "Solar inverter";
  }
  const rise = calculateSolarVoltageRise({
    material: specs.inverterCableMaterial,
    cableCsaMm2: specs.inverterCableCsaMm2,
    systemType: "ac",
    phase: specs.inverterPhase,
    runLengthM: board.d,
    currentAmps: specs.inverterOutputAmps,
    supplyVoltage: specs.inverterPhase === "three" ? 400 : 230,
  });
  const base = `Solar: ${specs.inverterOutputAmps}A, ${specs.inverterCableCsaMm2}mm² ${specs.inverterCableMaterial}, ${board.d.toFixed(1)}m run`;
  if (!rise) return base;
  return `${base} — ${rise.pass ? "PASS" : "FAIL"} (${rise.voltageRisePercent.toFixed(1)}% rise)`;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const num = parseInt(clean, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

// Both svg2pdf.js and react-dom/server are only ever needed for this one
// export action, not on every app load — dynamically imported once per
// generateSetoutReportPdf call (below) and threaded through, rather than
// statically imported at module scope, which pushed the main JS bundle
// over the PWA precache size limit and broke the production build.
type Svg2Pdf = (element: Element, pdf: jsPDF, options?: { x?: number; y?: number; width?: number; height?: number }) => Promise<jsPDF>;
type RenderToStaticMarkup = (element: ReturnType<typeof createElement>) => string;

// Renders a fitting's actual on-screen symbol (FITTING_SYMBOLS) as real
// vector paths in the PDF, instead of a generic dot — reuses the exact same
// React components the canvas uses (renderToStaticMarkup, no live DOM
// needed) rather than hand-redrawing 39 shapes with jsPDF primitives, so
// the two stay in sync automatically. currentColor is substituted with a
// literal hex value (not left to CSS resolution) since the parsed SVG is a
// detached document — computed-style/cascade resolution isn't reliable for
// an element that was never attached to the visible page.
async function drawFittingSymbol(
  doc: jsPDF,
  fitting: SetoutFitting,
  pagePos: Point,
  color: string,
  svg2pdf: Svg2Pdf,
  renderToStaticMarkup: RenderToStaticMarkup,
  sizeMm: number = SYMBOL_SIZE_MM,
): Promise<void> {
  const Icon = FITTING_SYMBOLS[fitting.type];
  if (!Icon) return;
  const extraProps = symbolExtraPropsFor(fitting);
  const markup = renderToStaticMarkup(createElement(Icon, { size: 24, strokeWidth: 1.5, ...extraProps }));
  const colored = markup.replace(/currentColor/g, color);
  const parsed = new DOMParser().parseFromString(colored, "image/svg+xml");
  const svgEl = parsed.documentElement;
  // Wall-mounted symbols anchor at their base (local icon point (12, 20.5),
  // where GpoSymbol/SwitchSymbol and friends draw their wall baseline), not
  // their geometric centre — same convention SetoutCanvas.tsx uses on
  // screen, so the base sits on the wall line and the body projects into
  // the room from there, instead of straddling the wall centred on it.
  const anchorX = 12;
  const anchorY = isSingleWallFitting(fitting.type) ? 20.5 : 12;
  const rotation = fitting.specs.rotation ?? 0;
  if (rotation) {
    const g = parsed.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("transform", `rotate(${rotation} ${anchorX} ${anchorY})`);
    while (svgEl.firstChild) g.appendChild(svgEl.firstChild);
    svgEl.appendChild(g);
  }
  await svg2pdf(svgEl, doc, {
    x: pagePos.x - (anchorX / 24) * sizeMm,
    y: pagePos.y - (anchorY / 24) * sizeMm,
    width: sizeMm,
    height: sizeMm,
  });
}

const CODE_PREFIX: Record<FittingType, string> = {
  // Lighting
  downlight: "DL",
  batten_holder: "BH",
  wall_batten_holder: "WL",
  wall_stair_light: "WSL",
  external_light: "EXL",
  heater_fan_light_2: "HFL2",
  heater_fan_light_4: "HFL4",
  junction_box: "JB",
  ceiling_fan: "CF",
  ceiling_fan_light: "CFL",
  para_flood: "PF",
  round_fluoro: "RF",
  fluoro_1200: "FL12",
  motion_sensor: "MS",
  exhaust_fan: "EF",
  exhaust_fan_light: "EFL",
  pendant: "PEN",
  led_strip: "LED",
  // Switches
  switch: "SW",
  cooktop_isolator: "ISO",
  // Power
  gpo: "GPO",
  gpo_switch_combo: "25XA",
  tv_point: "TV",
  phone_point: "TEL",
  meter_box: "MB",
  nbn_box: "NBN",
  ubo_rhood: "UBO",
  switchboard: "MSB",
  cooktop: "CT",
  oven: "OV",
  hot_water_unit: "HWU",
  spa_pool_heater: "SPA",
  other_appliance: "APPL",
  solar_inverter: "SOLAR",
  // Data
  data: "DATA",
  data_cabinet: "DC",
  // Safety
  smoke_detector: "SD",
  // Heat/cool
  heating_duct: "HD",
  ducted_heating_unit: "DHU",
  heat_cool_duct: "HCD",
  rev_cycle_unit: "RCU",
  thermostat: "TSTAT",
  return_air: "RA",
  evap_cooling_duct: "ECD",
  evap_cooling_unit: "ECU",
  ac_condenser: "ACC",
  ac_head_unit: "ACH",
  cooling_unit: "CU",
  heated_towel_rail: "HTR",
  underfloor_heating_stat: "UFH",
  // Network
  wifi_ap: "AP",
};

// Numbers fittings per-type in array order, e.g. first downlight = "DL1".
// Exported so the on-screen switchboard legend preview shows the exact same
// codes the PDF export prints — one shared source of numbering, not two
// copies that could drift apart.
export function buildFittingCodes(fittings: SetoutFitting[]): Map<string, string> {
  const counters: Partial<Record<FittingType, number>> = {};
  const codes = new Map<string, string>();
  for (const f of fittings) {
    const n = (counters[f.type] ?? 0) + 1;
    counters[f.type] = n;
    codes.set(f.id, `${CODE_PREFIX[f.type]}${n}`);
  }
  return codes;
}

function drawPageHeader(doc: jsPDF, plan: SetoutPlan, sectionTitle: string): number {
  let y = MARGIN;
  doc.setFontSize(14);
  doc.setTextColor(20);
  doc.text(plan.name || "Rough-in setout plan", MARGIN, y);
  y += 6;
  doc.setFontSize(10);
  doc.setTextColor(90);
  doc.text(sectionTitle, MARGIN, y);
  y += 5;
  if (plan.job_reference) {
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(`Job ref: ${plan.job_reference}`, MARGIN, y);
    y += 5;
  }
  doc.setDrawColor(220);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 6;
  return y;
}

async function drawPlanPage(
  doc: jsPDF,
  plan: SetoutPlan,
  canvas: SetoutCanvas,
  fittings: SetoutFitting[],
  circuits: SetoutCircuit[],
  svg2pdf: Svg2Pdf,
  renderToStaticMarkup: RenderToStaticMarkup,
  planImage?: PlanImage,
): Promise<void> {
  let y = drawPageHeader(doc, plan, `Marked-up plan — ${canvas.name}`);

  doc.setFontSize(8);
  doc.setTextColor(150, 110, 0);
  const disclaimerLines = doc.splitTextToSize(
    "Internal working document — not a certified drawing. Wall-locked measurements are for laser-up on site; always verify before cutting in.",
    CONTENT_W,
  );
  doc.text(disclaimerLines, MARGIN, y);
  y += disclaimerLines.length * 3.6 + 4;

  // The plan drawing always gets a fixed, generous share of the page,
  // regardless of fitting count — a job with a lot of fittings (and so a
  // long legend) spills the legend onto extra pages instead of squeezing the
  // plan drawing down to nothing to make room for it. A previous version
  // sized this off the legend's own row count, which went negative once the
  // legend needed more room than the whole page had, collapsing the legend
  // text up on top of the header instead of paginating.
  const planTop = y;
  const planAreaH = Math.max((PAGE_H - MARGIN - planTop) * 0.55, 80);
  const planBottom = planTop + planAreaH;
  const planAreaW = CONTENT_W;

  // What the page has to cover. Walls are no longer the only possibility:
  // tracing them is optional, so a plan can be nothing but the imported
  // drawing with fittings marked on it — which is exactly what a marked-up
  // plan is. Sizing from the walls alone meant such a plan exported as a
  // single line of text and nothing else.
  const xs = [
    ...canvas.walls.flatMap((w) => [w.start.x, w.end.x]),
    ...fittings.map((f) => f.position.x),
    ...(planImage ? [0, planImage.width] : []),
  ];
  const ys = [
    ...canvas.walls.flatMap((w) => [w.start.y, w.end.y]),
    ...fittings.map((f) => f.position.y),
    ...(planImage ? [0, planImage.height] : []),
  ];

  if (xs.length === 0) {
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text("Nothing on this plan yet — trace the walls or place some fittings.", MARGIN, planTop + 10);
  } else {
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const bboxW = Math.max(maxX - minX, 0.1);
    const bboxH = Math.max(maxY - minY, 0.1);

    const pad = 8; // room for fitting code labels sitting just outside the walls
    const scale = Math.min((planAreaW - pad * 2) / bboxW, (planAreaH - pad * 2) / bboxH);
    const originX = MARGIN + (planAreaW - bboxW * scale) / 2 - minX * scale;
    const originY = planTop + (planAreaH - bboxH * scale) / 2 - minY * scale;
    const toPage = (p: Point) => ({ x: originX + p.x * scale, y: originY + p.y * scale });

    // The imported drawing goes down first, so the walls and fittings mark up
    // over it instead of hiding behind it.
    if (planImage) {
      const topLeft = toPage({ x: 0, y: 0 });
      try {
        doc.addImage(planImage.dataUrl, "PNG", topLeft.x, topLeft.y, planImage.width * scale, planImage.height * scale);
      } catch (err) {
        // A drawing that won't embed shouldn't cost the rest of the page.
        console.error("[setoutReport] Could not embed the plan image:", err);
      }
    }

    const centroid = wallsCentroid(canvas.walls);
    for (const wall of canvas.walls) {
      const wallOpenings = (canvas.openings ?? []).filter((o) => o.wallId === wall.id).sort((a, b) => a.offset - b.offset);
      const len = wallLength(wall);
      doc.setDrawColor(60);
      // Real thickness (metres) converted through the page's plan scale, so
      // a wall reads true-to-scale on the printed page — same value the
      // on-screen canvas draws with (see SetoutCanvas.tsx), just floored so
      // a very tight scale doesn't shrink the line into invisibility.
      const thicknessMetres = wall.kind === "interior" ? canvas.wall_thickness.interior : canvas.wall_thickness.exterior;
      doc.setLineWidth(Math.max(thicknessMetres * scale, 0.15));
      let cursor = 0;
      for (const o of wallOpenings) {
        const start = Math.max(0, Math.min(len, o.offset));
        const end = Math.max(0, Math.min(len, o.offset + o.width));
        if (start > cursor) {
          const a = toPage(pointAtOffset(wall, cursor));
          const b = toPage(pointAtOffset(wall, start));
          doc.line(a.x, a.y, b.x, b.y);
        }
        cursor = Math.max(cursor, end);
      }
      if (cursor < len) {
        const a = toPage(pointAtOffset(wall, cursor));
        const b = toPage(pointAtOffset(wall, len));
        doc.line(a.x, a.y, b.x, b.y);
      }

      // Door/window glyphs — same construction as the on-screen canvas
      // (leaf + swing arc for a door, a single line across the gap for a
      // window), just drawn with jsPDF primitives instead of SVG.
      for (const o of wallOpenings) {
        const p1 = toPage(pointAtOffset(wall, Math.max(0, o.offset)));
        const p2 = toPage(pointAtOffset(wall, Math.min(len, o.offset + o.width)));
        if (o.kind === "window") {
          doc.setDrawColor(30, 100, 160);
          doc.setLineWidth(0.25);
          doc.line(p1.x, p1.y, p2.x, p2.y);
          continue;
        }
        const rawP1 = pointAtOffset(wall, Math.max(0, o.offset));
        const roomNormal = roomFacingNormal(wall, rawP1, centroid);
        const normal = o.swingFlipped ? { x: -roomNormal.x, y: -roomNormal.y } : roomNormal;
        const openEnd = toPage({ x: rawP1.x + normal.x * o.width, y: rawP1.y + normal.y * o.width });
        doc.setDrawColor(90);
        doc.setLineWidth(0.25);
        doc.line(p1.x, p1.y, openEnd.x, openEnd.y);
        // Quarter-circle swing arc, approximated as a short polyline (jsPDF
        // has no simple SVG-style arc primitive) — centred on the hinge,
        // radius = opening width, from the open leaf end back to the far jamb.
        const hingePage = p1;
        const startAngle = Math.atan2(openEnd.y - hingePage.y, openEnd.x - hingePage.x);
        const endAngle = Math.atan2(p2.y - hingePage.y, p2.x - hingePage.x);
        let sweep = endAngle - startAngle;
        while (sweep <= -Math.PI) sweep += Math.PI * 2;
        while (sweep > Math.PI) sweep -= Math.PI * 2;
        const radiusPage = Math.hypot(openEnd.x - hingePage.x, openEnd.y - hingePage.y);
        const steps = 8;
        let prev = openEnd;
        for (let i = 1; i <= steps; i++) {
          const angle = startAngle + (sweep * i) / steps;
          const next = { x: hingePage.x + radiusPage * Math.cos(angle), y: hingePage.y + radiusPage * Math.sin(angle) };
          doc.line(prev.x, prev.y, next.x, next.y);
          prev = next;
        }
      }
    }

    // Each fitting draws its real symbol shape, coloured by circuit — no
    // code label and no measurement callout alongside it (those were the
    // main sources of clutter on a dense job; the shape on its own is a lot
    // more compact). What each shape means is in the symbol legend below.
    // Drawn at half the legend's icon size — full-size symbols overlap
    // heavily once a room has several fittings close together.
    const PLAN_SYMBOL_SIZE_MM = SYMBOL_SIZE_MM / 2;
    for (const f of fittings) {
      // A wall-mounted fitting's stored position sits exactly on the wall
      // centreline (see snapToNearestWall) — offset into the room, same
      // direction as SetoutCanvas.tsx uses on screen (offsetSymbolIntoRoom),
      // but computed in PAGE mm here rather than reusing that function's
      // scene-unit offset directly. A whole-house plan gets compressed onto
      // one A4 sheet at a very tight scale, so a fixed scene-unit offset
      // (tuned for an interactive on-screen zoom level) can end up smaller
      // on the page than the wall's own rendered stroke width plus the
      // icon's own footprint — leaving the icon still clipping the wall.
      // Doing the offset arithmetic in page space guarantees the icon
      // actually clears the wall's drawn thickness regardless of scale.
      let p = toPage(f.position);
      if (isSingleWallFitting(f.type)) {
        const wall = nearestMountWall(f.position, canvas.walls);
        if (wall) {
          const wallOnPage = toPage(closestPointOnWall(f.position, wall));
          const normal = roomFacingNormal(wall, closestPointOnWall(f.position, wall), centroid);
          const thicknessMetres = wall.kind === "interior" ? canvas.wall_thickness.interior : canvas.wall_thickness.exterior;
          const wallStrokePageMm = Math.max(thicknessMetres * scale, 0.15);
          const clearanceMm = wallStrokePageMm / 2 + PLAN_SYMBOL_SIZE_MM / 2 + 0.3;
          p = { x: wallOnPage.x + normal.x * clearanceMm, y: wallOnPage.y + normal.y * clearanceMm };
        }
      }
      const color = colorForCircuit(circuits, f.circuit_id) ?? UNASSIGNED_SYMBOL_COLOR;
      await drawFittingSymbol(doc, f, p, color, svg2pdf, renderToStaticMarkup, PLAN_SYMBOL_SIZE_MM);
    }
  }

  let ly = planBottom + 4;
  doc.setDrawColor(220);
  doc.line(MARGIN, ly, PAGE_W - MARGIN, ly);
  ly += 5;
  doc.setFontSize(9);
  doc.setTextColor(20);
  doc.text("Symbol legend", MARGIN, ly);
  ly += 4;
  doc.setFontSize(7);

  // One row per distinct TYPE actually used (not per fitting) — a job with
  // 23 GPOs needs one "GPO" row showing what its marker means, not 23
  // identical ones. Shows the real icon glyph, since the plan itself now
  // just marks each point with a plain circle-and-cross rather than a
  // distinct shape per type (see the marker-drawing loop above).
  const ensureLegendSpace = (needed: number) => {
    if (ly + needed > PAGE_H - MARGIN) {
      doc.addPage();
      ly = MARGIN;
    }
  };

  const LEGEND_ICON_MM = 4;
  const LEGEND_ROW_H = 5.5;

  if (fittings.length === 0) {
    doc.setTextColor(120);
    doc.text("No fittings placed yet.", MARGIN, ly);
  } else {
    for (const category of FITTING_CATEGORY_ORDER) {
      const inGroup = fittings.filter((f) => CATEGORY_FOR_TYPE[f.type] === category);
      if (inGroup.length === 0) continue;

      const byType = new Map<FittingType, SetoutFitting[]>();
      for (const f of inGroup) {
        const list = byType.get(f.type) ?? [];
        list.push(f);
        byType.set(f.type, list);
      }

      ensureLegendSpace(3.6 + LEGEND_ROW_H);
      doc.setFontSize(7);
      doc.setTextColor(20);
      doc.text(LAYER_LABELS[category], MARGIN, ly);
      ly += 3.6;

      for (const [type, ofType] of byType) {
        ensureLegendSpace(LEGEND_ROW_H);
        // Drawn upright and in a neutral colour regardless of how any
        // particular instance sits on the plan or which circuit it's on —
        // this row represents the type, not one specific fitting.
        const representative = { ...ofType[0], specs: { ...ofType[0].specs, rotation: 0 } };
        await drawFittingSymbol(
          doc,
          representative,
          { x: MARGIN + 3 + LEGEND_ICON_MM / 2, y: ly + LEGEND_ROW_H / 2 + 1 },
          "#1a1a1a",
          svg2pdf,
          renderToStaticMarkup,
        );
        doc.setFontSize(7.5);
        doc.setTextColor(60);
        const count = ofType.length;
        doc.text(
          `${FITTING_LABELS[type]}${count > 1 ? ` (×${count})` : ""}`,
          MARGIN + 3 + LEGEND_ICON_MM + 3,
          ly + LEGEND_ROW_H / 2 + 1,
        );
        ly += LEGEND_ROW_H;
      }
    }
  }
}

// A proper ruled circuit schedule / switchboard directory card — the AU
// trade convention — rather than a plain text list: Circuit | Breaker |
// Points served columns, a colour swatch per row matching that circuit's
// on-screen colour (colorForCircuit), shaded header, banded rows. This is
// the page meant to be printed and stuck inside the switchboard door, so it
// carries its own business-branded header (not drawPageHeader's plain title)
// and a frame border on every page, rather than the working-document look
// the other report pages have.
async function drawSwitchboardPage(
  doc: jsPDF,
  plan: SetoutPlan,
  fittings: SetoutFitting[],
  circuits: SetoutCircuit[],
  codes: Map<string, string>,
  business: ReportBusiness,
  reportUrl?: string,
): Promise<void> {
  const FRAME_INSET = 4;
  const drawPageFrame = () => {
    doc.setDrawColor(20);
    doc.setLineWidth(0.6);
    doc.rect(MARGIN - FRAME_INSET, MARGIN - FRAME_INSET, CONTENT_W + FRAME_INSET * 2, PAGE_H - (MARGIN - FRAME_INSET) * 2);
  };
  drawPageFrame();

  let y = MARGIN;

  // ── Header: logo + business info (same convention as auditReport.ts) ──
  let headerBottom = y;
  if (business.logoBase64) {
    try {
      const { w, h } = await loadImageSize(business.logoBase64);
      const logoH = 16;
      const logoW = Math.min(40, (w / h) * logoH);
      doc.addImage(business.logoBase64, "JPEG", MARGIN, y, logoW, logoH);
      headerBottom = Math.max(headerBottom, y + logoH);
    } catch {
      // Logo failed to embed — the legend still prints without it.
    }
  }
  const businessLines = [
    business.name,
    business.licenceNumber ? `Licence No. ${business.licenceNumber}` : null,
    business.phone ? `Ph: ${business.phone}` : null,
    business.email || null,
  ].filter(Boolean) as string[];
  if (businessLines.length) {
    doc.setFontSize(9);
    doc.setTextColor(80);
    businessLines.forEach((line, i) => doc.text(line, PAGE_W - MARGIN, y + 4 + i * 4.5, { align: "right" }));
    headerBottom = Math.max(headerBottom, y + 4 + businessLines.length * 4.5);
  }
  y = headerBottom + 4;

  doc.setFontSize(15);
  doc.setTextColor(20);
  doc.text("Switchboard legend", MARGIN, y);
  y += 6;
  doc.setFontSize(10);
  doc.setTextColor(90);
  doc.text(plan.name || "Rough-in setout plan", MARGIN, y);
  y += 5;
  if (plan.job_reference) {
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(`Job ref: ${plan.job_reference}`, MARGIN, y);
    y += 5;
  }
  doc.setFontSize(7.5);
  doc.setTextColor(140);
  doc.text(`Printed ${new Date().toLocaleDateString("en-AU")}`, MARGIN, y);
  y += 4;
  doc.setDrawColor(20);
  doc.setLineWidth(0.4);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 6;

  const unassigned = fittings.filter((f) => !f.circuit_id);

  // A real switchboard has a fixed number of pole/breaker positions — the
  // legend should mirror that physical layout so a spare way reads as "not
  // used yet", not as a row that got left off the sheet. 18 covers a typical
  // domestic board; a job with more circuits than that just keeps going.
  const MIN_CIRCUIT_SPOTS = 18;

  const colNoW = 8;
  const colSwatchW = 6;
  const colCircuitW = 44;
  const colBreakerW = 20;
  const colPointsW = CONTENT_W - colNoW - colSwatchW - colCircuitW - colBreakerW;
  const xNo = MARGIN;
  const xSwatch = xNo + colNoW;
  const xCircuit = xSwatch + colSwatchW + 2;
  const xBreaker = xCircuit + colCircuitW;
  const xPoints = xBreaker + colBreakerW;

  const drawHeaderRow = () => {
    doc.setFillColor(235, 237, 240);
    doc.rect(MARGIN, y, CONTENT_W, 7, "F");
    doc.setFontSize(8.5);
    doc.setTextColor(60);
    doc.text("No.", xNo + colNoW / 2, y + 5, { align: "center" });
    doc.text("Circuit", xCircuit, y + 5);
    doc.text("Breaker", xBreaker, y + 5);
    doc.text("Points served", xPoints, y + 5);
    y += 7;
  };

  const ensureSpace = (needed: number) => {
    if (y + needed > PAGE_H - MARGIN) {
      doc.addPage();
      drawPageFrame();
      y = MARGIN;
      drawHeaderRow();
    }
  };

  drawHeaderRow();

  let rowIndex = 0;
  const drawRow = (label: string, breaker: string, pointsText: string, description: string | null, color: string | null, blank = false) => {
    const spotNumber = rowIndex + 1;
    doc.setFontSize(8.5);
    const pointsLines: string[] = blank ? [""] : doc.splitTextToSize(pointsText || "—", colPointsW - 2);
    const descLines: string[] = description ? doc.splitTextToSize(description, colCircuitW + colBreakerW - 2) : [];
    const bodyLines = Math.max(pointsLines.length, 1 + descLines.length);
    const rowH = Math.max(7, bodyLines * 4 + 2);

    ensureSpace(rowH);

    if (rowIndex % 2 === 1) {
      doc.setFillColor(248, 248, 249);
      doc.rect(MARGIN, y, CONTENT_W, rowH, "F");
    }

    doc.setFontSize(8.5);
    doc.setTextColor(blank ? 180 : 60);
    doc.text(String(spotNumber).padStart(2, "0"), xNo + colNoW / 2, y + rowH / 2 + 1.2, { align: "center" });

    if (!blank) {
      if (color) {
        const [r, g, b] = hexToRgb(color);
        doc.setFillColor(r, g, b);
      } else {
        doc.setFillColor(200, 200, 200);
      }
      doc.circle(xSwatch + colSwatchW / 2, y + rowH / 2, 1.8, "F");
    }

    doc.setFontSize(9);
    doc.setTextColor(20);
    doc.text(label, xCircuit, y + 4.5);
    if (descLines.length > 0) {
      doc.setFontSize(7.5);
      doc.setTextColor(110);
      doc.text(descLines, xCircuit, y + 4.5 + 4);
    }

    doc.setFontSize(8.5);
    doc.setTextColor(60);
    doc.text(breaker || (blank ? "" : "—"), xBreaker, y + 4.5);
    doc.text(pointsLines, xPoints, y + 4.5);

    doc.setDrawColor(225);
    doc.setLineWidth(0.15);
    doc.line(MARGIN, y + rowH, MARGIN + CONTENT_W, y + rowH);
    doc.line(xSwatch - 1, y, xSwatch - 1, y + rowH);
    doc.line(xCircuit - 2, y, xCircuit - 2, y + rowH);
    doc.line(xBreaker - 2, y, xBreaker - 2, y + rowH);
    doc.line(xPoints - 2, y, xPoints - 2, y + rowH);

    y += rowH;
    rowIndex++;
  };

  for (const c of circuits) {
    const assigned = fittings.filter((f) => f.circuit_id === c.id);
    const pointsText = assigned.length === 0 ? "None assigned" : assigned.map((f) => codes.get(f.id) ?? "?").join(", ");
    const description = [c.description, solarCircuitDetail(c, fittings)].filter(Boolean).join(" — ") || null;
    drawRow(c.label, c.breaker_rating || "—", pointsText, description, colorForCircuit(circuits, c.id));
  }

  if (unassigned.length > 0) {
    const pointsText = unassigned.map((f) => codes.get(f.id) ?? "?").join(", ");
    drawRow("Unassigned", "—", pointsText, null, null);
  }

  while (rowIndex < MIN_CIRCUIT_SPOTS) {
    drawRow("", "", "", null, null, true);
  }

  if (fittings.some((f) => f.type === "solar_inverter")) {
    ensureSpace(8);
    doc.setFontSize(7);
    doc.setTextColor(130);
    const solarDisclaimerLines = doc.splitTextToSize(
      "Solar circuit voltage rise estimated to AS/NZS 4777.1's 2% inverter-output limit, using AS/NZS 3008.1.1 cable figures — advisory only, verify against the datasheet and DNSP requirements before final cable selection.",
      CONTENT_W
    );
    doc.text(solarDisclaimerLines, MARGIN, y + 4);
    y += solarDisclaimerLines.length * 3.2 + 4;
  }

  // A scannable link to this same report (plan, materials, demand and
  // circuits together), so whoever's at the board later (an electrician on
  // a service call, not necessarily whoever printed this) can pull the
  // whole thing up without needing to be logged into the app. Deliberately
  // not run through ensureSpace — that helper re-draws the circuit table's
  // header row on overflow, which would be wrong for this block.
  if (reportUrl) {
    const qrSize = 22;
    if (y + qrSize + 8 > PAGE_H - MARGIN) {
      doc.addPage();
      drawPageFrame();
      y = MARGIN;
    }
    y += 4;
    doc.setDrawColor(220);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
    y += 5;
    try {
      const QRCode = await import("qrcode");
      const qrDataUrl = await QRCode.toDataURL(reportUrl, { margin: 0, width: 256 });
      doc.addImage(qrDataUrl, "PNG", MARGIN, y, qrSize, qrSize);
      doc.setFontSize(9.5);
      doc.setTextColor(20);
      doc.text("Scan for the full plan & circuit report", MARGIN + qrSize + 4, y + qrSize / 2 - 3);
      doc.setFontSize(7.5);
      doc.setTextColor(120);
      const urlLines = doc.splitTextToSize(reportUrl, CONTENT_W - qrSize - 6);
      doc.text(urlLines, MARGIN + qrSize + 4, y + qrSize / 2 + 2);
    } catch (err) {
      console.error("[setoutReport] Could not generate the report QR code:", err);
    }
  }
}

// The order list. Quantities come from setoutMaterials, which reads each
// fitting's specs — so a 4-gang GPO orders four mechs, a 6-port data plate
// orders six, and an LED run is priced off the length actually drawn rather
// than off a fitting count.
function drawMaterialsPage(doc: jsPDF, plan: SetoutPlan, fittings: SetoutFitting[]): void {
  let y = drawPageHeader(doc, plan, "Materials list");
  const ensureSpace = (needed: number) => {
    if (y + needed > PAGE_H - MARGIN) {
      doc.addPage();
      y = MARGIN;
    }
  };

  const lines = aggregateMaterials(fittings, {
    extrusionStockLengthM: plan.plan_defaults?.ledExtrusionStockLengthM,
    driverSizesW: plan.plan_defaults?.ledDriverSizesW,
    driverHeadroomPct: plan.plan_defaults?.ledDriverHeadroomPct,
  });
  if (lines.length === 0) {
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text("Nothing to order yet — place some fittings first.", MARGIN, y + 4);
    return;
  }

  const QTY_X = PAGE_W - MARGIN - 24;
  let currentGroup = "";

  for (const line of lines) {
    if (line.group !== currentGroup) {
      currentGroup = line.group;
      ensureSpace(12);
      y += 3;
      doc.setFontSize(9);
      doc.setTextColor(20);
      doc.text(currentGroup.toUpperCase(), MARGIN, y);
      y += 2;
      doc.setDrawColor(220);
      doc.line(MARGIN, y, PAGE_W - MARGIN, y);
      y += 5;
    }

    const itemLines = doc.splitTextToSize(line.item, CONTENT_W - 30);
    ensureSpace(Math.max(5, itemLines.length * 4));
    doc.setFontSize(9);
    doc.setTextColor(40);
    doc.text(itemLines, MARGIN, y);
    // Metres to one decimal, counts whole — a "3.0" against a light fitting
    // reads as a misprint on an order.
    const qty = line.unit === "m" ? `${line.qty.toFixed(1)} m` : `${Math.round(line.qty)}`;
    doc.text(qty, QTY_X, y, { align: "right" });
    y += Math.max(5, itemLines.length * 4);
  }

  ensureSpace(14);
  y += 4;
  doc.setFontSize(8);
  doc.setTextColor(130);
  doc.text(
    doc.splitTextToSize(
      "Check quantities before ordering — this list is worked out from what is on the plan and does not include cable, conduit, or fixings.",
      CONTENT_W
    ),
    MARGIN,
    y
  );
}

// Comes after the materials list and before the switchboard legend — the
// board's main switch/consumer main size needs the demand total settled
// before the legend's breaker sizing makes sense.
function drawMaximumDemandPage(
  doc: jsPDF,
  plan: SetoutPlan,
  fittings: SetoutFitting[],
  loadItems: Pick<SetoutLoadItem, "load_group" | "rating_w" | "quantity">[],
): void {
  let y = drawPageHeader(doc, plan, "Maximum demand");
  const ensureSpace = (needed: number) => {
    if (y + needed > PAGE_H - MARGIN) {
      doc.addPage();
      y = MARGIN;
    }
  };

  const result = calculateMaximumDemand(fittings, loadItems, plan.plan_defaults?.supplyPhase);
  const contributing = result.groups.filter((g) => g.amps > 0);

  if (contributing.length === 0) {
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text("Nothing to assess yet — place some fittings or add a load first.", MARGIN, y + 4);
    return;
  }

  const AMPS_X = PAGE_W - MARGIN - 20;
  doc.setFontSize(8.5);
  doc.setTextColor(60);
  doc.text("Load group", MARGIN, y);
  doc.text("Demand", AMPS_X, y, { align: "right" });
  y += 2;
  doc.setDrawColor(220);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 5;

  for (const group of contributing) {
    const detail = group.points !== undefined ? `${group.points.toFixed(1)} points` : group.connectedW ? `${group.connectedW.toFixed(0)} W connected` : null;
    const labelLines = doc.splitTextToSize(group.label, CONTENT_W - 30);
    ensureSpace(Math.max(9, labelLines.length * 4 + (detail ? 3.4 : 0)));
    doc.setFontSize(9);
    doc.setTextColor(30);
    doc.text(labelLines, MARGIN, y);
    doc.text(`${group.amps.toFixed(1)} A`, AMPS_X, y, { align: "right" });
    y += labelLines.length * 4;
    if (detail) {
      doc.setFontSize(7.5);
      doc.setTextColor(130);
      doc.text(`${detail} · ${group.clauseRef}`, MARGIN, y);
      y += 3.4;
    }
    y += 2.5;
  }

  ensureSpace(16);
  doc.setDrawColor(20);
  doc.setLineWidth(0.4);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 6;
  doc.setFontSize(12);
  doc.setTextColor(20);
  doc.text(result.supplyPhase === "three" ? "Total maximum demand (per line)" : "Total maximum demand", MARGIN, y);
  doc.text(`${result.totalAmps.toFixed(1)} A`, AMPS_X, y, { align: "right" });
  y += 5;
  doc.setFontSize(8.5);
  doc.setTextColor(100);
  doc.text(
    result.supplyPhase === "three"
      ? `≈ ${result.totalKva.toFixed(1)} kVA at 400 V three-phase`
      : `≈ ${result.totalKva.toFixed(1)} kVA at 230 V single-phase`,
    MARGIN,
    y,
  );
  y += 8;

  doc.setFontSize(7.5);
  doc.setTextColor(150, 110, 0);
  const disclaimerLines = doc.splitTextToSize(
    `Assessed to AS/NZS 3000:2018 Appendix C, domestic installation (Table C1), ${result.supplyPhase}-phase supply — advisory only, verify before sizing consumer mains or the main switch.` +
      (result.supplyPhase === "three" ? " Assumes the load is evenly balanced across all three phases." : ""),
    CONTENT_W,
  );
  ensureSpace(disclaimerLines.length * 3.6);
  doc.text(disclaimerLines, MARGIN, y);
}

export async function generateSetoutReportPdf(opts: {
  plan: SetoutPlan;
  /** Every drawing surface in this job (one per floor/area) — one plan page
   * gets drawn per canvas, in order. */
  canvases: SetoutCanvas[];
  fittings: SetoutFitting[];
  circuits: SetoutCircuit[];
  loadItems?: SetoutLoadItem[];
  /** Each canvas's own imported drawing (if it has one), keyed by canvas id,
   * so that canvas's plan page shows what was marked up on it. */
  planImages?: Map<string, PlanImage>;
  /** Printed on the switchboard legend's header. */
  business?: ReportBusiness;
  /** Where this same PDF was uploaded — QR-coded on the switchboard legend
   * so anyone at the board can scan straight to the whole report (plan,
   * materials, demand and circuits together), not just the bare plan. No QR
   * is drawn without this, since there'd be nothing for it to point at. */
  reportUrl?: string;
}): Promise<jsPDF> {
  const { plan, canvases, fittings, circuits, loadItems = [], planImages, business = {}, reportUrl } = opts;
  const [{ svg2pdf }, { renderToStaticMarkup }] = await Promise.all([import("svg2pdf.js"), import("react-dom/server")]);
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  // Assigned once across every canvas's fittings combined, so two floors'
  // fittings never collide on the same code (e.g. two "L1" downlights).
  const codes = buildFittingCodes(fittings);

  // One PDF, in the order it gets used on site: the marked-up plan (one page
  // per floor/area), what to order, what it all adds up to for board sizing,
  // then the legend that gets cut out and stuck in the switchboard door.
  // Materials/demand/switchboard cover every canvas's fittings together —
  // one switchboard serves the whole job, not one per floor. All of it
  // together — the legend's QR code links back to this exact file, so
  // scanning it at the board shows the plan and the circuit breakdown, not
  // just a bare drawing.
  for (const canvas of canvases) {
    await drawPlanPage(
      doc,
      plan,
      canvas,
      fittings.filter((f) => f.canvas_id === canvas.id),
      circuits,
      svg2pdf,
      renderToStaticMarkup,
      planImages?.get(canvas.id),
    );
    doc.addPage();
  }
  drawMaterialsPage(doc, plan, fittings);
  doc.addPage();
  drawMaximumDemandPage(doc, plan, fittings, loadItems);
  doc.addPage();
  await drawSwitchboardPage(doc, plan, fittings, circuits, codes, business, reportUrl);

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(`Page ${i} of ${pageCount}`, PAGE_W - MARGIN, PAGE_H - 8, { align: "right" });
  }

  return doc;
}
