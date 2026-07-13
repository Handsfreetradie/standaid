import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import ToolLayout from "./ToolLayout";
import ResultRow from "./ResultRow";

// AS/NZS 3500.2 minimum grades
const PIPE_GRADES: Record<string, { label: string; minGrade: number; desc: string }> = {
  "65-drain": { label: "65mm branch drain", minGrade: 2.5, desc: "Basin, laundry tub" },
  "80-drain": { label: "80mm branch drain", minGrade: 2.5, desc: "Shower, floor waste" },
  "100-drain": { label: "100mm sanitary drain", minGrade: 1.65, desc: "Toilet, main drain" },
  "100-storm": { label: "100mm stormwater", minGrade: 1.0, desc: "Downpipe connections" },
  "150-sewer": { label: "150mm sewer main", minGrade: 1.0, desc: "Property sewer line (AS/NZS 3500.2 min 1.00%)" },
  "225-sewer": { label: "225mm sewer main", minGrade: 1.0, desc: "Main sewer" },
  "custom": { label: "Custom", minGrade: 1.0, desc: "Enter your own values" },
};

interface DrainResult {
  gradePct: number;
  fallMm: number;
  fallTotal: number;
  passes: boolean;
  minGrade: number;
  flowVelocity: number;
  warnings: string[];
}

interface Props { onBack: () => void }

const DrainageFallTool = ({ onBack }: Props) => {
  const [pipeType, setPipeType] = useState("100-drain");
  const [mode, setMode] = useState<"find-fall" | "check-grade">("find-fall");
  const [pipeLength, setPipeLength] = useState("");
  const [customGrade, setCustomGrade] = useState("1.65");
  const [fallInput, setFallInput] = useState("");
  const [result, setResult] = useState<DrainResult | null>(null);

  const calculate = () => {
    const length = parseFloat(pipeLength);
    if (isNaN(length) || length <= 0) return;

    const pt = PIPE_GRADES[pipeType];
    const minGrade = pipeType === "custom" ? parseFloat(customGrade) : pt?.minGrade || 1.0;

    let gradePct: number;
    let fallMm: number;
    let fallTotal: number;

    if (mode === "find-fall") {
      gradePct = minGrade;
      fallMm = minGrade * 10; // mm per metre
      fallTotal = fallMm * length;
    } else {
      fallTotal = parseFloat(fallInput);
      if (isNaN(fallTotal) || fallTotal <= 0) return;
      fallMm = fallTotal / length;
      gradePct = fallMm / 10;
    }

    const passes = gradePct >= minGrade;

    // Rough velocity estimate using Manning's equation (simplified)
    const pipeDiamMm = pipeType.includes("65") ? 65 : pipeType.includes("80") ? 80 :
      pipeType.includes("100") ? 100 : pipeType.includes("150") ? 150 : 225;
    const r = (pipeDiamMm / 1000) / 4; // hydraulic radius at half-full
    const n = 0.011; // PVC Manning's n
    const s = gradePct / 100;
    const flowVelocity = (1 / n) * Math.pow(r, 2/3) * Math.pow(s, 0.5);

    const warnings: string[] = [];
    if (!passes) warnings.push(`Grade ${gradePct.toFixed(2)}% is below minimum ${minGrade}% for ${pt?.label || "this pipe"}.`);
    if (flowVelocity < 0.6) warnings.push("Flow velocity below 0.6 m/s — risk of solid deposition.");
    if (flowVelocity > 3.0) warnings.push("Flow velocity above 3.0 m/s — risk of pipe erosion.");
    if (gradePct > 5) warnings.push("Very steep grade — check pipe support spacing.");

    setResult({
      gradePct: Math.round(gradePct * 100) / 100,
      fallMm: Math.round(fallMm * 10) / 10,
      fallTotal: Math.round(fallTotal),
      passes,
      minGrade,
      flowVelocity: Math.round(flowVelocity * 100) / 100,
      warnings,
    });
  };

  return (
    <ToolLayout
      title="Drainage Fall Calculator"
      subtitle="AS/NZS 3500.2 — Pipe grades & fall distances"
      disclaimer="Based on AS/NZS 3500.2 minimum grades. Velocity estimates use Manning's equation at half-full flow with PVC pipe (n=0.011). Actual site conditions may require steeper grades."
      onBack={onBack}
      onCalculate={calculate}
      result={result ? (
        <>
          <div className={`p-3 rounded-lg mb-3 border ${
            result.passes ? "bg-primary/5 border-primary/20" : "bg-destructive/5 border-destructive/20"
          }`}>
            <p className={`text-sm font-extrabold ${result.passes ? "text-primary" : "text-destructive"}`}>
              {result.passes ? "✅ GRADE COMPLIANT" : "❌ BELOW MINIMUM GRADE"}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <ResultRow label="Grade" value={result.gradePct} unit="%" variant="primary" />
            <ResultRow label="Fall/metre" value={result.fallMm} unit="mm" size="sm" />
            <ResultRow label="Total fall" value={result.fallTotal} unit="mm" size="sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <ResultRow label="Min. grade" value={result.minGrade} unit="%" size="sm" />
            <ResultRow label="Velocity" value={result.flowVelocity} unit="m/s" size="sm"
              variant={result.flowVelocity < 0.6 ? "destructive" : "default"} />
          </div>
          {result.warnings.map((w, i) => (
            <p key={i} className="text-xs text-destructive mt-2 font-medium">⚠️ {w}</p>
          ))}
        </>
      ) : undefined}
    >
      <div>
        <Label className="text-sm">Pipe Type</Label>
        <Select value={pipeType} onValueChange={(v) => { setPipeType(v); setResult(null); }}>
          <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(PIPE_GRADES).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label} — min {v.minGrade}%</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {pipeType !== "custom" && (
          <p className="text-[10px] text-muted-foreground mt-0.5">{PIPE_GRADES[pipeType]?.desc}</p>
        )}
      </div>

      {pipeType === "custom" && (
        <div>
          <Label className="text-sm">Minimum Grade (%)</Label>
          <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="e.g. 1.65"
            value={customGrade} onChange={(e) => setCustomGrade(e.target.value)} />
        </div>
      )}

      <div>
        <Label className="text-sm">Mode</Label>
        <div className="flex gap-2 mt-1">
          {([["find-fall", "Calculate fall from grade"], ["check-grade", "Check grade from fall"]] as const).map(([k, l]) => (
            <Badge key={k} variant={mode === k ? "default" : "outline"}
              className="cursor-pointer px-3 py-1.5 text-xs"
              onClick={() => { setMode(k as "find-fall" | "check-grade"); setResult(null); }}>
              {l}
            </Badge>
          ))}
        </div>
      </div>

      <div>
        <Label className="text-sm">Pipe Run Length (m)</Label>
        <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="e.g. 15"
          value={pipeLength} onChange={(e) => setPipeLength(e.target.value)} />
      </div>

      {mode === "check-grade" && (
        <div>
          <Label className="text-sm">Total Fall (mm)</Label>
          <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="e.g. 250"
            value={fallInput} onChange={(e) => setFallInput(e.target.value)} />
        </div>
      )}
    </ToolLayout>
  );
};

export default DrainageFallTool;
