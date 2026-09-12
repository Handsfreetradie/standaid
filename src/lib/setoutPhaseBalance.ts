// Recommends which phase (A/B/C) each circuit on a three-phase job should be
// wired to, to keep the three phases as evenly loaded as possible — the same
// judgement call a sparky makes by hand when landing circuits on a board,
// just done for every circuit at once instead of by feel.
//
// Deliberately a plain calculation, not an AI/model call: this is a solved
// bin-balancing problem (multiway number partitioning) with a well-known,
// reliable greedy heuristic — instant, free, and gives the same answer every
// time for the same inputs, which matters more here than open-ended
// reasoning would help.
import type { SetoutCircuit, SetoutFitting } from "./setoutTypes";

export type Phase = "A" | "B" | "C";
export const PHASES: readonly Phase[] = ["A", "B", "C"];

export interface PhaseBalanceRecommendation {
  circuitId: string;
  phase: Phase;
  // Amps parsed from the circuit's own breaker_rating — the "weight" this
  // circuit contributed to the balance. Null when nothing usable was found
  // (blank or unparseable breaker_rating), meaning this circuit was placed
  // by round-robin rather than actually balanced against the others.
  weightAmps: number | null;
}

export interface PhaseBalanceResult {
  recommendations: PhaseBalanceRecommendation[];
  // Total (weighted) amps landed on each phase, for a "does this look even"
  // sanity check.
  totalsByPhase: Record<Phase, number>;
  // Circuits already inherently three-phase (a genuine 3-phase GPO/inverter/
  // etc. assigned to them) — these draw evenly from all three lines by
  // their own nature, so they're excluded from the single-phase balance
  // rather than being (wrongly) assigned to just one of A/B/C.
  threePhaseCircuitIds: string[];
}

// The amp rating out of a free-text breaker rating like "16A", "20 A",
// "2 x 20A" — prefers a number immediately followed by "A" so a leading
// multiplier ("2 x 20A") resolves to the actual 20A rating, not the "2".
// Falls back to the first number at all (covers a plain "16" with no unit).
// Null if the field is blank or has no number in it whatsoever.
function parseBreakerAmps(breakerRating: string | null): number | null {
  if (!breakerRating) return null;
  const withUnit = breakerRating.match(/(\d+(?:\.\d+)?)\s*A\b/i);
  const match = withUnit ?? breakerRating.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function circuitIsThreePhase(circuitId: string, fittings: Pick<SetoutFitting, "circuit_id" | "specs">[]): boolean {
  return fittings.some(
    (f) => f.circuit_id === circuitId && (f.specs.threePhase === true || f.specs.inverterPhase === "three"),
  );
}

// Greedy "put the next-heaviest item on the currently-lightest scale" —
// longest-processing-time-first bin balancing. A simple, well-known
// heuristic for this exact problem (minimising the heaviest of several
// bins), not an exact optimiser, but reliably close to even in practice for
// the handful of circuits a residential/light-commercial board actually has.
export function recommendPhaseSplit(
  circuits: Pick<SetoutCircuit, "id" | "breaker_rating">[],
  fittings: Pick<SetoutFitting, "circuit_id" | "specs">[],
): PhaseBalanceResult {
  const threePhaseCircuitIds = circuits.filter((c) => circuitIsThreePhase(c.id, fittings)).map((c) => c.id);
  const balanceable = circuits.filter((c) => !threePhaseCircuitIds.includes(c.id));

  const weighted = balanceable
    .map((c) => ({ id: c.id, weightAmps: parseBreakerAmps(c.breaker_rating) }))
    .filter((c): c is { id: string; weightAmps: number } => c.weightAmps !== null)
    .sort((a, b) => b.weightAmps - a.weightAmps);
  const unweighted = balanceable.filter((c) => parseBreakerAmps(c.breaker_rating) === null);

  const totals: Record<Phase, number> = { A: 0, B: 0, C: 0 };
  const recommendations: PhaseBalanceRecommendation[] = [];

  for (const c of weighted) {
    const lightest = PHASES.reduce((a, b) => (totals[b] < totals[a] ? b : a));
    totals[lightest] += c.weightAmps;
    recommendations.push({ circuitId: c.id, phase: lightest, weightAmps: c.weightAmps });
  }

  // No breaker rating to weigh — nothing to balance against, so these are
  // just cycled evenly across the three phases (round-robin) rather than
  // all landing on whichever phase happens to be lightest at the time.
  unweighted.forEach((c, i) => {
    recommendations.push({ circuitId: c.id, phase: PHASES[i % PHASES.length], weightAmps: null });
  });

  return { recommendations, totalsByPhase: totals, threePhaseCircuitIds };
}
