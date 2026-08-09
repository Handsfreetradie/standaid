import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import ToolLayout from "./ToolLayout";
import ResultRow from "./ResultRow";

// Pipe sizes by material (nominal bore in mm)
const PIPE_SIZES: Record<string, number[]> = {
  copper: [15, 20, 25, 32, 40, 50, 65, 80, 100],
  pvc: [15, 20, 25, 32, 40, 50, 65, 80, 100, 150, 200, 250, 300],
  pe: [16, 20, 25, 32, 40, 50, 63, 75, 90, 110, 125, 160, 200],
  galv: [15, 20, 25, 32, 40, 50, 65, 80, 100],
  stainless: [15, 20, 25, 32, 40, 50, 65, 80, 100],
};

// Recommended max velocity by application (m/s)
const APPLICATIONS: Record<string, { label: string; maxVelocity: number; desc: string }> = {
  "domestic-cold": { label: "Domestic cold water", maxVelocity: 3.0, desc: "AS/NZS 3500.1 Cl 3.4 — max 3.0 m/s" },
  "domestic-hot": { label: "Domestic hot water", maxVelocity: 3.0, desc: "AS/NZS 3500.4 Cl 1.8 — max 3.0 m/s" },
  "commercial": { label: "Commercial supply", maxVelocity: 3.0, desc: "AS/NZS 3500.1 Cl 3.4 — max 3.0 m/s" },
  "fire-hydrant": { label: "Fire hydrant", maxVelocity: 3.0, desc: "AS 2419 — fire hydrant systems" },
  "fire-sprinkler": { label: "Fire sprinkler", maxVelocity: 6.0, desc: "AS 2118 — sprinkler systems" },
  "drainage": { label: "Drainage / stormwater", maxVelocity: 3.0, desc: "Gravity-fed drainage" },
  "custom": { label: "Custom", maxVelocity: 1.5, desc: "Enter your own max velocity" },
};

// Pressure class affects wall thickness → internal diameter reduction (simplified mm reduction)
const PRESSURE_CLASS: Record<string, { label: string; wallReduction: number }> = {
  "PN6": { label: "PN6 (low pressure)", wallReduction: 0 },
  "PN9": { label: "PN9 (standard)", wallReduction: 1 },
  "PN12": { label: "PN12 (medium)", wallReduction: 2 },
  "PN16": { label: "PN16 (high pressure)", wallReduction: 3 },
  "PN20": { label: "PN20 (very high)", wallReduction: 4 },
};

interface PipeResult {
  minDiameterMm: number;
  recommendedMm: number;
  actualVelocity: number;
  nextSizeUp: number | null;
  nextSizeVelocity: number | null;
  equivalentFlowLpm: number;
  warnings: string[];
}

interface Props { onBack: () => void }

const PipeSizingTool = ({ onBack }: Props) => {
  const [pipeMaterial, setPipeMaterial] = useState("copper");
  const [application, setApplication] = useState("domestic-cold");
  const [flowRate, setFlowRate] = useState("");
  const [flowUnit, setFlowUnit] = useState<"lps" | "lpm">("lps");
  const [customVelocity, setCustomVelocity] = useState("1.5");
  const [pressureClass, setPressureClass] = useState("PN9");
  const [fittingsAllowance, setFittingsAllowance] = useState("10");
  const [result, setResult] = useState<PipeResult | null>(null);

  const maxVelocity = application === "custom"
    ? parseFloat(customVelocity) || 1.5
    : APPLICATIONS[application]?.maxVelocity || 1.5;

  const calculate = () => {
    let flowLps = parseFloat(flowRate);
    if (isNaN(flowLps) || flowLps <= 0) return;

    if (flowUnit === "lpm") flowLps = flowLps / 60;
    const equivalentFlowLpm = Math.round(flowLps * 60 * 100) / 100;

    const flowM3s = flowLps / 1000;
    const wallReduction = PRESSURE_CLASS[pressureClass]?.wallReduction || 0;

    // d = sqrt(4Q / πv)
    const minDiameterM = Math.sqrt((4 * flowM3s) / (Math.PI * maxVelocity));
    const minDiameterMm = minDiameterM * 1000;

    const sizes = PIPE_SIZES[pipeMaterial] || PIPE_SIZES.copper;
    const effectiveSizes = sizes.map(s => ({ nominal: s, internal: s - wallReduction }));

    const recommended = effectiveSizes.find(s => s.internal >= minDiameterMm);
    const recNominal = recommended?.nominal || sizes[sizes.length - 1];
    const recInternal = recommended?.internal || recNominal - wallReduction;

    const actualVelocity = flowM3s / (Math.PI * Math.pow(recInternal / 2000, 2));

    // Next size up
    const recIdx = sizes.indexOf(recNominal);
    const nextSize = recIdx < sizes.length - 1 ? sizes[recIdx + 1] : null;
    const nextInternal = nextSize ? nextSize - wallReduction : null;
    const nextSizeVelocity = nextInternal
      ? flowM3s / (Math.PI * Math.pow(nextInternal / 2000, 2))
      : null;

    const warnings: string[] = [];
    if (actualVelocity > maxVelocity * 1.1) warnings.push("Velocity exceeds recommended maximum — expect noise and erosion.");
    if (actualVelocity < 0.5) warnings.push("Velocity below 0.5 m/s — risk of sediment buildup and stagnation.");
    if (flowLps > 5 && pipeMaterial === "copper") warnings.push("High flow rate for copper — consider larger pipe material.");
    const fittingsPct = parseInt(fittingsAllowance) || 0;
    if (fittingsPct > 0) {
      const effectiveLength = 1 + fittingsPct / 100;
      warnings.push(`Fittings allowance of ${fittingsPct}% adds ~${Math.round((effectiveLength - 1) * 100)}% equivalent length to friction calculations.`);
    }

    setResult({
      minDiameterMm: Math.round(minDiameterMm * 10) / 10,
      recommendedMm: recNominal,
      actualVelocity: Math.round(actualVelocity * 100) / 100,
      nextSizeUp: nextSize,
      nextSizeVelocity: nextSizeVelocity ? Math.round(nextSizeVelocity * 100) / 100 : null,
      equivalentFlowLpm,
      warnings,
    });
  };

  return (
    <ToolLayout
      title="Pipe Sizing Calculator"
      subtitle="Flow rate → recommended pipe diameter by application"
      disclaimer="Based on Q = v × A continuity equation. Max velocity per AS/NZS 3500.1 Cl 3.4 / AS/NZS 3500.4 Cl 1.8 (3.0 m/s, all non-fire water services). Standard pipe sizes per AS 1432 (copper) / AS/NZS 1477 (PVC) / AS 4130 (PE). Fittings equivalent length is approximate. Always verify with project hydraulic engineer for critical installations."
      onBack={onBack}
      onCalculate={calculate}
      result={result ? (
        <>
          <p className="text-sm font-bold text-foreground mb-3">Results</p>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <ResultRow label="Min. internal ∅" value={result.minDiameterMm} unit="mm" />
            <ResultRow label="Recommended" value={result.recommendedMm} unit="mm" variant="primary" />
            <ResultRow label="Actual velocity" value={result.actualVelocity} unit="m/s"
              variant={result.actualVelocity > maxVelocity ? "destructive" : "default"} />
          </div>
          {result.nextSizeUp && (
            <div className="p-2.5 rounded-lg bg-muted">
              <p className="text-xs text-foreground">
                Next size up: <span className="font-bold">{result.nextSizeUp} mm</span> → {result.nextSizeVelocity} m/s
              </p>
            </div>
          )}
          <div className="mt-3 p-2.5 rounded-lg bg-primary/5 border border-primary/20">
            <p className="text-xs font-bold text-primary">📋 {APPLICATIONS[application]?.label || "Custom"}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Flow: {result.equivalentFlowLpm} L/min • Max velocity: {maxVelocity} m/s
            </p>
          </div>
          {result.warnings.map((w, i) => (
            <p key={i} className="text-xs text-destructive mt-2 font-medium">⚠️ {w}</p>
          ))}
        </>
      ) : undefined}
      advancedInputs={
        <>
          <div>
            <Label className="text-sm">Pressure Class</Label>
            <Select value={pressureClass} onValueChange={setPressureClass}>
              <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(PRESSURE_CLASS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-sm">Fittings Allowance (%)</Label>
            <div className="flex gap-2 mt-1">
              {["0", "10", "20", "30"].map((f) => (
                <Badge key={f} variant={fittingsAllowance === f ? "default" : "outline"}
                  className="cursor-pointer px-3 py-1.5 text-sm"
                  onClick={() => setFittingsAllowance(f)}>
                  {f}%
                </Badge>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Adds equivalent length for elbows, tees, valves</p>
          </div>
          {application === "custom" && (
            <div>
              <Label className="text-sm">Custom Max Velocity (m/s)</Label>
              <Input type="number" inputMode="decimal" className="h-11 mt-1"
                value={customVelocity} onChange={(e) => setCustomVelocity(e.target.value)} />
            </div>
          )}
        </>
      }
    >
      <div>
        <Label className="text-sm">Pipe Material</Label>
        <Select value={pipeMaterial} onValueChange={(v) => { setPipeMaterial(v); setResult(null); }}>
          <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="copper">Copper (Type B)</SelectItem>
            <SelectItem value="pvc">PVC-U / PVC-M</SelectItem>
            <SelectItem value="pe">Polyethylene (PE)</SelectItem>
            <SelectItem value="galv">Galvanised Steel</SelectItem>
            <SelectItem value="stainless">Stainless Steel</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="text-sm">Application</Label>
        <Select value={application} onValueChange={(v) => { setApplication(v); setResult(null); }}>
          <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(APPLICATIONS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {application !== "custom" && (
          <p className="text-[10px] text-muted-foreground mt-1">{APPLICATIONS[application]?.desc}</p>
        )}
      </div>

      <div>
        <Label className="text-sm">Flow Rate</Label>
        <div className="flex gap-2 mt-1">
          <Input type="number" inputMode="decimal" className="h-11 flex-1" placeholder="e.g. 0.5"
            value={flowRate} onChange={(e) => setFlowRate(e.target.value)} />
          <div className="flex">
            {(["lps", "lpm"] as const).map((u) => (
              <Badge key={u} variant={flowUnit === u ? "default" : "outline"}
                className="cursor-pointer px-3 py-1.5 text-sm rounded-l-none rounded-r-none first:rounded-l-md last:rounded-r-md"
                onClick={() => { setFlowUnit(u); setResult(null); }}>
                {u === "lps" ? "L/s" : "L/min"}
              </Badge>
            ))}
          </div>
        </div>
      </div>
    </ToolLayout>
  );
};

export default PipeSizingTool;
