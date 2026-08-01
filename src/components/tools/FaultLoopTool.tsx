import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import ToolLayout from "./ToolLayout";
import ResultRow from "./ResultRow";

// AS/NZS 3000:2018 Appendix B — maximum earth-fault-loop impedance for MCBs
// (AS/NZS 60898 curves B/C/D only). Method supplied by the lead engineer:
// Zs_max = Uo / (k x In), where k is the instantaneous-trip multiple at the
// TOP of the curve band (conservative, matching Table B1). This satisfies
// both the 0.4 s and 5 s disconnection times via the MCB's magnetic trip.
// Do not invent, round, or "improve" these constants.
type Curve = "B" | "C" | "D";

const K_BY_CURVE: Record<Curve, number> = { B: 5, C: 10, D: 20 };

const MCB_RATINGS = [6, 10, 16, 20, 25, 32, 40, 50, 63, 80, 100];

interface FaultLoopResult {
  curve: Curve;
  rating: number;
  measured: boolean;
  zs: number;
  uo: number;
  tableZs: number;
  appliedLimit: number;
  pass: boolean;
  margin: number;
  faultCurrent: number;
}

interface Props { onBack: () => void }

const FaultLoopTool = ({ onBack }: Props) => {
  const [curve, setCurve] = useState<Curve>("C");
  const [rating, setRating] = useState("20");
  const [measured, setMeasured] = useState(true);
  const [zs, setZs] = useState("");
  const [uo, setUo] = useState("230");
  const [result, setResult] = useState<FaultLoopResult | null>(null);

  const calculate = () => {
    const uoVal = parseFloat(uo);
    const zsVal = parseFloat(zs);
    const inVal = parseInt(rating, 10);

    if (isNaN(uoVal) || uoVal < 110 || uoVal > 400) return;
    if (isNaN(zsVal) || zsVal <= 0 || zsVal > 100) return;
    if (isNaN(inVal)) return;

    const k = K_BY_CURVE[curve];
    const tableZs = uoVal / (k * inVal);
    const appliedLimit = measured ? 0.8 * tableZs : tableZs;
    const pass = zsVal <= appliedLimit;
    const margin = ((appliedLimit - zsVal) / appliedLimit) * 100;
    const faultCurrent = uoVal / zsVal;

    setResult({
      curve,
      rating: inVal,
      measured,
      zs: zsVal,
      uo: uoVal,
      tableZs,
      appliedLimit,
      pass,
      margin,
      faultCurrent,
    });
  };

  return (
    <ToolLayout
      title="Fault Loop Impedance (Zs)"
      subtitle="AS/NZS 3000 App B — max Zs for MCB disconnection"
      disclaimer="Maximum Zs computed as Uo/(k×In) with k = 5/10/20 for curve B/C/D MCBs — the method behind AS/NZS 3000:2018 Table B1, satisfying both 0.4 s and 5 s disconnection. Measured values are compared against 0.8 × the table limit per Appendix B practice. Applies to AS/NZS 60898 MCBs only — fuses use Table B1 directly. A failed circuit is a safety defect: rectify and re-test before energising. Always confirm against your copy of the standard."
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
            result.pass ? "bg-primary/5 border-primary/20" : "bg-destructive/5 border-destructive/20"
          }`}>
            <p className={`text-sm font-extrabold ${result.pass ? "text-primary" : "text-destructive"}`}>
              {result.pass ? "PASS — disconnection time met" : "FAIL — Zs too high"}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {result.curve}{result.rating} MCB · limit {result.appliedLimit.toFixed(2)} Ω {result.measured ? "(0.8 × table)" : "(table value)"} · yours {result.zs} Ω
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-3">
            <ResultRow label="Your Zs" value={result.zs} unit="Ω" variant={result.pass ? "default" : "destructive"} />
            <ResultRow label="Applied limit" value={result.appliedLimit.toFixed(2)} unit="Ω" variant="primary" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <ResultRow label={`Table B1 max (Uo/${K_BY_CURVE[result.curve]}×In)`} value={result.tableZs.toFixed(2)} unit="Ω" size="sm" />
            <ResultRow label="Margin" value={result.margin.toFixed(1)} unit="%" variant={result.margin < 0 ? "destructive" : "default"} size="sm" />
            <ResultRow label="Prospective earth fault current" value={result.faultCurrent.toFixed(1)} unit="A" size="sm" />
          </div>

          {!result.pass && (
            <p className="text-xs text-destructive mt-3 font-medium">
              ⚠️ Zs exceeds the limit by {Math.abs(result.margin).toFixed(1)}% — the breaker may not trip within the
              required disconnection time. Reduce circuit length, increase conductor size, or use a lower-rated /
              different-curve breaker. Re-test after any change.
            </p>
          )}
          {result.pass && result.margin < 10 && (
            <p className="text-xs text-destructive mt-3 font-medium">
              ⚠️ Less than 10% margin — verify with a calibrated loop tester and consider the tolerance of your
              instrument.
            </p>
          )}

          <p className="text-xs text-muted-foreground mt-3">
            💡 For fuses, read the maximum Zs directly from AS/NZS 3000 Table B1 — this tool covers MCBs only.
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            💡 Zs limits derive from Uo/(k×In) with k = 5 (B), 10 (C), 20 (D) — the top of each curve's instantaneous
            trip band, per the method behind AS/NZS 3000 Table B1.
          </p>
        </>
      ) : undefined}
      advancedInputs={
        <div>
          <Label className="text-sm">Nominal Phase Voltage Uo (V)</Label>
          <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="230"
            value={uo} onChange={(e) => { setUo(e.target.value); setResult(null); }} />
          <p className="text-[10px] text-muted-foreground mt-0.5">Valid range 110–400 V</p>
        </div>
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

      <div>
        <Label className="text-sm">Zs Source</Label>
        <div className="flex gap-2 mt-1 flex-wrap">
          <Badge variant={measured ? "default" : "outline"}
            className="cursor-pointer px-3 py-1.5 text-sm"
            onClick={() => { setMeasured(true); setResult(null); }}>
            Measured on site (×0.8 applied)
          </Badge>
          <Badge variant={!measured ? "default" : "outline"}
            className="cursor-pointer px-3 py-1.5 text-sm"
            onClick={() => { setMeasured(false); setResult(null); }}>
            Calculated at operating temp
          </Badge>
        </div>
      </div>

      <div>
        <Label className="text-sm">Measured / Calculated Zs (Ω)</Label>
        <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="e.g. 0.85"
          value={zs} onChange={(e) => { setZs(e.target.value); setResult(null); }} />
        <p className="text-[10px] text-muted-foreground mt-0.5">Valid range &gt; 0 to 100 Ω</p>
      </div>
    </ToolLayout>
  );
};

export default FaultLoopTool;
