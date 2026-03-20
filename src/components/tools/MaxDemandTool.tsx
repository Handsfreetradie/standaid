import { useState, useMemo } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import ToolLayout from "./ToolLayout";
import ResultRow from "./ResultRow";
import {
  SystemType, PhaseType, AC_VOLTAGES, DC_VOLTAGES,
} from "./electricalData";

// AS/NZS 3000 Table C1 — Diversity factors
const CIRCUIT_TYPES: Record<string, { label: string; demandFactor: number; typicalAmps: number }> = {
  "lighting": { label: "Lighting", demandFactor: 1.0, typicalAmps: 10 },
  "socket-gpo": { label: "Socket outlets (GPO)", demandFactor: 1.0, typicalAmps: 10 },
  "cooking": { label: "Cooking appliance", demandFactor: 1.0, typicalAmps: 32 },
  "water-heater": { label: "Water heater", demandFactor: 1.0, typicalAmps: 15 },
  "aircon": { label: "Air conditioning", demandFactor: 1.0, typicalAmps: 10 },
  "oven": { label: "Oven / cooktop", demandFactor: 1.0, typicalAmps: 32 },
  "dryer": { label: "Clothes dryer", demandFactor: 1.0, typicalAmps: 10 },
  "pool-pump": { label: "Pool pump / spa", demandFactor: 1.0, typicalAmps: 10 },
  "ev-charger": { label: "EV charger", demandFactor: 1.0, typicalAmps: 32 },
  "motor": { label: "Motor load", demandFactor: 1.0, typicalAmps: 10 },
  "other": { label: "Other", demandFactor: 1.0, typicalAmps: 10 },
};

// AS/NZS 3000 diversity table (simplified residential)
const DIVERSITY_LIGHTING: Record<number, number> = {
  1: 1.0, 2: 1.0, 3: 0.75, 4: 0.70, 5: 0.65, 6: 0.62, 7: 0.60, 8: 0.58, 9: 0.56, 10: 0.55,
};

const DIVERSITY_GPO: Record<number, number> = {
  1: 1.0, 2: 0.80, 3: 0.70, 4: 0.65, 5: 0.60, 6: 0.57, 7: 0.54, 8: 0.52, 9: 0.50, 10: 0.48,
};

interface CircuitEntry {
  id: number;
  type: string;
  quantity: number;
  amps: number;
}

interface DemandResult {
  totalConnected: number;
  maxDemand: number;
  diversityFactor: number;
  mainBreakerSize: number;
  perCircuitBreakdown: { label: string; connected: number; diversified: number }[];
  warnings: string[];
  suggestions: string[];
}

interface Props { onBack: () => void }

let nextCircuitId = 1;

const MaxDemandTool = ({ onBack }: Props) => {
  const [system, setSystem] = useState<SystemType>("ac");
  const [phase, setPhase] = useState<PhaseType>("single");
  const [voltage, setVoltage] = useState("230");
  const [circuits, setCircuits] = useState<CircuitEntry[]>([
    { id: nextCircuitId++, type: "lighting", quantity: 2, amps: 10 },
    { id: nextCircuitId++, type: "socket-gpo", quantity: 3, amps: 10 },
    { id: nextCircuitId++, type: "cooking", quantity: 1, amps: 32 },
    { id: nextCircuitId++, type: "water-heater", quantity: 1, amps: 15 },
  ]);
  const [result, setResult] = useState<DemandResult | null>(null);

  const voltageOptions = system === "ac" ? AC_VOLTAGES : DC_VOLTAGES;

  const addCircuit = () => {
    setCircuits([...circuits, { id: nextCircuitId++, type: "other", quantity: 1, amps: 10 }]);
    setResult(null);
  };

  const removeCircuit = (id: number) => {
    if (circuits.length <= 1) return;
    setCircuits(circuits.filter(c => c.id !== id));
    setResult(null);
  };

  const updateCircuit = (id: number, field: keyof CircuitEntry, value: string | number) => {
    setCircuits(circuits.map(c => {
      if (c.id !== id) return c;
      const updated = { ...c, [field]: value };
      // Auto-fill typical amps when type changes
      if (field === "type") {
        updated.amps = CIRCUIT_TYPES[value as string]?.typicalAmps || 10;
      }
      return updated;
    }));
    setResult(null);
  };

  const calculate = () => {
    const V = parseFloat(voltage);
    if (isNaN(V) || V <= 0) return;

    const warnings: string[] = [];
    const suggestions: string[] = [];
    const breakdown: { label: string; connected: number; diversified: number }[] = [];

    let totalConnected = 0;
    let totalDiversified = 0;

    // Group circuits by type for diversity
    const grouped: Record<string, { totalAmps: number; count: number }> = {};
    for (const c of circuits) {
      if (!grouped[c.type]) grouped[c.type] = { totalAmps: 0, count: 0 };
      grouped[c.type].totalAmps += c.amps * c.quantity;
      grouped[c.type].count += c.quantity;
    }

    for (const [type, data] of Object.entries(grouped)) {
      const connected = data.totalAmps;
      totalConnected += connected;

      let diversityFactor = 1.0;
      if (type === "lighting") {
        diversityFactor = DIVERSITY_LIGHTING[Math.min(data.count, 10)] ?? 0.55;
      } else if (type === "socket-gpo") {
        diversityFactor = DIVERSITY_GPO[Math.min(data.count, 10)] ?? 0.48;
      } else if (type === "cooking" || type === "oven") {
        // AS/NZS 3000 cooking diversity
        diversityFactor = data.count === 1 ? 1.0 : 0.80;
      } else if (type === "aircon") {
        diversityFactor = data.count > 1 ? 0.75 : 1.0;
      } else {
        diversityFactor = 1.0;
      }

      const diversified = Math.round(connected * diversityFactor);
      totalDiversified += diversified;

      breakdown.push({
        label: CIRCUIT_TYPES[type]?.label || type,
        connected,
        diversified,
      });
    }

    const overallDiversity = totalConnected > 0 ? totalDiversified / totalConnected : 1.0;

    // Main breaker sizing — next standard size up
    const breakerSizes = [16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400];
    const mainBreakerSize = breakerSizes.find(b => b >= totalDiversified) || breakerSizes[breakerSizes.length - 1];

    // Three phase consideration
    if (system === "ac" && phase === "three") {
      const perPhase = totalDiversified / 3;
      suggestions.push(`Per-phase demand: ~${Math.round(perPhase)}A — balance loads across phases.`);
    }

    if (totalDiversified > 100 && phase === "single") {
      warnings.push("Max demand exceeds 100A on single phase — consider three-phase supply.");
    }
    if (totalDiversified > 63 && phase === "single") {
      suggestions.push("Demand above 63A — check with DNSP for supply capacity.");
    }

    setResult({
      totalConnected,
      maxDemand: totalDiversified,
      diversityFactor: Math.round(overallDiversity * 100) / 100,
      mainBreakerSize,
      perCircuitBreakdown: breakdown,
      warnings,
      suggestions,
    });
  };

  return (
    <ToolLayout
      title="Maximum Demand Calculator"
      subtitle="AS/NZS 3000 — Calculate max demand with diversity"
      disclaimer="Based on AS/NZS 3000 Section 2 maximum demand calculations. Diversity factors are simplified for residential installations — commercial installations may differ. Always verify with the full standard."
      onBack={onBack}
      onCalculate={calculate}
      result={result ? (
        <>
          <div className="p-3 rounded-lg mb-3 border bg-primary/5 border-primary/20">
            <p className="text-3xl font-extrabold text-primary">{result.maxDemand} A</p>
            <p className="text-xs text-muted-foreground mt-1">
              Maximum demand • {system === "dc" ? "DC" : phase === "three" ? "3Ø" : "1Ø"} {voltage}V
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-3">
            <ResultRow label="Connected" value={result.totalConnected} unit="A" size="sm" />
            <ResultRow label="Diversity" value={result.diversityFactor} size="sm" />
            <ResultRow label="Main CB" value={result.mainBreakerSize} unit="A" variant="primary" size="sm" />
          </div>

          <div className="mt-3 space-y-1">
            <p className="text-xs font-bold text-foreground mb-1">Breakdown</p>
            {result.perCircuitBreakdown.map((b, i) => (
              <div key={i} className="flex justify-between text-xs py-1 border-b border-border last:border-0">
                <span className="text-muted-foreground">{b.label}</span>
                <span className="font-mono">
                  <span className="text-muted-foreground">{b.connected}A →</span>{" "}
                  <span className="font-bold text-foreground">{b.diversified}A</span>
                </span>
              </div>
            ))}
          </div>

          {result.suggestions.map((s, i) => (
            <div key={i} className="mt-2 p-2 rounded-lg bg-muted">
              <p className="text-xs text-foreground">💡 {s}</p>
            </div>
          ))}
          {result.warnings.map((w, i) => (
            <p key={i} className="text-xs text-destructive mt-2 font-medium">⚠️ {w}</p>
          ))}
        </>
      ) : undefined}
    >
      {/* System Type */}
      <div>
        <Label className="text-sm font-bold">System Type</Label>
        <div className="flex gap-2 mt-1">
          {(["ac", "dc"] as const).map(s => (
            <Badge key={s} variant={system === s ? "default" : "outline"}
              className="cursor-pointer px-4 py-2 text-sm font-bold"
              onClick={() => { setSystem(s); setVoltage(s === "dc" ? "48" : phase === "three" ? "400" : "230"); setResult(null); }}>
              {s.toUpperCase()}
            </Badge>
          ))}
        </div>
      </div>

      {system === "ac" && (
        <div>
          <Label className="text-sm">Phase</Label>
          <div className="flex gap-2 mt-1">
            {([["single", "Single (1Ø)"], ["three", "Three (3Ø)"]] as const).map(([k, l]) => (
              <Badge key={k} variant={phase === k ? "default" : "outline"}
                className="cursor-pointer px-3 py-1.5 text-sm"
                onClick={() => { setPhase(k as PhaseType); setVoltage(k === "three" ? "400" : "230"); setResult(null); }}>
                {l}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <div>
        <Label className="text-sm">Supply Voltage</Label>
        <div className="flex gap-2 mt-1 flex-wrap">
          {voltageOptions.map(v => (
            <Badge key={v} variant={voltage === v ? "default" : "outline"}
              className="cursor-pointer px-3 py-1.5 text-sm"
              onClick={() => { setVoltage(v); setResult(null); }}>
              {v}V
            </Badge>
          ))}
        </div>
      </div>

      {/* Circuits */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-bold">Circuits</Label>
          <Button variant="outline" size="sm" onClick={addCircuit} className="h-8 text-xs gap-1">
            <Plus className="h-3 w-3" /> Add Circuit
          </Button>
        </div>

        {circuits.map((circuit, idx) => (
          <div key={circuit.id} className="p-3 rounded-lg bg-muted/50 border border-border space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-muted-foreground">Circuit {idx + 1}</p>
              {circuits.length > 1 && (
                <button onClick={() => removeCircuit(circuit.id)} className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <Select value={circuit.type} onValueChange={(v) => updateCircuit(circuit.id, "type", v)}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(CIRCUIT_TYPES).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Input type="number" inputMode="numeric" className="h-9 text-xs" placeholder="Qty"
                  value={circuit.quantity}
                  onChange={(e) => updateCircuit(circuit.id, "quantity", parseInt(e.target.value) || 1)} />
                <p className="text-[10px] text-muted-foreground mt-0.5">Qty</p>
              </div>
              <div>
                <Input type="number" inputMode="decimal" className="h-9 text-xs" placeholder="Amps"
                  value={circuit.amps}
                  onChange={(e) => updateCircuit(circuit.id, "amps", parseFloat(e.target.value) || 0)} />
                <p className="text-[10px] text-muted-foreground mt-0.5">Amps each</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </ToolLayout>
  );
};

export default MaxDemandTool;
