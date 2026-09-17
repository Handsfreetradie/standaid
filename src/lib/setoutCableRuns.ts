// Cable-run length estimator: turns a circuit's fittings into a metres
// figure per circuit, instead of the old "N points ≈ N × guess" approach.
//
// ============================================================================
// THE MODEL — a sparky should be able to sanity-check every line of this.
// ============================================================================
// 1. Domestic rough-in runs through the ceiling space. For each point on a
//    circuit, the HORIZONTAL run is the Manhattan distance (|dx| + |dy|,
//    not a straight line) across the plan — cable runs along joists/trusses,
//    not through them diagonally.
// 2. Loop-in, not a star: cable runs board -> nearest point -> next-nearest
//    point -> ... (a nearest-neighbour chain from the board), because that's
//    how a sparky actually loops lights and GPOs, not a home run to each one.
// 3. VERTICAL: the switchboard's own drop (ceiling height − switchboard
//    mounting height, default 1.5 m) is added once per circuit; each point's
//    own drop (ceiling height − its mounting height; a ceiling fitting has
//    no wall-mount height on file, so it defaults to the ceiling itself,
//    giving 0) is added once per point, regardless of its place in the chain.
// 4. Switch loops are separate cable, added on top: for every light a switch
//    controls (specs.gangs), add that switch's own drop plus the horizontal
//    distance from the switch straight to that light — a simplification
//    that assumes the switched light is at ceiling height; it does NOT also
//    add the light's own drop a second time.
// 5. No switchboard placed on that floor yet? Fall back to the plan's nearest
//    drawn corner (or, with no walls drawn either, the fittings' own bounding
//    box) as a stand-in origin, with zero drop, and flag the estimate.
// 6. 10% wastage is added to the raw run, then 1 m per cable END terminated
//    (board + every point + both ends of every switch loop) is added on top
//    of that — terminations are a fixed allowance, not a percentage.
// 7. Result is rounded to the nearest metre, with a 5 m floor per circuit
//    (nobody buys less than a 5 m drum's worth of anything).
//
// Cable size/type per circuit is read in this priority order: the circuit's
// own `cable_csa_mm2`/`cable_type` columns if a migration has added them
// (see CircuitCableColumns below), then a solar circuit's own
// `specs.cableCsaMm2`, then a guess from what's actually wired to the
// circuit (any power/data/heat-cool fitting → power cable; otherwise
// lighting cable), then a hard default.
//
// What this is NOT: a routed conduit path, an AS/3008 voltage-drop check, or
// a real load schedule. It is a "how much cable do I put on the truck"
// estimate — always label it "(est.)" wherever it's shown.
import {
  CATEGORY_FOR_TYPE,
  gangsFor,
  type Point,
  type SetoutCircuit,
  type SetoutFitting,
  type WallSegment,
} from "./setoutTypes";
import { DEFAULT_MOUNTING_HEIGHT, defaultHeightForType } from "./setoutGeometry";
import type { MaterialLine } from "./setoutMaterials";

// Only the fields this module actually needs off a fitting — same
// minimal-Pick convention the rest of setoutTypes/setoutGeometry use, so a
// test (or a future caller) doesn't have to fabricate a whole SetoutFitting
// row (plan_id, category, measurement_lock, status, linked_to, timestamps)
// just to describe a point on a plan.
export type CableRunFitting = Pick<SetoutFitting, "id" | "type" | "specs" | "position" | "circuit_id" | "canvas_id">;

// Same idea for a canvas — only its geometry matters here, for the
// no-switchboard corner fallback.
export type CableRunCanvas = { id: string; walls: WallSegment[] };

// `cable_csa_mm2` / `cable_type` are DB columns another workstream is adding
// to circuits (mirroring `breaker_rating`'s convention: a plain column, not
// a specs field). Declared locally, as an optional intersection, because
// setoutTypes.ts's SetoutCircuit doesn't carry them yet — once that
// migration lands this becomes a no-op passthrough, no change needed here.
export interface CircuitCableColumns {
  cable_csa_mm2?: string | null;
  cable_type?: string | null;
}

export type CableRunCircuit = Pick<SetoutCircuit, "id" | "label" | "circuit_type" | "specs"> & Partial<CircuitCableColumns>;

// Same "typical residential ceiling" assumption lightPoolRadius already
// leans on for a downlight with no mounting height set — reused rather than
// re-guessed, so the two features never quietly disagree about what
// "default ceiling" means.
export const DEFAULT_CEILING_HEIGHT_M = DEFAULT_MOUNTING_HEIGHT;

export const CABLE_WASTAGE_FACTOR = 0.1; // 10% — offcuts, mistakes, drum end
export const TERMINATION_ALLOWANCE_M = 1; // metres added per cable end terminated
export const MIN_CIRCUIT_CABLE_METRES = 5; // nobody orders less than this per circuit

export const DEFAULT_LIGHTING_CABLE_CSA_MM2 = "1.5";
export const DEFAULT_POWER_CABLE_CSA_MM2 = "2.5";
export const DEFAULT_CABLE_TYPE = "TPS twin and earth";

function manhattan(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function centroidOf(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

function boundingBoxCorners(points: Point[]): Point[] {
  if (points.length === 0) return [{ x: 0, y: 0 }];
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return [
    { x: minX, y: minY },
    { x: minX, y: maxY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
  ];
}

function nearestCorner(corners: Point[], to: Point): Point {
  let best = corners[0];
  let bestDistance = Infinity;
  for (const corner of corners) {
    const d = manhattan(corner, to);
    if (d < bestDistance) {
      bestDistance = d;
      best = corner;
    }
  }
  return best;
}

// A fitting's own floor-to-fitting height: what the tradie set, else the
// standard trade height for that wall-mounted type (GPO 0.3m, switch 1.2m,
// switchboard 1.5m, etc — see DEFAULT_HEIGHT_BY_TYPE in setoutGeometry.ts),
// else the ceiling itself — every lighting type with no such entry (a
// downlight, a batten holder, a ceiling fan...) IS the ceiling, so its
// "drop" below correctly comes out to zero without needing a special case
// per lighting type.
function mountingHeightFor(fitting: Pick<CableRunFitting, "type" | "specs">, ceilingHeightM: number): number {
  if (fitting.specs.mountingHeight != null) return fitting.specs.mountingHeight;
  return defaultHeightForType(fitting.type) ?? ceilingHeightM;
}

function dropFor(fitting: Pick<CableRunFitting, "type" | "specs">, ceilingHeightM: number): number {
  return Math.max(0, ceilingHeightM - mountingHeightFor(fitting, ceilingHeightM));
}

// Nearest-neighbour loop-in chain, starting at `start` (the board, or its
// corner stand-in). Greedy, not a travelling-salesman optimum — a real
// sparky doesn't solve TSP either, they just go to whatever's closest next.
function chainHorizontalMetres(start: Point, points: Point[]): number {
  const remaining = [...points];
  let current = start;
  let total = 0;
  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = manhattan(current, remaining[i]);
      if (d < bestDistance) {
        bestDistance = d;
        bestIndex = i;
      }
    }
    total += bestDistance;
    current = remaining[bestIndex];
    remaining.splice(bestIndex, 1);
  }
  return total;
}

interface BoardRef {
  position: Point;
  dropM: number; // 0 when there's no real switchboard to drop from
  isReal: boolean;
}

// The switchboard on this canvas, or — if none has been placed yet — the
// canvas's nearest drawn corner to where this circuit's own points sit
// (falling back to those points' own bounding box if no walls are traced
// either). Either way, one shared origin so the nearest-neighbour chain
// below has somewhere to start counting from.
function resolveBoard(canvasFittings: CableRunFitting[], canvasWalls: WallSegment[] | undefined, circuitPointPositions: Point[], ceilingHeightM: number): BoardRef {
  const board = canvasFittings.find((f) => f.type === "switchboard");
  if (board) return { position: board.position, dropM: dropFor(board, ceilingHeightM), isReal: true };

  const wallPoints = (canvasWalls ?? []).flatMap((w) => [w.start, w.end]);
  const referencePoints = wallPoints.length > 0 ? wallPoints : circuitPointPositions;
  const corners = boundingBoxCorners(referencePoints);
  const centroid = centroidOf(circuitPointPositions.length > 0 ? circuitPointPositions : referencePoints);
  return { position: nearestCorner(corners, centroid), dropM: 0, isReal: false };
}

interface MainLoopResult {
  rawMetres: number;
  pointsCount: number;
  terminationEnds: number;
  assumption: string | null;
}

// The circuit's own loop-in run on one canvas: board -> nearest point ->
// next-nearest -> ... Switches are never "points" here — a switch's cable is
// entirely the separate switch-loop addition below, not a stop on this chain.
function computeMainLoop(board: BoardRef, points: CableRunFitting[], ceilingHeightM: number): MainLoopResult {
  if (points.length === 0) return { rawMetres: 0, pointsCount: 0, terminationEnds: 0, assumption: null };
  const horizontal = chainHorizontalMetres(board.position, points.map((p) => p.position));
  const verticalAtPoints = points.reduce((sum, p) => sum + dropFor(p, ceilingHeightM), 0);
  return {
    rawMetres: horizontal + board.dropM + verticalAtPoints,
    pointsCount: points.length,
    terminationEnds: 1 + points.length, // one end at the board, one at each point
    assumption: board.isReal ? null : "No switchboard placed on this floor — measured from the nearest plan corner instead.",
  };
}

interface SwitchLoopAccumulator {
  metres: number;
  terminationEnds: number;
  loopCount: number;
}

// Every switch-to-light link on the whole plan (specs.gangs), bucketed by
// the LIGHT's own circuit — a switch loop is wired on the same circuit as
// the light it operates, which is the AS/3000 convention regardless of what
// (if anything) the switch fitting's own circuit_id says.
function computeSwitchLoopContributions(fittings: CableRunFitting[], ceilingHeightM: number): Map<string, SwitchLoopAccumulator> {
  const byId = new Map(fittings.map((f) => [f.id, f]));
  const contributions = new Map<string, SwitchLoopAccumulator>();
  for (const sw of fittings) {
    if (sw.type !== "switch") continue;
    const switchDrop = dropFor(sw, ceilingHeightM);
    const targetIds = new Set<string>();
    for (const gang of gangsFor(sw)) for (const id of gang) targetIds.add(id);
    for (const targetId of targetIds) {
      const light = byId.get(targetId);
      if (!light || !light.circuit_id) continue; // unassigned or a ghost link — nothing to attribute this to
      const key = `${light.circuit_id}::${light.canvas_id}`;
      const segment = switchDrop + manhattan(sw.position, light.position);
      const acc = contributions.get(key) ?? { metres: 0, terminationEnds: 0, loopCount: 0 };
      acc.metres += segment;
      acc.terminationEnds += 2; // one end at the switch, one at the light
      acc.loopCount += 1;
      contributions.set(key, acc);
    }
  }
  return contributions;
}

interface ResolvedCable {
  csaMm2: string;
  cableType: string;
}

function resolveCableSpec(circuit: CableRunCircuit, fittingsOnCircuit: CableRunFitting[]): ResolvedCable {
  if (circuit.cable_csa_mm2 && circuit.cable_type) {
    return { csaMm2: circuit.cable_csa_mm2, cableType: circuit.cable_type };
  }
  // Solar's own AC-output spec (checked by setoutSolarVoltageRise.ts) is a
  // real cable choice already made for that circuit — reuse it rather than
  // guessing a power/lighting default underneath it.
  if (circuit.circuit_type === "solar" && circuit.specs.cableCsaMm2) {
    return {
      csaMm2: circuit.specs.cableCsaMm2,
      cableType: circuit.specs.cableMaterial === "aluminium" ? "solar AC (aluminium)" : "solar AC (copper)",
    };
  }
  const isPowerLike = fittingsOnCircuit.some((f) => {
    const category = CATEGORY_FOR_TYPE[f.type];
    return category === "power" || category === "data" || category === "heatCool" || category === "network";
  });
  return isPowerLike
    ? { csaMm2: DEFAULT_POWER_CABLE_CSA_MM2, cableType: DEFAULT_CABLE_TYPE }
    : { csaMm2: DEFAULT_LIGHTING_CABLE_CSA_MM2, cableType: DEFAULT_CABLE_TYPE };
}

export interface CircuitCableEstimate {
  circuitId: string;
  label: string;
  cableLabel: string; // e.g. "1.5 mm² TPS twin and earth"
  csaMm2: string;
  cableType: string;
  metres: number; // rounded to the nearest metre, minimum MIN_CIRCUIT_CABLE_METRES
  pointsCount: number;
  assumptions: string[];
}

export interface CableRunsResult {
  perCircuit: CircuitCableEstimate[];
  /** Grouped by cable size/type across every circuit — ready to append to a materials list. */
  materialLines: MaterialLine[];
}

export function estimateCableRuns(params: {
  fittings: CableRunFitting[];
  circuits: CableRunCircuit[];
  canvases: CableRunCanvas[];
  /** The plan's own ceiling height, if it stores one — else DEFAULT_CEILING_HEIGHT_M. */
  ceilingHeightM?: number;
}): CableRunsResult {
  const ceilingHeightM = params.ceilingHeightM && params.ceilingHeightM > 0 ? params.ceilingHeightM : DEFAULT_CEILING_HEIGHT_M;
  const wallsByCanvas = new Map(params.canvases.map((c) => [c.id, c.walls]));
  const switchLoops = computeSwitchLoopContributions(params.fittings, ceilingHeightM);

  const perCircuit: CircuitCableEstimate[] = [];

  for (const circuit of params.circuits) {
    const circuitFittings = params.fittings.filter((f) => f.circuit_id === circuit.id);
    const byCanvas = new Map<string, CableRunFitting[]>();
    for (const f of circuitFittings) byCanvas.set(f.canvas_id, [...(byCanvas.get(f.canvas_id) ?? []), f]);

    let rawMetres = 0;
    let pointsCount = 0;
    let terminationEnds = 0;
    const assumptions = new Set<string>();

    for (const [canvasId, fittingsOnCanvas] of byCanvas) {
      const points = fittingsOnCanvas.filter((f) => f.type !== "switch" && f.type !== "switchboard");
      const canvasFittings = params.fittings.filter((f) => f.canvas_id === canvasId);
      const board = resolveBoard(canvasFittings, wallsByCanvas.get(canvasId), points.map((p) => p.position), ceilingHeightM);
      const main = computeMainLoop(board, points, ceilingHeightM);
      rawMetres += main.rawMetres;
      pointsCount += main.pointsCount;
      terminationEnds += main.terminationEnds;
      if (main.assumption) assumptions.add(main.assumption);

      const loop = switchLoops.get(`${circuit.id}::${canvasId}`);
      if (loop) {
        rawMetres += loop.metres;
        terminationEnds += loop.terminationEnds;
        assumptions.add(`Includes ${loop.loopCount} switch loop${loop.loopCount > 1 ? "s" : ""}.`);
      }
    }

    if (pointsCount === 0 && rawMetres === 0) continue; // nothing wired to this circuit yet

    const cable = resolveCableSpec(circuit, circuitFittings);
    const withWastage = rawMetres * (1 + CABLE_WASTAGE_FACTOR);
    const withTerminations = withWastage + terminationEnds * TERMINATION_ALLOWANCE_M;
    const metres = Math.max(MIN_CIRCUIT_CABLE_METRES, Math.round(withTerminations));

    perCircuit.push({
      circuitId: circuit.id,
      label: circuit.label,
      cableLabel: `${cable.csaMm2} mm² ${cable.cableType}`,
      csaMm2: cable.csaMm2,
      cableType: cable.cableType,
      metres,
      pointsCount,
      assumptions: Array.from(assumptions),
    });
  }

  const totals = new Map<string, MaterialLine>();
  for (const c of perCircuit) {
    const key = `${c.csaMm2}__${c.cableType}`;
    const existing = totals.get(key);
    if (existing) existing.qty += c.metres;
    else totals.set(key, { item: `${c.cableLabel} (est.)`, qty: c.metres, unit: "m", group: "Cable" });
  }
  const materialLines = Array.from(totals.values()).sort((a, b) => a.item.localeCompare(b.item));

  return { perCircuit, materialLines };
}
