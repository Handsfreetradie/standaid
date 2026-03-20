import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import ToolLayout from "./ToolLayout";
import ResultRow from "./ResultRow";

// Duct sizing via velocity method
const DUCT_TYPES: Record<string, { label: string; frictionFactor: number }> = {
  "galv-rect": { label: "Galvanised rectangular", frictionFactor: 1.0 },
  "galv-round": { label: "Galvanised round/spiral", frictionFactor: 0.9 },
  "flex": { label: "Flexible duct", frictionFactor: 1.8 },
  "fibre": { label: "Fibre duct board", frictionFactor: 1.2 },
};

const APPLICATIONS: Record<string, { label: string; maxVelocity: number }> = {
  "residential-supply": { label: "Residential supply", maxVelocity: 5.0 },
  "residential-return": { label: "Residential return", maxVelocity: 4.0 },
  "commercial-supply": { label: "Commercial supply", maxVelocity: 7.5 },
  "commercial-return": { label: "Commercial return", maxVelocity: 6.0 },
  "exhaust": { label: "Exhaust duct", maxVelocity: 8.0 },
};

interface DuctResult {
  roundDiameter: number;
  rectWidth: number;
  rectHeight: number;
  actualVelocity: number;
  maxVelocity: number;
  equivalentRound: number;
  warnings: string[];
}

interface Props { onBack: () => void }

const DuctSizingTool = ({ onBack }: Props) => {
  const [airflow, setAirflow] = useState("");
  const [airflowUnit, setAirflowUnit] = useState<"lps" | "cfm">("lps");
  const [ductType, setDuctType] = useState("galv-rect");
  const [application, setApplication] = useState("residential-supply");
  const [aspectRatio, setAspectRatio] = useState("2");
  const [result, setResult] = useState<DuctResult | null>(null);

  const calculate = () => {
    let flowLps = parseFloat(airflow);
    if (isNaN(flowLps) || flowLps <= 0) return;
    if (airflowUnit === "cfm") flowLps = flowLps * 0.4719; // CFM to L/s

    const flowM3s = flowLps / 1000;
    const app = APPLICATIONS[application];
    const maxV = app?.maxVelocity || 5.0;

    // Round duct: d = sqrt(4Q / πv)
    const roundDiamM = Math.sqrt((4 * flowM3s) / (Math.PI * maxV));
    const roundDiamMm = roundDiamM * 1000;

    // Standard round sizes
    const standardRound = [100, 125, 150, 175, 200, 225, 250, 300, 350, 400, 450, 500, 600];
    const roundDiameter = standardRound.find(d => d >= roundDiamMm) || standardRound[standardRound.length - 1];

    // Rectangular equivalent
    const ratio = parseFloat(aspectRatio) || 2;
    const area = Math.PI * Math.pow(roundDiameter / 2000, 2);
    const h = Math.sqrt(area / ratio) * 1000;
    const w = h * ratio;
    // Round to nearest 25mm
    const rectHeight = Math.ceil(h / 25) * 25;
    const rectWidth = Math.ceil(w / 25) * 25;

    const actualArea = (rectWidth / 1000) * (rectHeight / 1000);
    const actualVelocity = flowM3s / actualArea;

    // Equivalent round for rectangular
    const equivalentRound = Math.round(2 * Math.sqrt((rectWidth * rectHeight) / Math.PI));

    const warnings: string[] = [];
    if (actualVelocity > maxV) warnings.push(`Velocity ${actualVelocity.toFixed(1)} m/s exceeds recommended ${maxV} m/s — increase duct size.`);
    if (ductType === "flex" && flowLps > 200) warnings.push("Flexible duct not recommended for high airflow — use rigid duct.");

    setResult({
      roundDiameter,
      rectWidth,
      rectHeight,
      actualVelocity: Math.round(actualVelocity * 10) / 10,
      maxVelocity: maxV,
      equivalentRound,
      warnings,
    });
  };

  return (
    <ToolLayout
      title="Duct Sizing Calculator"
      subtitle="Round & rectangular duct sizing by airflow"
      disclaimer="Based on velocity method. For accurate pressure drop calculations, use ductwork design software. Noise levels increase significantly above recommended velocities."
      onBack={onBack}
      onCalculate={calculate}
      result={result ? (
        <>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="p-3 rounded-lg border bg-primary/5 border-primary/20">
              <p className="text-2xl font-extrabold text-primary">⌀{result.roundDiameter}</p>
              <p className="text-[10px] text-muted-foreground">Round (mm)</p>
            </div>
            <div className="p-3 rounded-lg border bg-primary/5 border-primary/20">
              <p className="text-2xl font-extrabold text-primary">{result.rectWidth}×{result.rectHeight}</p>
              <p className="text-[10px] text-muted-foreground">Rectangular (mm)</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <ResultRow label="Velocity" value={result.actualVelocity} unit="m/s"
              variant={result.actualVelocity > result.maxVelocity ? "destructive" : "primary"} size="sm" />
            <ResultRow label="Eq. round" value={result.equivalentRound} unit="mm" size="sm" />
          </div>
          {result.warnings.map((w, i) => (
            <p key={i} className="text-xs text-destructive mt-2 font-medium">⚠️ {w}</p>
          ))}
        </>
      ) : undefined}
      advancedInputs={
        <>
          <div>
            <Label className="text-sm">Duct Type</Label>
            <Select value={ductType} onValueChange={(v) => { setDuctType(v); setResult(null); }}>
              <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(DUCT_TYPES).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-sm">Rect. Aspect Ratio (W:H)</Label>
            <div className="flex gap-2 mt-1">
              {["1.5", "2", "3", "4"].map(r => (
                <Badge key={r} variant={aspectRatio === r ? "default" : "outline"}
                  className="cursor-pointer px-3 py-1.5 text-sm"
                  onClick={() => { setAspectRatio(r); setResult(null); }}>
                  {r}:1
                </Badge>
              ))}
            </div>
          </div>
        </>
      }
    >
      <div>
        <Label className="text-sm">Airflow</Label>
        <div className="flex gap-2 mt-1">
          <Input type="number" inputMode="decimal" className="h-11 flex-1" placeholder="e.g. 300"
            value={airflow} onChange={(e) => setAirflow(e.target.value)} />
          <div className="flex">
            {(["lps", "cfm"] as const).map(u => (
              <Badge key={u} variant={airflowUnit === u ? "default" : "outline"}
                className="cursor-pointer px-3 py-1.5 text-sm rounded-none first:rounded-l-md last:rounded-r-md"
                onClick={() => { setAirflowUnit(u); setResult(null); }}>
                {u === "lps" ? "L/s" : "CFM"}
              </Badge>
            ))}
          </div>
        </div>
      </div>
      <div>
        <Label className="text-sm">Application</Label>
        <Select value={application} onValueChange={(v) => { setApplication(v); setResult(null); }}>
          <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(APPLICATIONS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label} (max {v.maxVelocity} m/s)</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </ToolLayout>
  );
};

export default DuctSizingTool;
