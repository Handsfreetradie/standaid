// Builds the Rough-In Setout Assistant PDF summary. Pure function — takes
// plain data (no React/DB/Supabase calls) so the caller decides how the
// plan/fittings/circuits were fetched. Follows the pattern in auditReport.ts.
import jsPDF from "jspdf";
import { createElement } from "react";
import { FITTING_LABELS, FITTING_SYMBOLS } from "@/components/setout/symbols";
import type { FittingType } from "@/components/setout/symbols";
import {
  CATEGORY_FOR_TYPE,
  FITTING_CATEGORY_ORDER,
  colorForCircuit,
  gangsFor,
  symbolExtraPropsFor,
  LAYER_LABELS,
  type Point,
  type SetoutCircuit,
  type SetoutFitting,
  type SetoutPlan,
} from "@/lib/setoutTypes";
import { wallLength, pointAtOffset, wallsCentroid, roomFacingNormal } from "@/lib/setoutGeometry";

const PAGE_W = 210; // A4 mm
const PAGE_H = 297;
const MARGIN = 15;
const CONTENT_W = PAGE_W - MARGIN * 2;
const SYMBOL_SIZE_MM = 5;
const UNASSIGNED_SYMBOL_COLOR = "#1a1a1a";

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
): Promise<void> {
  const Icon = FITTING_SYMBOLS[fitting.type];
  if (!Icon) return;
  const extraProps = symbolExtraPropsFor(fitting);
  const markup = renderToStaticMarkup(createElement(Icon, { size: 24, strokeWidth: 1.5, ...extraProps }));
  const colored = markup.replace(/currentColor/g, color);
  const parsed = new DOMParser().parseFromString(colored, "image/svg+xml");
  const svgEl = parsed.documentElement;
  const rotation = fitting.specs.rotation ?? 0;
  if (rotation) {
    const g = parsed.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("transform", `rotate(${rotation} 12 12)`);
    while (svgEl.firstChild) g.appendChild(svgEl.firstChild);
    svgEl.appendChild(g);
  }
  await svg2pdf(svgEl, doc, {
    x: pagePos.x - SYMBOL_SIZE_MM / 2,
    y: pagePos.y - SYMBOL_SIZE_MM / 2,
    width: SYMBOL_SIZE_MM,
    height: SYMBOL_SIZE_MM,
  });
}

const CODE_PREFIX: Record<FittingType, string> = {
  // Lighting
  downlight: "DL",
  batten_holder: "BH",
  wall_batten_holder: "WBH",
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
  // Switches
  switch: "SW",
  // Power
  gpo: "GPO",
  tv_point: "TV",
  phone_point: "TEL",
  meter_box: "MB",
  nbn_box: "NBN",
  ubo_rhood: "UBO",
  // Data
  data: "DATA",
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
  // Ducted vacuum
  vacuum_unit: "DV",
  vacuum_outlet: "DVO",
};

// Numbers fittings per-type in array order, e.g. first downlight = "DL1".
function buildFittingCodes(fittings: SetoutFitting[]): Map<string, string> {
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
  fittings: SetoutFitting[],
  circuits: SetoutCircuit[],
  codes: Map<string, string>,
  svg2pdf: Svg2Pdf,
  renderToStaticMarkup: RenderToStaticMarkup,
): Promise<void> {
  let y = drawPageHeader(doc, plan, "Marked-up plan");

  doc.setFontSize(8);
  doc.setTextColor(150, 110, 0);
  const disclaimerLines = doc.splitTextToSize(
    "Internal working document — not a certified drawing. Wall-locked measurements are for laser-up on site; always verify before cutting in.",
    CONTENT_W,
  );
  doc.text(disclaimerLines, MARGIN, y);
  y += disclaimerLines.length * 3.6 + 4;

  // Legend height depends on fitting count (plus one header row per
  // category group actually in use) so the plan drawing gets the rest of
  // the page rather than a fixed, often-wasted, split.
  const usedCategories = new Set(fittings.map((f) => CATEGORY_FOR_TYPE[f.type]));
  const legendRows = Math.max(fittings.length, 1) + usedCategories.size;
  const legendH = 10 + legendRows * 3.6;
  const planTop = y;
  const planBottom = PAGE_H - MARGIN - legendH - 4;
  const planAreaH = Math.max(planBottom - planTop, 20);
  const planAreaW = CONTENT_W;

  if (plan.walls.length === 0) {
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text("No walls drawn for this plan yet.", MARGIN, planTop + 10);
  } else {
    const xs = plan.walls.flatMap((w) => [w.start.x, w.end.x]);
    const ys = plan.walls.flatMap((w) => [w.start.y, w.end.y]);
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

    const centroid = wallsCentroid(plan.walls);
    for (const wall of plan.walls) {
      const wallOpenings = (plan.openings ?? []).filter((o) => o.wallId === wall.id).sort((a, b) => a.offset - b.offset);
      const len = wallLength(wall);
      doc.setDrawColor(60);
      doc.setLineWidth(wall.kind === "interior" ? 0.3 : 0.5);
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
        const normal = roomFacingNormal(wall, rawP1, centroid);
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

    for (const f of fittings) {
      const p = toPage(f.position);
      const code = codes.get(f.id) ?? "?";
      const color = colorForCircuit(circuits, f.circuit_id) ?? UNASSIGNED_SYMBOL_COLOR;
      await drawFittingSymbol(doc, f, p, color, svg2pdf, renderToStaticMarkup);

      doc.setFontSize(6.5);
      const [r, g, b] = hexToRgb(color);
      doc.setTextColor(r, g, b);
      doc.text(code, p.x + 3, p.y - 1.2);

      if (f.measurement_lock) {
        doc.setFontSize(5.5);
        doc.setTextColor(100);
        const { wallA, wallB } = f.measurement_lock;
        const label = wallB
          ? `${wallA.distance.toFixed(1)}m / ${wallB.distance.toFixed(1)}m`
          : `${wallA.distance.toFixed(1)}m${f.specs.mountingHeight != null ? ` @ ${f.specs.mountingHeight.toFixed(1)}m` : ""}`;
        doc.text(label, p.x + 2, p.y + 2.2);
      }
    }
  }

  let ly = planBottom + 4;
  doc.setDrawColor(220);
  doc.line(MARGIN, ly, PAGE_W - MARGIN, ly);
  ly += 5;
  doc.setFontSize(9);
  doc.setTextColor(20);
  doc.text("Legend", MARGIN, ly);
  ly += 4;
  doc.setFontSize(7);
  if (fittings.length === 0) {
    doc.setTextColor(120);
    doc.text("No fittings placed yet.", MARGIN, ly);
  } else {
    for (const category of FITTING_CATEGORY_ORDER) {
      const inGroup = fittings.filter((f) => CATEGORY_FOR_TYPE[f.type] === category);
      if (inGroup.length === 0) continue;
      doc.setFontSize(7);
      doc.setTextColor(20);
      doc.text(LAYER_LABELS[category], MARGIN, ly);
      ly += 3.6;
      doc.setTextColor(60);
      for (const f of inGroup) {
        const code = codes.get(f.id) ?? "?";
        const status = f.status === "confirmed" ? " (confirmed)" : "";
        doc.text(`${code} — ${FITTING_LABELS[f.type]}${status}`, MARGIN + 3, ly);
        ly += 3.6;
      }
    }
  }
}

function drawMeasurementPage(doc: jsPDF, plan: SetoutPlan, fittings: SetoutFitting[], codes: Map<string, string>): void {
  let y = drawPageHeader(doc, plan, "Measurement list");
  const ensureSpace = (needed: number) => {
    if (y + needed > PAGE_H - MARGIN) {
      doc.addPage();
      y = MARGIN;
    }
  };

  const locked = fittings.filter((f) => f.measurement_lock);
  if (locked.length === 0) {
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text("No wall-locked measurements yet.", MARGIN, y + 4);
    return;
  }

  // Same "Wall N" convention as MeasurementListPanel.tsx (1-based array index).
  const wallLabel = (wallId: string) => {
    const idx = plan.walls.findIndex((w) => w.id === wallId);
    return idx === -1 ? "Wall" : `Wall ${idx + 1}`;
  };

  doc.setFontSize(9);
  doc.setTextColor(20);
  doc.text("Code", MARGIN, y);
  doc.text("Type", MARGIN + 22, y);
  doc.text("Measurements", MARGIN + 70, y);
  y += 2;
  doc.setDrawColor(220);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 5;

  for (const f of locked) {
    const lock = f.measurement_lock!;
    const measureText = lock.wallB
      ? `${wallLabel(lock.wallA.wallId)}: ${lock.wallA.distance.toFixed(2)}m, ${wallLabel(lock.wallB.wallId)}: ${lock.wallB.distance.toFixed(2)}m`
      : `${wallLabel(lock.wallA.wallId)}: ${lock.wallA.distance.toFixed(2)}m${f.specs.mountingHeight != null ? `, Height: ${f.specs.mountingHeight.toFixed(2)}m` : ""}`;
    const lines = doc.splitTextToSize(measureText, CONTENT_W - 70);
    ensureSpace(Math.max(5, lines.length * 4));

    doc.setFontSize(9);
    doc.setTextColor(40);
    doc.text(codes.get(f.id) ?? "?", MARGIN, y);
    doc.text(FITTING_LABELS[f.type], MARGIN + 22, y);
    doc.text(lines, MARGIN + 70, y);
    y += Math.max(5, lines.length * 4);
  }
}

function drawCableRunPage(doc: jsPDF, plan: SetoutPlan, fittings: SetoutFitting[], codes: Map<string, string>): void {
  let y = drawPageHeader(doc, plan, "Cable-run / switch order list");
  const ensureSpace = (needed: number) => {
    if (y + needed > PAGE_H - MARGIN) {
      doc.addPage();
      y = MARGIN;
    }
  };

  const switches = fittings.filter((f) => f.type === "switch");
  if (switches.length === 0) {
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text("No switches placed yet.", MARGIN, y + 4);
    return;
  }

  // N-way derivation: count how many gangs — across any switch — list this
  // target, not just how many switches. A 2-gang plate's two gangs are
  // independent circuits, same as two separate switches.
  const wayCount = (targetId: string) => switches.reduce((n, s) => n + gangsFor(s).filter((gang) => gang.includes(targetId)).length, 0);

  for (const sw of switches) {
    const gangs = gangsFor(sw);
    ensureSpace(6);
    doc.setFontSize(10);
    doc.setTextColor(20);
    doc.text(`${codes.get(sw.id) ?? "?"}${gangs.length > 1 ? ` (${gangs.length}-gang)` : ""}`, MARGIN, y);
    y += 5;

    doc.setFontSize(9);
    doc.setTextColor(60);
    gangs.forEach((gang, gangIndex) => {
      const gangLabel = gangs.length > 1 ? `Gang ${gangIndex + 1}: ` : "";
      if (gang.length === 0) {
        ensureSpace(5);
        doc.text(`${gangLabel}Not linked to anything yet`, MARGIN + 4, y);
        y += 5;
        return;
      }
      // Each gang is a loop-in chain in tap order (switch -> first light ->
      // second light -> ...), not a set of separate home-runs — same
      // topology as SetoutCanvas.tsx's switchLinks and SwitchLinksPanel.tsx.
      const parts = gang
        .map((id) => fittings.find((f) => f.id === id))
        .filter((f): f is SetoutFitting => !!f)
        .map((target) => {
          const code = codes.get(target.id) ?? "?";
          const ways = wayCount(target.id);
          return ways > 1 ? `${code} (${ways}-way)` : code;
        });
      const lines = doc.splitTextToSize(`${gangLabel}${codes.get(sw.id) ?? "?"} -> ${parts.join(" -> ")}`, CONTENT_W - 4);
      ensureSpace(lines.length * 4.2);
      doc.text(lines, MARGIN + 4, y);
      y += lines.length * 4.2;
    });
    y += 3;
  }
}

// A proper ruled circuit schedule / switchboard directory card — the AU
// trade convention — rather than a plain text list: Circuit | Breaker |
// Points served columns, a colour swatch per row matching that circuit's
// on-screen colour (colorForCircuit), shaded header, banded rows.
function drawSwitchboardPage(
  doc: jsPDF,
  plan: SetoutPlan,
  fittings: SetoutFitting[],
  circuits: SetoutCircuit[],
  codes: Map<string, string>,
): void {
  let y = drawPageHeader(doc, plan, "Switchboard legend");

  const unassigned = fittings.filter((f) => !f.circuit_id);
  if (circuits.length === 0 && unassigned.length === 0) {
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text("No circuits set up yet.", MARGIN, y + 4);
    return;
  }

  const colSwatchW = 6;
  const colCircuitW = 48;
  const colBreakerW = 20;
  const colPointsW = CONTENT_W - colSwatchW - colCircuitW - colBreakerW;
  const xSwatch = MARGIN;
  const xCircuit = xSwatch + colSwatchW + 2;
  const xBreaker = xCircuit + colCircuitW;
  const xPoints = xBreaker + colBreakerW;

  const drawHeaderRow = () => {
    doc.setFillColor(235, 237, 240);
    doc.rect(MARGIN, y, CONTENT_W, 7, "F");
    doc.setFontSize(8.5);
    doc.setTextColor(60);
    doc.text("Circuit", xCircuit, y + 5);
    doc.text("Breaker", xBreaker, y + 5);
    doc.text("Points served", xPoints, y + 5);
    y += 7;
  };

  const ensureSpace = (needed: number) => {
    if (y + needed > PAGE_H - MARGIN) {
      doc.addPage();
      y = MARGIN;
      drawHeaderRow();
    }
  };

  drawHeaderRow();

  let rowIndex = 0;
  const drawRow = (label: string, breaker: string, pointsText: string, description: string | null, color: string | null) => {
    doc.setFontSize(8.5);
    const pointsLines: string[] = doc.splitTextToSize(pointsText || "—", colPointsW - 2);
    const descLines: string[] = description ? doc.splitTextToSize(description, colCircuitW + colBreakerW - 2) : [];
    const bodyLines = Math.max(pointsLines.length, 1 + descLines.length);
    const rowH = Math.max(7, bodyLines * 4 + 2);

    ensureSpace(rowH);

    if (rowIndex % 2 === 1) {
      doc.setFillColor(248, 248, 249);
      doc.rect(MARGIN, y, CONTENT_W, rowH, "F");
    }

    if (color) {
      const [r, g, b] = hexToRgb(color);
      doc.setFillColor(r, g, b);
    } else {
      doc.setFillColor(200, 200, 200);
    }
    doc.circle(xSwatch + colSwatchW / 2, y + rowH / 2, 1.8, "F");

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
    doc.text(breaker || "—", xBreaker, y + 4.5);
    doc.text(pointsLines, xPoints, y + 4.5);

    doc.setDrawColor(225);
    doc.setLineWidth(0.15);
    doc.line(MARGIN, y + rowH, MARGIN + CONTENT_W, y + rowH);
    doc.line(xCircuit - 2, y, xCircuit - 2, y + rowH);
    doc.line(xBreaker - 2, y, xBreaker - 2, y + rowH);
    doc.line(xPoints - 2, y, xPoints - 2, y + rowH);

    y += rowH;
    rowIndex++;
  };

  for (const c of circuits) {
    const assigned = fittings.filter((f) => f.circuit_id === c.id);
    const pointsText = assigned.length === 0 ? "None assigned" : assigned.map((f) => codes.get(f.id) ?? "?").join(", ");
    drawRow(c.label, c.breaker_rating || "—", pointsText, c.description || null, colorForCircuit(circuits, c.id));
  }

  if (unassigned.length > 0) {
    const pointsText = unassigned.map((f) => codes.get(f.id) ?? "?").join(", ");
    drawRow("Unassigned", "—", pointsText, null, null);
  }
}

export async function generateSetoutReportPdf(opts: {
  plan: SetoutPlan;
  fittings: SetoutFitting[];
  circuits: SetoutCircuit[];
}): Promise<jsPDF> {
  const { plan, fittings, circuits } = opts;
  const [{ svg2pdf }, { renderToStaticMarkup }] = await Promise.all([import("svg2pdf.js"), import("react-dom/server")]);
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const codes = buildFittingCodes(fittings);

  await drawPlanPage(doc, plan, fittings, circuits, codes, svg2pdf, renderToStaticMarkup);
  doc.addPage();
  drawMeasurementPage(doc, plan, fittings, codes);
  doc.addPage();
  drawCableRunPage(doc, plan, fittings, codes);
  doc.addPage();
  drawSwitchboardPage(doc, plan, fittings, circuits, codes);

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(`Page ${i} of ${pageCount}`, PAGE_W - MARGIN, PAGE_H - 8, { align: "right" });
  }

  return doc;
}
