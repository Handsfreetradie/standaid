import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import ToolLayout from "./ToolLayout";
import ResultRow from "./ResultRow";

// AS/NZS 5601 gas pipe sizing — max capacity in MJ/h for natural gas.
// NOT independently verified against the standard (checked 2026-08-10): the
// length columns here (3/6/9/12/15/20/25/30m) don't match the standard's own
// grid (2/4/6/8/10/12/14/16/18m+ per Table F6/F7), so this can't be a direct
// transcription — likely an interpolated/independently-derived table. Treat
// as indicative until checked against a real copy of AS/NZS 5601.1.
const GAS_PIPE_CAPACITY: Record<string, Record<string, number>> = {
  // Pipe size → max length (m) → MJ/h
  "15": { "3": 275, "6": 194, "9": 158, "12": 137, "15": 122, "20": 106, "25": 95, "30": 86 },
  "20": { "3": 625, "6": 442, "9": 361, "12": 312, "15": 280, "20": 242, "25": 216, "30": 198 },
  "25": { "3": 1275, "6": 901, "9": 736, "12": 637, "15": 570, "20": 494, "25": 441, "30": 403 },
  "32": { "3": 2500, "6": 1768, "9": 1443, "12": 1250, "15": 1118, "20": 968, "25": 866, "30": 791 },
  "40": { "3": 4375, "6": 3094, "9": 2525, "12": 2188, "15": 1956, "20": 1694, "25": 1516, "30": 1384 },
  "50": { "3": 8500, "6": 6010, "9": 4907, "12": 4250, "15": 3802, "20": 3293, "25": 2946, "30": 2690 },
};

const APPLIANCES: Record<string, { label: string; mjh: number }> = {
  "cooktop-4": { label: "Gas cooktop (4 burner)", mjh: 42 },
  "cooktop-5": { label: "Gas cooktop (5 burner)", mjh: 54 },
  "oven": { label: "Gas oven", mjh: 14 },
  "hot-water-instant": { label: "Instant hot water (26L)", mjh: 199 },
  "hot-water-storage": { label: "Storage hot water", mjh: 45 },
  "heater-wall": { label: "Gas wall heater", mjh: 25 },
  // Real ducted heaters draw 70–130 MJ/h input — the old 35 MJ/h figure
  // undersized the pipe and starved every appliance on the run.
  "heater-ducted": { label: "Ducted gas heater", mjh: 90 },
  "heater-outdoor": { label: "Outdoor gas heater", mjh: 46 },
  "bbq": { label: "BBQ", mjh: 32 },
  "fireplace": { label: "Gas fireplace", mjh: 40 },
};

interface GasResult {
  totalLoad: number;
  recommendedPipe: string;
  maxCapacity: number;
  passes: boolean;
  warnings: string[];
}

interface Props { onBack: () => void }

const GasPipeSizingTool = ({ onBack }: Props) => {
  const [gasType, setGasType] = useState("natural");
  const [pipeLength, setPipeLength] = useState("12");
  const [totalLoadMjh, setTotalLoadMjh] = useState("");
  const [useAppliances, setUseAppliances] = useState(false);
  const [selectedAppliances, setSelectedAppliances] = useState<string[]>([]);
  const [result, setResult] = useState<GasResult | null>(null);

  const toggleAppliance = (key: string) => {
    setSelectedAppliances(prev =>
      prev.includes(key) ? prev.filter(a => a !== key) : [...prev, key]
    );
    setResult(null);
  };

  const calculate = () => {
    const length = parseFloat(pipeLength);
    if (isNaN(length) || length <= 0) return;

    let totalLoad: number;
    if (useAppliances) {
      totalLoad = selectedAppliances.reduce((sum, k) => sum + (APPLIANCES[k]?.mjh || 0), 0);
    } else {
      totalLoad = parseFloat(totalLoadMjh);
    }
    if (isNaN(totalLoad) || totalLoad <= 0) return;

    // LPG conversion: roughly 1/3 the volume flow, so pipe can handle ~2.5× more MJ/h
    const lpgFactor = gasType === "lpg" ? 2.5 : 1.0;

    // Find nearest length column
    const lengthColumns = [3, 6, 9, 12, 15, 20, 25, 30];
    const nearestLength = lengthColumns.find(l => l >= length) || 30;

    const pipeSizes = ["15", "20", "25", "32", "40", "50"];
    let recommendedPipe: string | null = null;
    let maxCapacity = 0;

    for (const size of pipeSizes) {
      const cap = (GAS_PIPE_CAPACITY[size]?.[String(nearestLength)] || 0) * lpgFactor;
      if (cap >= totalLoad) {
        recommendedPipe = size;
        maxCapacity = Math.round(cap);
        break;
      }
    }

    const warnings: string[] = [];
    if (!recommendedPipe) {
      recommendedPipe = ">50";
      warnings.push("Load exceeds standard pipe capacity — consult gas engineer.");
    }

    setResult({
      totalLoad: Math.round(totalLoad),
      recommendedPipe: recommendedPipe!,
      maxCapacity,
      passes: recommendedPipe !== ">50",
      warnings,
    });
  };

  return (
    <ToolLayout
      title="Gas Pipe Sizing"
      subtitle="AS/NZS 5601 — Size gas pipes by load & run"
      disclaimer="Modelled on AS/NZS 5601 capacity tables for natural gas at 1.1 kPa, but not independently verified against the standard's actual tables — the length-column grid used here doesn't match the standard's own. LPG values are approximate conversions. Always verify with the full standard and local gas authority requirements."
      onBack={onBack}
      onCalculate={calculate}
      result={result ? (
        <>
          <div className={`p-3 rounded-lg mb-3 border ${
            result.passes ? "bg-primary/5 border-primary/20" : "bg-destructive/5 border-destructive/20"
          }`}>
            <p className="text-3xl font-extrabold text-primary">{result.recommendedPipe} mm</p>
            <p className="text-xs text-muted-foreground mt-1">
              {gasType === "lpg" ? "LPG" : "Natural gas"} • Load: {result.totalLoad} MJ/h
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <ResultRow label="Total load" value={result.totalLoad} unit="MJ/h" variant="primary" />
            <ResultRow label="Pipe capacity" value={result.maxCapacity} unit="MJ/h" size="sm" />
          </div>
          {result.warnings.map((w, i) => (
            <p key={i} className="text-xs text-destructive mt-2 font-medium">⚠️ {w}</p>
          ))}
        </>
      ) : undefined}
    >
      <div>
        <Label className="text-sm">Gas Type</Label>
        <div className="flex gap-2 mt-1">
          {([["natural", "Natural Gas"], ["lpg", "LPG"]] as const).map(([k, l]) => (
            <Badge key={k} variant={gasType === k ? "default" : "outline"}
              className="cursor-pointer px-3 py-1.5 text-sm"
              onClick={() => { setGasType(k); setResult(null); }}>
              {l}
            </Badge>
          ))}
        </div>
      </div>

      <div>
        <Label className="text-sm">Pipe Run Length (m)</Label>
        <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="e.g. 12"
          value={pipeLength} onChange={(e) => setPipeLength(e.target.value)} />
      </div>

      <div>
        <Label className="text-sm">Load Input Method</Label>
        <div className="flex gap-2 mt-1">
          {([false, true] as const).map(mode => (
            <Badge key={String(mode)} variant={useAppliances === mode ? "default" : "outline"}
              className="cursor-pointer px-3 py-1.5 text-sm"
              onClick={() => { setUseAppliances(mode); setResult(null); }}>
              {mode ? "Select appliances" : "Enter MJ/h"}
            </Badge>
          ))}
        </div>
      </div>

      {useAppliances ? (
        <div className="space-y-2">
          <Label className="text-sm">Select Appliances</Label>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(APPLIANCES).map(([k, v]) => (
              <Badge key={k}
                variant={selectedAppliances.includes(k) ? "default" : "outline"}
                className="cursor-pointer px-2.5 py-1 text-xs"
                onClick={() => toggleAppliance(k)}>
                {v.label} ({v.mjh})
              </Badge>
            ))}
          </div>
          {selectedAppliances.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Total: {selectedAppliances.reduce((s, k) => s + (APPLIANCES[k]?.mjh || 0), 0)} MJ/h
            </p>
          )}
        </div>
      ) : (
        <div>
          <Label className="text-sm">Total Gas Load (MJ/h)</Label>
          <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="e.g. 200"
            value={totalLoadMjh} onChange={(e) => setTotalLoadMjh(e.target.value)} />
        </div>
      )}
    </ToolLayout>
  );
};

export default GasPipeSizingTool;
