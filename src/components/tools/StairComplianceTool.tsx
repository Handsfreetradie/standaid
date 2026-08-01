import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import ToolLayout from "./ToolLayout";
import ResultRow from "./ResultRow";

// NCC riser / going / 2R+G limits.
// Private stairs — Class 1 dwellings: NCC Volume Two (Housing Provisions).
// Public stairs — Class 2-9 buildings: NCC Volume One.
// Transcribed from the lead engineer's brief (2026-08-01). Always confirm
// against the current NCC edition adopted in the user's state.
type StairClass = "private" | "public";

interface StairLimits {
  minRiser: number;
  maxRiser: number;
  minGoing: number;
  maxGoing: number;
  minSum: number;
  maxSum: number;
}

const NCC_LIMITS: Record<StairClass, StairLimits> = {
  private: { minRiser: 115, maxRiser: 190, minGoing: 240, maxGoing: 355, minSum: 550, maxSum: 700 },
  public: { minRiser: 115, maxRiser: 180, minGoing: 250, maxGoing: 355, minSum: 550, maxSum: 700 },
};

const MAX_RISERS_PER_FLIGHT = 18;
const COMFORT_TARGET = 660; // 2R + G target used to pick a default going when no run is supplied
const COMFORT_OPTIMUM = 625; // 2R + G comfort optimum used to rank compliant candidates

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const shortfall = (v: number, min: number, max: number) => (v < min ? min - v : v > max ? v - max : 0);

interface Candidate {
  n: number;
  riser: number;
  going: number; // NaN when not applicable (single-riser stair, n === 1)
  sum: number; // NaN when going is NaN
  riserOk: boolean;
  goingOk: boolean;
  sumOk: boolean;
  compliant: boolean;
  totalShortfall: number;
}

const buildCandidate = (n: number, totalRise: number, run: number | null, limits: StairLimits): Candidate => {
  const riser = totalRise / n;
  let going = NaN;
  if (n > 1) {
    going = run
      ? run / (n - 1)
      : clamp(COMFORT_TARGET - 2 * riser, limits.minGoing, limits.maxGoing);
  }
  const sum = Number.isNaN(going) ? NaN : 2 * riser + going;

  const riserOk = riser >= limits.minRiser && riser <= limits.maxRiser;
  const goingOk = Number.isNaN(going) ? true : going >= limits.minGoing && going <= limits.maxGoing;
  const sumOk = Number.isNaN(sum) ? true : sum >= limits.minSum && sum <= limits.maxSum;

  const totalShortfall =
    shortfall(riser, limits.minRiser, limits.maxRiser) +
    (Number.isNaN(going) ? 0 : shortfall(going, limits.minGoing, limits.maxGoing)) +
    (Number.isNaN(sum) ? 0 : shortfall(sum, limits.minSum, limits.maxSum));

  return { n, riser, going, sum, riserOk, goingOk, sumOk, compliant: riserOk && goingOk && sumOk, totalShortfall };
};

interface StairResult {
  compliant: boolean;
  noValidConfig: boolean;
  candidate: Candidate | null;
  limits: StairLimits;
  failReasons: string[];
  suggestion: string | null;
}

interface Props { onBack: () => void }

const StairComplianceTool = ({ onBack }: Props) => {
  const [stairClass, setStairClass] = useState<StairClass>("private");
  const [totalRise, setTotalRise] = useState("");
  const [totalRun, setTotalRun] = useState("");
  const [result, setResult] = useState<StairResult | null>(null);

  const calculate = () => {
    const rise = parseFloat(totalRise);
    if (isNaN(rise) || rise <= 0 || rise > 6000) { setResult(null); return; }

    const runInput = totalRun.trim() === "" ? NaN : parseFloat(totalRun);
    const run = !isNaN(runInput) && runInput > 0 ? runInput : null;

    const limits = NCC_LIMITS[stairClass];

    // n from ceil(rise/maxRiser) to floor(rise/minRiser), capped at 18 risers per flight.
    const nMin = Math.ceil(rise / limits.maxRiser);
    const nMax = Math.min(Math.floor(rise / limits.minRiser), MAX_RISERS_PER_FLIGHT);

    if (nMin > nMax) {
      setResult({
        compliant: false,
        noValidConfig: true,
        candidate: null,
        limits,
        failReasons: [
          "Total rise cannot be divided into compliant risers in a single flight — a landing / multiple flights are required",
        ],
        suggestion: null,
      });
      return;
    }

    const candidateNs: number[] = [];
    for (let n = nMin; n <= nMax; n++) candidateNs.push(n);

    const candidates = candidateNs.map((n) => buildCandidate(n, rise, run, limits));
    const compliantCandidates = candidates.filter((c) => c.compliant);

    const closestToComfort = (a: Candidate, b: Candidate) => {
      const da = Math.abs((Number.isNaN(a.sum) ? COMFORT_OPTIMUM : a.sum) - COMFORT_OPTIMUM);
      const db = Math.abs((Number.isNaN(b.sum) ? COMFORT_OPTIMUM : b.sum) - COMFORT_OPTIMUM);
      return da < db ? a : b;
    };

    const chosen = compliantCandidates.length > 0
      ? compliantCandidates.reduce(closestToComfort)
      : candidates.reduce((best, c) => (c.totalShortfall < best.totalShortfall ? c : best));

    const failReasons: string[] = [];
    if (!chosen.compliant) {
      if (!chosen.riserOk) {
        const below = chosen.riser < limits.minRiser;
        const by = below ? limits.minRiser - chosen.riser : chosen.riser - limits.maxRiser;
        failReasons.push(`Riser ${chosen.riser.toFixed(1)} mm is ${by.toFixed(1)} mm ${below ? "below" : "above"} the ${limits.minRiser}–${limits.maxRiser} mm limit`);
      }
      if (!chosen.goingOk) {
        const below = chosen.going < limits.minGoing;
        const by = below ? limits.minGoing - chosen.going : chosen.going - limits.maxGoing;
        failReasons.push(`Going ${chosen.going.toFixed(1)} mm is ${by.toFixed(1)} mm ${below ? "below" : "above"} the ${limits.minGoing}–${limits.maxGoing} mm limit`);
      }
      if (!chosen.sumOk) {
        const below = chosen.sum < limits.minSum;
        const by = below ? limits.minSum - chosen.sum : chosen.sum - limits.maxSum;
        failReasons.push(`2R+G ${chosen.sum.toFixed(1)} mm is ${by.toFixed(1)} mm ${below ? "below" : "above"} the ${limits.minSum}–${limits.maxSum} mm limit`);
      }
    }

    // Suggestion: nearest compliant configuration using the comfort-target going
    // (i.e. ignoring the user's supplied run), shown only when the chosen result fails.
    let suggestion: string | null = null;
    if (!chosen.compliant) {
      const idealCandidates = candidateNs.map((n) => buildCandidate(n, rise, null, limits));
      const idealCompliant = idealCandidates.filter((c) => c.compliant);
      if (idealCompliant.length > 0) {
        const best = idealCompliant.reduce(closestToComfort);
        const requiredRun = Math.round(best.going * (best.n - 1));
        suggestion = `With a total run of ${requiredRun} mm, ${best.n} risers @ ${best.riser.toFixed(1)} mm / going ${best.going.toFixed(1)} mm would comply.`;
      }
    }

    setResult({ compliant: chosen.compliant, noValidConfig: false, candidate: chosen, limits, failReasons, suggestion });
  };

  return (
    <ToolLayout
      title="Stair Rise & Going"
      subtitle="NCC riser, going & 2R+G compliance check"
      disclaimer="Limits from NCC (Class 1 housing provisions and Vol One for public stairs): riser, going and 2R+G ranges as tabulated. Landings, headroom, handrails, balustrades, slip resistance and open-riser limits are separate NCC requirements not checked here. Always confirm against the current NCC edition adopted in your state."
      onBack={onBack}
      onCalculate={calculate}
      verifyQuestion={
        result
          ? `What are the NCC riser and going limits for a ${stairClass === "private" ? "private (Class 1)" : "public (Class 2-9)"} stair?`
          : undefined
      }
      result={result ? (
        <>
          {result.noValidConfig || !result.candidate ? (
            <div className="p-3 rounded-lg mb-3 border bg-destructive/5 border-destructive/20">
              <p className="text-sm font-extrabold text-destructive">FAIL — outside NCC limits</p>
              <p className="text-xs text-destructive mt-3 font-medium">⚠️ {result.failReasons[0]}</p>
            </div>
          ) : (
            <>
              <div className={`p-3 rounded-lg mb-3 border ${result.compliant ? "bg-primary/5 border-primary/20" : "bg-destructive/5 border-destructive/20"}`}>
                <p className={`text-sm font-extrabold ${result.compliant ? "text-primary" : "text-destructive"}`}>
                  {result.compliant ? "PASS — compliant stair" : "FAIL — outside NCC limits"}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {result.candidate.n} risers @ {result.candidate.riser.toFixed(1)} mm · going {Number.isNaN(result.candidate.going) ? "N/A" : `${result.candidate.going.toFixed(1)} mm`}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <ResultRow label="Risers (count)" value={result.candidate.n} size="sm" />
                <ResultRow
                  label={`Riser (${result.limits.minRiser}–${result.limits.maxRiser})`}
                  value={result.candidate.riser.toFixed(1)}
                  unit="mm"
                  variant={result.candidate.riserOk ? "default" : "destructive"}
                />
                <ResultRow
                  label={`Going (${result.limits.minGoing}–${result.limits.maxGoing})`}
                  value={Number.isNaN(result.candidate.going) ? "N/A" : result.candidate.going.toFixed(1)}
                  unit={Number.isNaN(result.candidate.going) ? undefined : "mm"}
                  variant={result.candidate.goingOk ? "default" : "destructive"}
                />
                <ResultRow
                  label={`2R+G (${result.limits.minSum}–${result.limits.maxSum})`}
                  value={Number.isNaN(result.candidate.sum) ? "N/A" : result.candidate.sum.toFixed(1)}
                  unit={Number.isNaN(result.candidate.sum) ? undefined : "mm"}
                  variant={result.candidate.sumOk ? "default" : "destructive"}
                />
              </div>
              {!result.compliant && result.failReasons.map((r, i) => (
                <p key={i} className="text-xs text-destructive mt-3 font-medium">⚠️ {r}</p>
              ))}
              {!result.compliant && result.suggestion && (
                <p className="text-xs text-muted-foreground mt-2">💡 {result.suggestion}</p>
              )}
            </>
          )}
          <p className="text-xs text-muted-foreground mt-3">
            💡 Risers and goings must be uniform through the flight; check landing, headroom (2000 mm min) and handrail requirements separately.
          </p>
        </>
      ) : undefined}
    >
      <div>
        <Label className="text-sm">Stair Class</Label>
        <div className="flex gap-2 mt-1">
          {([["private", "Private (house)"], ["public", "Public (commercial)"]] as const).map(([k, l]) => (
            <Badge
              key={k}
              variant={stairClass === k ? "default" : "outline"}
              className="cursor-pointer px-3 py-1.5 text-sm"
              onClick={() => { setStairClass(k as StairClass); setResult(null); }}
            >
              {l}
            </Badge>
          ))}
        </div>
      </div>
      <div>
        <Label className="text-sm">Total Rise (mm)</Label>
        <Input
          type="number"
          inputMode="decimal"
          className="h-11 mt-1"
          placeholder="e.g. 2700"
          value={totalRise}
          onChange={(e) => { setTotalRise(e.target.value); setResult(null); }}
        />
        <p className="text-[10px] text-muted-foreground mt-0.5">Floor-to-floor height</p>
      </div>
      <div>
        <Label className="text-sm">Total Run (mm) — optional</Label>
        <Input
          type="number"
          inputMode="decimal"
          className="h-11 mt-1"
          placeholder="e.g. 3800"
          value={totalRun}
          onChange={(e) => { setTotalRun(e.target.value); setResult(null); }}
        />
        <p className="text-[10px] text-muted-foreground mt-0.5">Available horizontal run — leave blank to use a comfortable default going</p>
      </div>
    </ToolLayout>
  );
};

export default StairComplianceTool;
