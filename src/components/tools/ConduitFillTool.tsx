import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trash2, Plus } from "lucide-react";
import ToolLayout from "./ToolLayout";
import ResultRow from "./ResultRow";

// Conduit internal areas (mm²) per AS/NZS 2053
const CONDUIT_SIZES: Record<string, { label: string; internalArea: number }> = {
  "16": { label: "16mm", internalArea: 157 },
  "20": { label: "20mm", internalArea: 227 },
  "25": { label: "25mm", internalArea: 380 },
  "32": { label: "32mm", internalArea: 641 },
  "40": { label: "40mm", internalArea: 1018 },
  "50": { label: "50mm", internalArea: 1590 },
  "63": { label: "63mm", internalArea: 2552 },
};

// Cable overall diameters (mm) — approximate for common types
const CABLE_TYPES: Record<string, Record<string, number>> = {
  "V75 (TPS)": {
    "1": 4.0, "1.5": 4.5, "2.5": 5.2, "4": 5.9, "6": 6.7, "10": 8.0, "16": 9.4,
  },
  "V90 (building wire)": {
    "1": 3.5, "1.5": 3.9, "2.5": 4.5, "4": 5.2, "6": 5.8, "10": 7.2, "16": 8.6,
  },
  "XLPE (single core)": {
    "1.5": 4.2, "2.5": 4.8, "4": 5.5, "6": 6.2, "10": 7.8, "16": 9.2,
    "25": 11.2, "35": 12.8, "50": 14.6,
  },
};

// AS/NZS 3080: max fill ratio
const MAX_FILL_RATIOS: Record<string, { label: string; ratio: number }> = {
  "1": { label: "1 cable", ratio: 0.53 },
  "2": { label: "2 cables", ratio: 0.31 },
  "3+": { label: "3+ cables", ratio: 0.40 },
};

interface CableEntry {
  id: number;
  cableType: string;
  cableSize: string;
  quantity: number;
}

interface FillResult {
  totalCableArea: number;
  conduitArea: number;
  fillPercent: number;
  maxFillPercent: number;
  passes: boolean;
  recommendedConduit: string | null;
  warnings: string[];
}

interface Props { onBack: () => void }

let nextId = 1;

const ConduitFillTool = ({ onBack }: Props) => {
  const [conduitSize, setConduitSize] = useState("20");
  const [cables, setCables] = useState<CableEntry[]>([
    { id: nextId++, cableType: "V90 (building wire)", cableSize: "2.5", quantity: 3 },
  ]);
  const [result, setResult] = useState<FillResult | null>(null);

  const addCable = () => {
    setCables([...cables, { id: nextId++, cableType: "V90 (building wire)", cableSize: "2.5", quantity: 1 }]);
    setResult(null);
  };

  const removeCable = (id: number) => {
    if (cables.length <= 1) return;
    setCables(cables.filter(c => c.id !== id));
    setResult(null);
  };

  const updateCable = (id: number, field: keyof CableEntry, value: string | number) => {
    setCables(cables.map(c => c.id === id ? { ...c, [field]: value } : c));
    setResult(null);
  };

  const calculate = () => {
    const conduit = CONDUIT_SIZES[conduitSize];
    if (!conduit) return;

    let totalCableArea = 0;
    let totalCableCount = 0;

    for (const cable of cables) {
      const typeData = CABLE_TYPES[cable.cableType];
      if (!typeData) continue;
      const od = typeData[cable.cableSize];
      if (!od) continue;
      const area = Math.PI * Math.pow(od / 2, 2);
      totalCableArea += area * cable.quantity;
      totalCableCount += cable.quantity;
    }

    // Determine fill ratio based on cable count
    const fillRatioKey = totalCableCount === 1 ? "1" : totalCableCount === 2 ? "2" : "3+";
    const maxRatio = MAX_FILL_RATIOS[fillRatioKey].ratio;
    const maxFillPercent = maxRatio * 100;

    const fillPercent = (totalCableArea / conduit.internalArea) * 100;
    const passes = fillPercent <= maxFillPercent;

    // Find smallest conduit that passes
    let recommendedConduit: string | null = null;
    if (!passes) {
      for (const [size, data] of Object.entries(CONDUIT_SIZES)) {
        const testFill = (totalCableArea / data.internalArea) * 100;
        if (testFill <= maxFillPercent) {
          recommendedConduit = size;
          break;
        }
      }
    }

    const warnings: string[] = [];
    if (!passes) warnings.push(`Fill exceeds ${maxFillPercent.toFixed(0)}% maximum for ${fillRatioKey === "3+" ? "3+" : fillRatioKey} cable(s) per AS/NZS 3080.`);
    if (fillPercent > maxFillPercent * 0.9 && passes) warnings.push("Fill is above 90% of maximum — cable pulling may be difficult.");

    setResult({
      totalCableArea: Math.round(totalCableArea * 10) / 10,
      conduitArea: conduit.internalArea,
      fillPercent: Math.round(fillPercent * 10) / 10,
      maxFillPercent: Math.round(maxFillPercent),
      passes,
      recommendedConduit,
      warnings,
    });
  };

  return (
    <ToolLayout
      title="Conduit Fill Calculator"
      subtitle="AS/NZS 3080 — Check cable fill capacity"
      disclaimer="Based on AS/NZS 3080 conduit fill ratios and AS/NZS 2053 conduit dimensions. Cable diameters are approximate — check manufacturer data for exact values."
      onBack={onBack}
      onCalculate={calculate}
      result={result ? (
        <>
          <p className="text-sm font-bold text-foreground mb-3">Result</p>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <ResultRow label="Cable area" value={result.totalCableArea} unit="mm²" size="sm" />
            <ResultRow label="Fill" value={result.fillPercent} unit="%"
              variant={result.passes ? "primary" : "destructive"} />
            <ResultRow label="Max allowed" value={result.maxFillPercent} unit="%" size="sm" />
          </div>
          {/* Visual fill bar */}
          <div className="w-full h-4 rounded-full bg-muted overflow-hidden mb-3">
            <div
              className={`h-full rounded-full transition-all ${result.passes ? "bg-primary" : "bg-destructive"}`}
              style={{ width: `${Math.min(result.fillPercent, 100)}%` }}
            />
          </div>
          <p className={`text-sm font-bold ${result.passes ? "text-primary" : "text-destructive"}`}>
            {result.passes ? "✅ PASS — within fill limits" : "❌ FAIL — exceeds fill limits"}
          </p>
          {result.recommendedConduit && (
            <div className="mt-3 p-2.5 rounded-lg bg-primary/5 border border-primary/20">
              <p className="text-xs font-bold text-primary">💡 Use {result.recommendedConduit}mm conduit instead</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Smallest conduit that meets fill requirements</p>
            </div>
          )}
          {result.warnings.map((w, i) => (
            <p key={i} className="text-xs text-destructive mt-2 font-medium">⚠️ {w}</p>
          ))}
        </>
      ) : undefined}
    >
      <div>
        <Label className="text-sm">Conduit Size</Label>
        <Select value={conduitSize} onValueChange={(v) => { setConduitSize(v); setResult(null); }}>
          <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(CONDUIT_SIZES).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label} ({v.internalArea} mm²)</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-bold">Cables in Conduit</Label>
          <Button variant="outline" size="sm" onClick={addCable} className="h-8 text-xs gap-1">
            <Plus className="h-3 w-3" /> Add Cable
          </Button>
        </div>

        {cables.map((cable, idx) => (
          <div key={cable.id} className="p-3 rounded-lg bg-muted/50 border border-border space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-muted-foreground">Cable {idx + 1}</p>
              {cables.length > 1 && (
                <button onClick={() => removeCable(cable.id)} className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <Select value={cable.cableType} onValueChange={(v) => updateCable(cable.id, "cableType", v)}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.keys(CABLE_TYPES).map(t => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="grid grid-cols-2 gap-2">
              <Select value={cable.cableSize} onValueChange={(v) => updateCable(cable.id, "cableSize", v)}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.keys(CABLE_TYPES[cable.cableType] || {}).map(s => (
                    <SelectItem key={s} value={s}>{s} mm²</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input type="number" inputMode="numeric" className="h-9 text-xs" placeholder="Qty"
                value={cable.quantity}
                onChange={(e) => updateCable(cable.id, "quantity", parseInt(e.target.value) || 1)} />
            </div>
          </div>
        ))}
      </div>
    </ToolLayout>
  );
};

export default ConduitFillTool;
