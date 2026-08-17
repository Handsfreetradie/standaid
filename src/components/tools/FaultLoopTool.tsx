import { useState } from "react";
import { Label, Button } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import ToolLayout from "./ToolLayout";
import AddToProjectModal from "./AddToProjectModal";
import { saveCalculationToProject } from "./projectUtils";
import ResultRow from "./ResultRow";
import WorkingTable, { WorkingStep } from "./WorkingTable";

// AS/NZS 3000:2018 Appendix B — maximum earth-fault-loop impedance for MCBs
// (AS/NZS 60898 curves B/C/D only). Method supplied by the lead engineer:
// Zs_max = Uo / (k x In), where k is the instantaneous-trip multiple at the
// TOP of the curve band (conservative, matching Table B1). This satisfies
// both the 0.4 s and 5 s disconnection times via the MCB's magnetic trip.
// On-site measured readings (cold conductors) are held to 0.8 x the table
// value to allow for conductor resistance rise at operating temperature.
// Do not invent, round, or "improve" these constants.
type Curve = "B" | "C" | "D";

const K_BY_CURVE: Record<Curve, number> = { B: 5, C: 10, D: 20 };

const MCB_RATINGS = [6, 10, 16, 20, 25, 32, 40, 50, 63, 80, 100];

interface FaultLoopResult {
  curve: Curve;
  rating: number;
  uo: number;
  tableZs: number;
  measuredLimit: number;
  tripCurrent: number;
  // Optional comparison against the user's own reading
  zs: number | null;
  zsMeasured: boolean;
  appliedLimit: number | null;
  pass: boolean | null;
  margin: number | null;
}

interface Props { onBack: () => void }

const FaultLoopTool = ({ onBack }: Props) => {
  const [curve, setCurve] = useState<Curve>("C");
  const [rating, setRating] = useState("20");
  const [uo, setUo] = useState("230");
  const [zs, setZs] = useState("");
  const [zsMeasured, setZsMeasured] = useState(true);
  const [result, setResult] = useState<FaultLoopResult | null>(null);
  const [showProjectModal, setShowProjectModal] = useState(false);

  const calculate = () => {
    const uoVal = parseFloat(uo);
    const inVal = parseInt(rating, 10);

    if (isNaN(uoVal) || uoVal < 110 || uoVal > 400) return;
    if (isNaN(inVal)) return;

    const k = K_BY_CURVE[curve];
    const tableZs = uoVal / (k * inVal);
    const measuredLimit = 0.8 * tableZs;
    const tripCurrent = k * inVal;

    // Optional: compare the user's own Zs reading if they entered one
    let zsVal: number | null = null;
    let appliedLimit: number | null = null;
    let pass: boolean | null = null;
    let margin: number | null = null;
    const parsedZs = parseFloat(zs);
    if (zs.trim() !== "" && !isNaN(parsedZs) && parsedZs > 0 && parsedZs <= 100) {
      zsVal = parsedZs;
      appliedLimit = zsMeasured ? measuredLimit : tableZs;
      pass = zsVal <= appliedLimit;
      margin = ((appliedLimit - zsVal) / appliedLimit) * 100;
    }

    setResult({
      curve,
      rating: inVal,
      uo: uoVal,
      tableZs,
      measuredLimit,
      tripCurrent,
      zs: zsVal,
      zsMeasured,
      appliedLimit,
      pass,
      margin,
    });
  };

  const workingSteps: WorkingStep[] = result ? [
    {
      label: "Trip current (instantaneous)",
      working: `${K_BY_CURVE[result.curve]} (curve ${result.curve}) × ${result.rating} A`,
      result: `${result.tripCurrent} A`,
      reference: "AS/NZS 3000:2018 App B — curve trip multiple",
    },
    {
      label: "Max Zs (table method)",
      working: `${result.uo} V ÷ ${result.tripCurrent} A`,
      result: `${result.tableZs.toFixed(2)} Ω`,
      reference: "AS/NZS 3000:2018 Table B1 method",
    },
    {
      label: "On-site measured limit",
      working: `0.8 × ${result.tableZs.toFixed(2)} Ω`,
      result: `${result.measuredLimit.toFixed(2)} Ω`,
      reference: "App B — cold conductor allowance",
    },
    ...(result.zs !== null && result.appliedLimit !== null && result.margin !== null ? [{
      label: `Compare your Zs (${result.zsMeasured ? "measured" : "calculated"})`,
      working: `(${result.appliedLimit.toFixed(2)} Ω − ${result.zs} Ω) ÷ ${result.appliedLimit.toFixed(2)} Ω × 100`,
      result: `${result.margin.toFixed(1)}% margin — ${result.pass ? "PASS" : "FAIL"}`,
      reference: result.zsMeasured ? "vs 0.8 × table limit" : "vs table limit",
    }] : []),
  ] : [];

  return (
    <ToolLayout
      title="Fault Loop Impedance (Zs)"
      subtitle="AS/NZS 3000 App B — max Zs for MCB disconnection"
      disclaimer="Maximum Zs computed as Uo/(k×In) with k = 5/10/20 for curve B/C/D MCBs — the method behind AS/NZS 3000:2018 Table B1, satisfying both 0.4 s and 5 s disconnection. On-site measured readings should not exceed 0.8 × the table value per Appendix B practice. Applies to AS/NZS 60898 MCBs only — fuses use Table B1 directly. A circuit over the limit is a safety defect: rectify and re-test before energising. Always confirm against your copy of the standard."
      onBack={onBack}
      onCalculate={calculate}
      verifyQuestion={
        result
          ? `What is the maximum earth fault-loop impedance (Zs) for a Curve ${result.curve} ${result.rating} A MCB at Uo = ${result.uo} V per AS/NZS 3000 Appendix B?`
          : undefined
      }
      result={result ? (
        <>
          <div className={`p-3 rounded-lg mb-3 border ${
            result.pass === false ? "bg-destructive/5 border-destructive/20" : "bg-primary/5 border-primary/20"
          }`}>
            <p className={`text-2xl font-extrabold ${result.pass === false ? "text-destructive" : "text-primary"}`}>
              Max Zs: {result.tableZs.toFixed(2)} Ω
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {result.curve}{result.rating} MCB at {result.uo} V · on-site measured limit {result.measuredLimit.toFixed(2)} Ω (0.8 × table)
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-3">
            <ResultRow label="Table B1 max Zs" value={result.tableZs.toFixed(2)} unit="Ω" variant="primary" />
            <ResultRow label="On-site measured limit (×0.8)" value={result.measuredLimit.toFixed(2)} unit="Ω" variant="primary" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <ResultRow label={`Trip current (${K_BY_CURVE[result.curve]} × In)`} value={result.tripCurrent} unit="A" size="sm" />
            <ResultRow label="Nominal Uo" value={result.uo} unit="V" size="sm" />
          </div>

          {result.zs !== null && result.appliedLimit !== null && result.margin !== null && (
            <>
              <div className="grid grid-cols-2 gap-4 mt-3 pt-3 border-t border-border">
                <ResultRow label={`Your Zs (${result.zsMeasured ? "measured" : "calculated"})`} value={result.zs} unit="Ω"
                  variant={result.pass ? "default" : "destructive"} />
                <ResultRow label="Margin" value={result.margin.toFixed(1)} unit="%"
                  variant={result.margin < 0 ? "destructive" : "default"} />
              </div>
              {!result.pass && (
                <p className="text-xs text-destructive mt-3 font-medium">
                  ⚠️ Your Zs exceeds the {result.zsMeasured ? "0.8 × table" : "table"} limit by {Math.abs(result.margin).toFixed(1)}% —
                  the breaker may not trip within the required disconnection time. Reduce circuit length, increase
                  conductor size, or use a lower-rated / different-curve breaker. Re-test after any change.
                </p>
              )}
              {result.pass && result.margin < 10 && (
                <p className="text-xs text-destructive mt-3 font-medium">
                  ⚠️ Less than 10% margin — verify with a calibrated loop tester and consider the tolerance of your
                  instrument.
                </p>
              )}
            </>
          )}

          <p className="text-xs text-muted-foreground mt-3">
            💡 Compare on-site tester readings against the 0.8 × limit — conductors were cold when you measured, and
            their resistance rises at operating temperature.
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            💡 For fuses, read the maximum Zs directly from AS/NZS 3000 Table B1 — this tool covers MCBs only.
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            💡 Zs limits derive from Uo/(k×In) with k = 5 (B), 10 (C), 20 (D) — the top of each curve's instantaneous
            trip band, per the method behind AS/NZS 3000 Table B1.
          </p>

          <WorkingTable steps={workingSteps} />
        <div className="mt-4 pt-4 border-t">
            <button
              onClick={() => setShowProjectModal(true)}
              className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors text-sm font-medium"
            >
              Add to Project
            </button>
          </div>

        </>
      ) : undefined}
      advancedInputs={
        <>
          <div>
            <Label className="text-sm">Nominal Phase Voltage Uo (V)</Label>
            <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="230"
              value={uo} onChange={(e) => { setUo(e.target.value); setResult(null); }} />
            <p className="text-[10px] text-muted-foreground mt-0.5">Valid range 110–400 V</p>
          </div>
          <div>
            <Label className="text-sm">Compare Your Zs Reading (Ω) — optional</Label>
            <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="e.g. 0.85"
              value={zs} onChange={(e) => { setZs(e.target.value); setResult(null); }} />
            <p className="text-[10px] text-muted-foreground mt-0.5">Leave blank to just get the maximum allowed values</p>
          </div>
          {zs.trim() !== "" && (
            <div>
              <Label className="text-sm">Zs Source</Label>
              <div className="flex gap-2 mt-1 flex-wrap">
                <Badge variant={zsMeasured ? "default" : "outline"}
                  className="cursor-pointer px-3 py-1.5 text-sm"
                  onClick={() => { setZsMeasured(true); setResult(null); }}>
                  Measured on site (×0.8 applied)
                </Badge>
                <Badge variant={!zsMeasured ? "default" : "outline"}
                  className="cursor-pointer px-3 py-1.5 text-sm"
                  onClick={() => { setZsMeasured(false); setResult(null); }}>
                  Calculated at operating temp
                </Badge>
              </div>
            </div>
          )}
        </>
      }
    >
      <div>
        <Label className="text-sm">MCB Curve</Label>
        <div className="flex gap-2 mt-1">
          {(["B", "C", "D"] as const).map((c) => (
            <Badge key={c} variant={curve === c ? "default" : "outline"}
              className="cursor-pointer px-4 py-2 text-sm font-bold"
              onClick={() => { setCurve(c); setResult(null); }}>
              Curve {c}
            </Badge>
          ))}
        </div>
      </div>

      <div>
        <Label className="text-sm">MCB Rating In (A)</Label>
        <Select value={rating} onValueChange={(v) => { setRating(v); setResult(null); }}>
          <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {MCB_RATINGS.map((r) => (
              <SelectItem key={r} value={String(r)}>{r} A</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <AddToProjectModal
        isOpen={showProjectModal}
        onClose={() => setShowProjectModal(false)}
        onSave={(projectId, projectName, calcLabel) => {
          saveCalculationToProject(
            projectId,
            projectName,
            "fault-loop",
            "Fault Loop",
            {}, // Inputs - populate based on tool state
            result,
            `Fault Loop calculation`,
            calcLabel
          );
          setShowProjectModal(false);
        }}
        calculationSummary={result ? `Fault Loop` : ''}
      />
        </ToolLayout>
  );
};

export default FaultLoopTool;
