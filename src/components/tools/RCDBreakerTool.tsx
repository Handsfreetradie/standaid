import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import ToolLayout from "./ToolLayout";
import ResultRow from "./ResultRow";

// Decision-tree constants supplied by the lead engineer — AS/NZS 3000:2018
// Clause 2.6.3 (RCD protection of final subcircuits) and AS/NZS 61008/61009
// (RCD/RCBO device type & sensitivity classifications). Do not invent
// additional ratings/curves/types beyond what's listed here.
type CircuitType = "socket" | "lighting" | "fixed" | "ev" | "vsd1" | "vsd3" | "submain";
type LoadCharacter = "resistive" | "inrush" | "longrun";
type Location = "domestic" | "commercial" | "medical";

const CIRCUIT_LABELS: Record<CircuitType, string> = {
  socket: "Socket outlets (≤32 A)",
  lighting: "Lighting circuit",
  fixed: "Fixed appliance (oven, HWS, aircon ≤32 A)",
  ev: "EV charger",
  vsd1: "Single-phase VSD / heat pump / inverter appliance",
  vsd3: "Three-phase VSD / motor drive",
  submain: "Submain / distribution (selectivity)",
};

const STANDARD_RATINGS = [6, 10, 16, 20, 25, 32, 40, 50, 63, 80, 100];

interface RCDResult {
  rcdType: string;
  sensitivity: string;
  curve: string;
  rating: number | null;
  warnings: string[];
  notes: string[];
}

interface Props { onBack: () => void }

const RCDBreakerTool = ({ onBack }: Props) => {
  const [circuitType, setCircuitType] = useState<CircuitType>("socket");
  const [loadCurrent, setLoadCurrent] = useState("");
  const [loadCharacter, setLoadCharacter] = useState<LoadCharacter>("resistive");
  const [location, setLocation] = useState<Location>("domestic");
  const [result, setResult] = useState<RCDResult | null>(null);

  const calculate = () => {
    const I = parseFloat(loadCurrent);
    if (isNaN(I) || I <= 0) return;

    const warnings: string[] = [];
    const notes: string[] = [];

    // --- MCB rating: smallest standard rating >= load current ---
    let rating: number | null = STANDARD_RATINGS.find((r) => r >= I) ?? null;
    if (I > 100) {
      rating = null;
      warnings.push("Above 100 A — outside this tool's range, size per AS/NZS 3000 Section 2 with your supplier");
    }

    // --- MCB curve ---
    let curve: string;
    if (loadCharacter === "inrush") {
      curve = "D";
    } else if (loadCharacter === "longrun") {
      curve = "B";
      notes.push("Long-run / low-fault-current circuit — Curve B's lower magnetic trip threshold helps meet the Zs/disconnection-time requirement.");
    } else {
      curve = circuitType === "lighting" ? "B" : "C";
    }

    // --- RCD sensitivity ---
    let sensitivity: string;
    if (location === "medical") {
      sensitivity = "10";
      notes.push("Patient/body-protected area — 10 mA sensitivity per AS/NZS 3003.");
    } else if (circuitType === "submain") {
      sensitivity = "100 or 300 (Type S)";
      notes.push("Submain RCD is for selectivity/fire protection only — personnel protection must still be provided by a 30 mA RCD at the final subcircuit.");
    } else {
      sensitivity = "30";
    }

    // --- RCD type ---
    let rcdType: string;
    if (circuitType === "ev") {
      rcdType = "B";
      notes.push("Type B required unless the EV charger has built-in ≥6 mA DC fault detection, in which case Type A may be used.");
    } else if (circuitType === "vsd3") {
      rcdType = "B";
    } else if (circuitType === "vsd1") {
      rcdType = "F";
      notes.push("Type F suits single-phase VSDs/inverter loads; Type A may be acceptable for simple electronic loads — check the equipment manual.");
    } else if (circuitType === "submain") {
      rcdType = "S (time-delayed)";
      notes.push("Match the submain RCD type to the most demanding downstream load (A/F/B) as well as making it Type S for selectivity.");
    } else {
      rcdType = "A";
      notes.push("Type AC only suits purely sinusoidal loads and is not recommended for modern installations — Type A is the standard choice.");
    }

    // --- RCD required note / scope warning ---
    if (rating !== null && rating > 32) {
      warnings.push("This circuit rating exceeds the typical 32 A final-subcircuit RCD requirement scope (AS/NZS 3000 Clause 2.6.3) — check specific design requirements.");
    } else if (circuitType !== "submain") {
      notes.push("Final subcircuits ≤32 A require 30 mA RCD protection under AS/NZS 3000 Clause 2.6.3 (domestic, and commercial socket outlets).");
    }

    setResult({ rcdType, sensitivity, curve, rating, warnings, notes });
  };

  const heroText = result
    ? `Type ${result.rcdType} RCD · ${result.sensitivity} mA · ${result.rating !== null ? `${result.curve}${result.rating} A MCB` : "MCB rating outside range"}`
    : "";

  return (
    <ToolLayout
      title="RCD & Breaker Selection"
      subtitle="AS/NZS 3000 + AS/NZS 61008/61009 — RCD type, sensitivity & MCB curve"
      disclaimer="Guidance based on AS/NZS 3000:2018 Clause 2.6.3 and AS/NZS 61008/61009 device classifications. RCD type selection depends on the actual connected equipment's leakage characteristics — check the appliance manufacturer's requirements, and always confirm against your copy of the standard."
      onBack={onBack}
      onCalculate={calculate}
      verifyQuestion={
        result
          ? `For a ${CIRCUIT_LABELS[circuitType].toLowerCase()} rated at ${loadCurrent} A, does the recommended RCD type, ${result.sensitivity} mA sensitivity, and Curve ${result.curve} MCB comply with AS/NZS 3000 Clause 2.6.3?`
          : undefined
      }
      result={result ? (
        <>
          <div className={`p-3 rounded-lg mb-3 border ${
            !result.warnings.length ? "bg-primary/5 border-primary/20" : "bg-destructive/5 border-destructive/20"
          }`}>
            <p className="text-sm font-extrabold text-primary">{heroText}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {CIRCUIT_LABELS[circuitType]} • {loadCurrent} A
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <ResultRow label="RCD Type" value={result.rcdType} variant="primary" />
            <ResultRow label="Sensitivity" value={result.sensitivity} unit="mA" variant="primary" />
            <ResultRow label="MCB Curve" value={result.curve} size="sm" />
            <ResultRow label="MCB Rating" value={result.rating !== null ? result.rating : "—"} unit={result.rating !== null ? "A" : undefined} size="sm" />
          </div>
          {result.warnings.map((w, i) => (
            <p key={i} className="text-xs text-destructive mt-3 font-medium">⚠️ {w}</p>
          ))}
          {result.notes.map((n, i) => (
            <p key={i} className="text-xs text-muted-foreground mt-3">💡 {n}</p>
          ))}
        </>
      ) : undefined}
    >
      <div>
        <Label className="text-sm">Circuit Type</Label>
        <Select value={circuitType} onValueChange={(v) => { setCircuitType(v as CircuitType); setResult(null); }}>
          <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.entries(CIRCUIT_LABELS) as [CircuitType, string][]).map(([k, l]) => (
              <SelectItem key={k} value={k}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="text-sm">Load Current (A)</Label>
        <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="e.g. 20"
          value={loadCurrent} onChange={(e) => { setLoadCurrent(e.target.value); setResult(null); }} />
      </div>

      <div>
        <Label className="text-sm">Load Character</Label>
        <div className="flex gap-2 mt-1 flex-wrap">
          {([
            ["resistive", "Resistive / general"],
            ["inrush", "High inrush (motors, transformers)"],
            ["longrun", "Long run / low fault current"],
          ] as const).map(([k, l]) => (
            <Badge key={k} variant={loadCharacter === k ? "default" : "outline"}
              className="cursor-pointer px-3 py-1.5 text-sm"
              onClick={() => { setLoadCharacter(k); setResult(null); }}>
              {l}
            </Badge>
          ))}
        </div>
      </div>

      <div>
        <Label className="text-sm">Location</Label>
        <Select value={location} onValueChange={(v) => { setLocation(v as Location); setResult(null); }}>
          <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="domestic">Domestic / residential</SelectItem>
            <SelectItem value="commercial">Commercial / industrial</SelectItem>
            <SelectItem value="medical">Medical / patient area</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </ToolLayout>
  );
};

export default RCDBreakerTool;
