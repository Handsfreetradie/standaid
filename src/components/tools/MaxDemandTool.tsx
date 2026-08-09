import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import ToolLayout from "./ToolLayout";
import ResultRow from "./ResultRow";
import WorkingTable, { WorkingStep } from "./WorkingTable";
import { PhaseType } from "./electricalData";
import { C1_LOAD_GROUPS, calculateMaxDemandC1, MaxDemandResult } from "./maxDemandC1";

interface Props { onBack: () => void }

const MaxDemandTool = ({ onBack }: Props) => {
  const [phase, setPhase] = useState<PhaseType>("single");
  const [inputs, setInputs] = useState<Record<string, string>>({
    lighting: "25",
    gpo10: "30",
    cooking: "32",
    storageHws: "16",
  });
  const [result, setResult] = useState<MaxDemandResult | null>(null);

  const setValue = (key: string, val: string) => {
    setInputs((prev) => ({ ...prev, [key]: val }));
    setResult(null);
  };

  const calculate = () => {
    const numeric: Record<string, number> = {};
    for (const [k, v] of Object.entries(inputs)) {
      const n = parseFloat(v);
      if (!isNaN(n) && n > 0) numeric[k] = n;
    }
    setResult(calculateMaxDemandC1(numeric));
  };

  const workingSteps: WorkingStep[] = result ? [
    {
      label: "Sum load-group demands",
      working: result.lines.map((l) => `${l.demandA} A (${l.label})`).join(" + "),
      result: `${result.totalDemandA} A`,
      reference: "AS/NZS 3000:2018 Appendix C, Table C1",
    },
    {
      label: "Select main switch / protective device",
      working: `Smallest standard rating ≥ ${result.totalDemandA} A`,
      result: `${result.mainSwitchSizeA} A`,
      reference: "Standard device ratings",
    },
  ] : [];

  return (
    <ToolLayout
      title="Maximum Demand Calculator"
      subtitle="AS/NZS 3000 Table C1 — single domestic installation"
      disclaimer="Calculates maximum demand per phase for a SINGLE domestic installation using the load-group method of AS/NZS 3000:2018 Appendix C, Table C1 (column 2). Blocks of units use different columns, and non-domestic installations use Table C2 — always verify against your copy of the standard. Off-peak controlled loads on a separate tariff are excluded from demand."
      onBack={onBack}
      onCalculate={calculate}
      verifyQuestion={result
        ? `How do I calculate maximum demand for a single domestic installation using Table C1, and what are the load group contribution rules?`
        : undefined}
      result={result ? (
        <>
          <div className="p-3 rounded-lg mb-3 border bg-primary/5 border-primary/20">
            <p className="text-3xl font-extrabold text-primary">{result.totalDemandA} A</p>
            <p className="text-xs text-muted-foreground mt-1">
              Maximum demand per phase • Table C1 method
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <ResultRow label="Suggested main switch" value={result.mainSwitchSizeA} unit="A" variant="primary" size="sm" />
            <ResultRow label="Load groups counted" value={result.lines.length} size="sm" />
          </div>

          {/* Worked answer, line by line — same layout as the exam method */}
          <div className="mt-3 space-y-2">
            <p className="text-xs font-bold text-foreground">Working (Table C1)</p>
            {result.lines.map((l) => (
              <div key={l.key} className="p-2 rounded-lg bg-muted/50 border border-border">
                <div className="flex justify-between text-xs">
                  <span className="font-bold text-foreground">{l.label}</span>
                  <span className="font-mono font-bold text-primary">{l.demandA} A</span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Group {l.group}: {l.input} {l.inputKind === "points" ? "points" : "A connected"} → {l.rule}
                </p>
              </div>
            ))}
          </div>

          {phase === "three" && (
            <div className="mt-2 p-2 rounded-lg bg-muted">
              <p className="text-xs text-foreground">
                💡 Three-phase: this is the demand for the loads entered on ONE phase.
                Run the calculation per phase with each phase's loads and balance them as evenly as possible.
              </p>
            </div>
          )}
          {result.totalDemandA > 63 && phase === "single" && (
            <p className="text-xs text-destructive mt-2 font-medium">
              ⚠️ Demand above 63 A on single phase — check supply capacity with your DNSP or consider three-phase.
            </p>
          )}

          <WorkingTable steps={workingSteps} />
        </>
      ) : undefined}
    >
      <div>
        <Label className="text-sm">Supply</Label>
        <div className="flex gap-2 mt-1">
          {([["single", "Single Phase (1Ø)"], ["three", "Three Phase (3Ø)"]] as const).map(([k, l]) => (
            <Badge key={k} variant={phase === k ? "default" : "outline"}
              className="cursor-pointer px-3 py-1.5 text-sm"
              onClick={() => { setPhase(k as PhaseType); setResult(null); }}>
              {l}
            </Badge>
          ))}
        </div>
        {phase === "three" && (
          <p className="text-[10px] text-muted-foreground mt-1">
            Enter the loads connected to one phase — Table C1 is applied per phase.
          </p>
        )}
      </div>

      <div className="space-y-3">
        <Label className="text-sm font-bold">Loads (leave blank if not installed)</Label>
        {C1_LOAD_GROUPS.map((g) => (
          <div key={g.key} className="p-3 rounded-lg bg-muted/50 border border-border">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-foreground">{g.label}</p>
              <span className="text-[10px] font-mono text-muted-foreground">C1 {g.group}</span>
            </div>
            <Input
              type="number"
              inputMode="decimal"
              className="h-9 text-sm mt-2"
              placeholder={g.inputLabel}
              value={inputs[g.key] ?? ""}
              onChange={(e) => setValue(g.key, e.target.value)}
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              {g.inputLabel} — {g.rule}{g.hint ? `. ${g.hint}` : ""}
            </p>
          </div>
        ))}
      </div>
    </ToolLayout>
  );
};

export default MaxDemandTool;
