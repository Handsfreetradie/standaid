import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Trash2, Plus } from "lucide-react";
import ToolLayout from "./ToolLayout";
import AddToProjectModal from "./AddToProjectModal";
import { saveCalculationToProject } from "./projectUtils";
import ResultRow from "./ResultRow";
import WorkingTable, { WorkingStep } from "./WorkingTable";
import { CONDUIT_SIZES, CABLE_OD, CONDUIT_FILL_RATIOS } from "./electricalData";

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
  suggestions: string[];
}

interface Props { onBack: () => void }

let nextId = 1;

const ConduitFillTool = ({ onBack }: Props) => {
  const [conduitSize, setConduitSize] = useState("20");
  const [cables, setCables] = useState<CableEntry[]>([
    { id: nextId++, cableType: "V-90 (single core)", cableSize: "2.5", quantity: 3 },
  ]);
  const [result, setResult] = useState<FillResult | null>(null);
  const [showProjectModal, setShowProjectModal] = useState(false);

  const addCable = () => {
    setCables([...cables, { id: nextId++, cableType: "V-90 (single core)", cableSize: "2.5", quantity: 1 }]);
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
    const warnings: string[] = [];
    const suggestions: string[] = [];

    for (const cable of cables) {
      const typeData = CABLE_OD[cable.cableType];
      if (!typeData) continue;
      const od = typeData[cable.cableSize];
      if (!od) { warnings.push(`No OD data for ${cable.cableType} ${cable.cableSize}mm²`); continue; }
      const area = Math.PI * Math.pow(od / 2, 2);
      totalCableArea += area * cable.quantity;
      totalCableCount += cable.quantity;
    }

    const fillRatioKey = totalCableCount === 1 ? "1" : totalCableCount === 2 ? "2" : "3+";
    const maxRatio = CONDUIT_FILL_RATIOS[fillRatioKey].ratio;
    const maxFillPercent = maxRatio * 100;
    const fillPercent = (totalCableArea / conduit.internalArea) * 100;
    const passes = fillPercent <= maxFillPercent;

    let recommendedConduit: string | null = null;
    if (!passes) {
      for (const [size, data] of Object.entries(CONDUIT_SIZES)) {
        if ((totalCableArea / data.internalArea) * 100 <= maxFillPercent) {
          recommendedConduit = size;
          break;
        }
      }
    }

    if (!passes) warnings.push(`Fill exceeds the ${maxFillPercent.toFixed(0)}% space factor for ${fillRatioKey === "3+" ? "3+" : fillRatioKey} cable(s).`);
    if (fillPercent > maxFillPercent * 0.9 && passes) warnings.push("Fill above 90% of max — cable pulling may be difficult.");
    if (totalCableCount > 6) suggestions.push("Consider using cable tray instead of conduit for large cable groups.");

    setResult({
      totalCableArea: Math.round(totalCableArea * 10) / 10,
      conduitArea: conduit.internalArea,
      fillPercent: Math.round(fillPercent * 10) / 10,
      maxFillPercent: Math.round(maxFillPercent),
      passes,
      recommendedConduit,
      warnings,
      suggestions,
    });
  };

  const totalCableCount = cables.reduce((s, c) => s + c.quantity, 0);
  const fillRatioKey = totalCableCount === 1 ? "1" : totalCableCount === 2 ? "2" : "3+";

  const workingSteps: WorkingStep[] = result ? [
    {
      label: "Total cross-sectional area of cables",
      working: cables.map(c => `π×(OD/2)² × ${c.quantity} (${c.cableType} ${c.cableSize}mm²)`).join(" + "),
      result: `${result.totalCableArea} mm²`,
      reference: "Cable OD data — manufacturer / AS/NZS 2053",
    },
    {
      label: "Applicable space factor",
      working: `${totalCableCount} cable(s) in conduit → ${fillRatioKey === "3+" ? "3 or more" : fillRatioKey} cable rule`,
      result: `${result.maxFillPercent}% max fill`,
      reference: "Accepted conduit space factors (53% / 31% / 40%)",
    },
    {
      label: "Fill percentage",
      working: `${result.totalCableArea} mm² ÷ ${result.conduitArea} mm² × 100`,
      result: `${result.fillPercent}%`,
      reference: `${conduitSize} mm conduit internal area`,
    },
    {
      label: "Compliance check",
      working: `${result.fillPercent}% vs ${result.maxFillPercent}% max allowed`,
      result: result.passes ? "PASS" : "FAIL",
      reference: "Space factor limit",
    },
  ] : [];

  return (
    <ToolLayout
      title="Conduit Fill Calculator"
      subtitle="Space factor check — 53% / 31% / 40% fill rules"
      disclaimer="Uses the accepted conduit space factors (53% one cable, 31% two, 40% three or more) with AS/NZS 2053 conduit dimensions. Cable ODs are typical values — check manufacturer data for exact dimensions. Tight fills make cable pulling difficult and risk insulation damage."
      onBack={onBack}
      onCalculate={calculate}
      verifyQuestion={result
        ? `What are the conduit space factor rules for running multiple cables in a ${conduitSize} mm conduit?`
        : undefined}
      result={result ? (
        <>
          <div className={`p-3 rounded-lg mb-3 border ${
            result.passes ? "bg-primary/5 border-primary/20" : "bg-destructive/5 border-destructive/20"
          }`}>
            <p className={`text-sm font-extrabold ${result.passes ? "text-primary" : "text-destructive"}`}>
              {result.passes ? "✅ PASS — within fill limits" : "❌ FAIL — exceeds fill limits"}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <ResultRow label="Cable area" value={result.totalCableArea} unit="mm²" size="sm" />
            <ResultRow label="Fill" value={result.fillPercent} unit="%"
              variant={result.passes ? "primary" : "destructive"} />
            <ResultRow label="Max allowed" value={result.maxFillPercent} unit="%" size="sm" />
          </div>
          <div className="w-full h-4 rounded-full bg-muted overflow-hidden mb-3">
            <div
              className={`h-full rounded-full transition-all ${result.passes ? "bg-primary" : "bg-destructive"}`}
              style={{ width: `${Math.min(result.fillPercent, 100)}%` }}
            />
          </div>
          {result.recommendedConduit && (
            <div className="mt-2 p-2.5 rounded-lg bg-primary/5 border border-primary/20">
              <p className="text-xs font-bold text-primary">💡 Use {result.recommendedConduit}mm conduit instead</p>
            </div>
          )}
          {result.suggestions.map((s, i) => (
            <div key={i} className="mt-2 p-2 rounded-lg bg-muted">
              <p className="text-xs text-foreground">💡 {s}</p>
            </div>
          ))}
          {result.warnings.map((w, i) => (
            <p key={i} className="text-xs text-destructive mt-2 font-medium">⚠️ {w}</p>
          ))}

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
      advancedInputs={undefined}
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
                {Object.keys(CABLE_OD).map(t => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="grid grid-cols-2 gap-2">
              <Select value={cable.cableSize} onValueChange={(v) => updateCable(cable.id, "cableSize", v)}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.keys(CABLE_OD[cable.cableType] || {}).map(s => (
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

      <AddToProjectModal
        isOpen={showProjectModal}
        onClose={() => setShowProjectModal(false)}
        onSave={(projectId, projectName, calcLabel) => {
          saveCalculationToProject(
            projectId,
            projectName,
            "conduit-fill",
            "Conduit Fill",
            {}, // Inputs - populate based on tool state
            result,
            `Conduit Fill calculation`,
            calcLabel
          );
          setShowProjectModal(false);
        }}
        calculationSummary={result ? `Conduit Fill` : ''}
      />
        </ToolLayout>
  );
};

export default ConduitFillTool;
