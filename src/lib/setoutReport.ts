// Builds the Rough-In Setout Assistant PDF summary. Pure function — takes
// plain data (no React/DB/Supabase calls) so the caller decides how the
// plan/fittings/circuits were fetched. Follows the pattern in auditReport.ts.
import jsPDF from "jspdf";
import { FITTING_LABELS } from "@/components/setout/symbols";
import type { FittingType } from "@/components/setout/symbols";
import { CATEGORY_FOR_TYPE, FITTING_CATEGORY_ORDER, gangsFor, LAYER_LABELS, type Point, type SetoutCircuit, type SetoutFitting, type SetoutPlan } from "@/lib/setoutTypes";

const PAGE_W = 210; // A4 mm
const PAGE_H = 297;
const MARGIN = 15;
const CONTENT_W = PAGE_W - MARGIN * 2;

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

function drawPlanPage(doc: jsPDF, plan: SetoutPlan, fittings: SetoutFitting[], codes: Map<string, string>): void {
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

    doc.setDrawColor(60);
    doc.setLineWidth(0.5);
    for (const wall of plan.walls) {
      const a = toPage(wall.start);
      const b = toPage(wall.end);
      doc.line(a.x, a.y, b.x, b.y);
    }

    doc.setLineWidth(0.2);
    for (const f of fittings) {
      const p = toPage(f.position);
      const code = codes.get(f.id) ?? "?";
      doc.setFillColor(30, 100, 200);
      doc.setDrawColor(30, 100, 200);
      doc.circle(p.x, p.y, 1.3, "FD");

      doc.setFontSize(6.5);
      doc.setTextColor(20);
      doc.text(code, p.x + 2, p.y - 1.2);

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

function drawSwitchboardPage(
  doc: jsPDF,
  plan: SetoutPlan,
  fittings: SetoutFitting[],
  circuits: SetoutCircuit[],
  codes: Map<string, string>,
): void {
  let y = drawPageHeader(doc, plan, "Switchboard legend");
  const ensureSpace = (needed: number) => {
    if (y + needed > PAGE_H - MARGIN) {
      doc.addPage();
      y = MARGIN;
    }
  };

  if (circuits.length === 0) {
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text("No circuits set up yet.", MARGIN, y + 4);
    y += 10;
  } else {
    for (const c of circuits) {
      ensureSpace(10);
      doc.setFontSize(10);
      doc.setTextColor(20);
      const rating = c.breaker_rating ? ` (${c.breaker_rating})` : "";
      doc.text(`${c.label}${rating}`, MARGIN, y);
      y += 5;

      if (c.description) {
        doc.setFontSize(8.5);
        doc.setTextColor(90);
        const lines = doc.splitTextToSize(c.description, CONTENT_W);
        ensureSpace(lines.length * 4);
        doc.text(lines, MARGIN, y);
        y += lines.length * 4;
      }

      const assigned = fittings.filter((f) => f.circuit_id === c.id);
      doc.setFontSize(9);
      doc.setTextColor(60);
      if (assigned.length === 0) {
        ensureSpace(5);
        doc.text("No fittings assigned.", MARGIN + 4, y);
        y += 5;
      } else {
        const codesText = assigned.map((f) => codes.get(f.id) ?? "?").join(", ");
        const lines = doc.splitTextToSize(codesText, CONTENT_W - 4);
        ensureSpace(lines.length * 4.2);
        doc.text(lines, MARGIN + 4, y);
        y += lines.length * 4.2;
      }
      y += 4;
      doc.setDrawColor(235);
      doc.line(MARGIN, y - 2, PAGE_W - MARGIN, y - 2);
    }
  }

  const unassigned = fittings.filter((f) => !f.circuit_id);
  if (unassigned.length > 0) {
    ensureSpace(10);
    y += 2;
    doc.setFontSize(10);
    doc.setTextColor(20);
    doc.text("Unassigned", MARGIN, y);
    y += 5;
    doc.setFontSize(9);
    doc.setTextColor(60);
    const codesText = unassigned.map((f) => codes.get(f.id) ?? "?").join(", ");
    const lines = doc.splitTextToSize(codesText, CONTENT_W);
    ensureSpace(lines.length * 4.2);
    doc.text(lines, MARGIN, y);
    y += lines.length * 4.2;
  }
}

export async function generateSetoutReportPdf(opts: {
  plan: SetoutPlan;
  fittings: SetoutFitting[];
  circuits: SetoutCircuit[];
}): Promise<jsPDF> {
  const { plan, fittings, circuits } = opts;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const codes = buildFittingCodes(fittings);

  drawPlanPage(doc, plan, fittings, codes);
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
