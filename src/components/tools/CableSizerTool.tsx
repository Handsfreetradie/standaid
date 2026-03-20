import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import ToolLayout from "./ToolLayout";
import ResultRow from "./ResultRow";

// Current-carrying capacity per AS/NZS 3008.1.1 Table 4 col 4 (copper, PVC, enclosed)
// Simplified for single-circuit, 40°C ambient reference
const CABLE_CAPACITY_COPPER: Record<string, number> = {
  "1": 14, "1.5": 17.5, "2.5": 24, "4": 32, "6": 41, "10": 56, "16": 73,
  "25": 97, "35": 119, "50": 144, "70": 184, "95": 223, "120": 260,
  "150": 299, "185": 341, "240": 400,
};

const CABLE_CAPACITY_ALUMINIUM: Record<string, number> = {
  "16": 57, "25": 75, "35": 92, "50": 112, "70": 143, "95": 173,
  "120": 202, "150": 232, "185": 265, "240": 311,
};

// mV/A/m for voltage drop verification
const MV_TABLE: Record<string, Record<string, number>> = {
  "copper-single": {
    "1": 44, "1.5": 29, "2.5": 18, "4": 11, "6": 7.3, "10": 4.4, "16": 2.8,
    "25": 1.75, "35": 1.25, "50": 0.93, "70": 0.63, "95": 0.47, "120": 0.37,
    "150": 0.30, "185": 0.25, "240": 0.19,
  },
  "copper-three": {
    "1": 38, "1.5": 25, "2.5": 15.5, "4": 9.5, "6": 6.4, "10": 3.8, "16": 2.4,
    "25": 1.5, "35": 1.1, "50": 0.81, "70": 0.55, "95": 0.41, "120": 0.32,
    "150": 0.26, "185": 0.22, "240": 0.165,
  },
  "aluminium-single": {
    "16": 4.6, "25": 2.85, "35": 2.05, "50": 1.5, "70": 1.05,
    "95": 0.77, "120": 0.61, "150": 0.50, "185": 0.41, "240": 0.315,
  },
  "aluminium-three": {
    "16": 4.0, "25": 2.5, "35": 1.8, "50": 1.3, "70": 0.91,
    "95": 0.67, "120": 0.53, "150": 0.43, "185": 0.35, "240": 0.27,
  },
};

const TEMP_DERATING: Record<string, number> = {
  "25": 1.10, "30": 1.04, "35": 1.0, "40": 0.94, "45": 0.87, "50": 0.79,
};

const INSTALL_DERATING: Record<string, { label: string; factor: number }> = {
  "clipped": { label: "Clipped direct", factor: 1.0 },
  "conduit": { label: "In conduit / trunking", factor: 0.94 },
  "buried-direct": { label: "Buried direct", factor: 0.97 },
  "buried-conduit": { label: "Buried in conduit", factor: 0.88 },
  "insulation": { label: "In thermal insulation", factor: 0.75 },
  "tray-spaced": { label: "On tray (spaced)", factor: 1.0 },
  "free-air": { label: "Free air", factor: 1.05 },
};

interface SizerResult {
  recommendedSize: string;
  deratedCapacity: number;
  vdPercent: number;
  vdVolts: number;
  meetsVd: boolean;
  meetsCapacity: boolean;
  alternativeSize: string | null;
  warnings: string[];
}

interface Props { onBack: () => void }

const CableSizerTool = ({ onBack }: Props) => {
  const [material, setMaterial] = useState("copper");
  const [phase, setPhase] = useState("single");
  const [current, setCurrent] = useState("");
  const [length, setLength] = useState("");
  const [voltage, setVoltage] = useState("230");
  const [maxVdPercent, setMaxVdPercent] = useState("5");
  const [ambientTemp, setAmbientTemp] = useState("35");
  const [installMethod, setInstallMethod] = useState("conduit");
  const [result, setResult] = useState<SizerResult | null>(null);

  const capacityTable = material === "copper" ? CABLE_CAPACITY_COPPER : CABLE_CAPACITY_ALUMINIUM;
  const sizes = Object.keys(capacityTable);

  const calculate = () => {
    const I = parseFloat(current);
    const L = parseFloat(length);
    const V = parseFloat(voltage);
    const maxVd = parseFloat(maxVdPercent);
    if (isNaN(I) || isNaN(L) || isNaN(V) || I <= 0 || L <= 0 || V <= 0) return;

    const tempFactor = TEMP_DERATING[ambientTemp] || 1.0;
    const installFactor = INSTALL_DERATING[installMethod]?.factor || 1.0;
    const totalDerating = tempFactor * installFactor;

    const tableKey = `${material}-${phase}`;
    const mvTable = MV_TABLE[tableKey] || {};
    const warnings: string[] = [];

    let recommended: string | null = null;
    let deratedCap = 0;
    let vdP = 0;
    let vdV = 0;

    // Find smallest cable that meets BOTH capacity and voltage drop
    for (const size of sizes) {
      const baseCapacity = capacityTable[size];
      const derated = baseCapacity * totalDerating;
      const mv = mvTable[size];
      if (!mv) continue;
      const voltageDrop = (mv * I * L) / 1000;
      const vdPct = (voltageDrop / V) * 100;

      if (derated >= I && vdPct <= maxVd) {
        recommended = size;
        deratedCap = Math.round(derated);
        vdP = Math.round(vdPct * 100) / 100;
        vdV = Math.round(voltageDrop * 100) / 100;
        break;
      }
    }

    if (!recommended) {
      warnings.push("No standard cable size meets both current capacity and voltage drop requirements. Consider shorter runs, larger supply, or parallel cables.");
      return;
    }

    // Find next size up as alternative
    const recIdx = sizes.indexOf(recommended);
    const alternativeSize = recIdx < sizes.length - 1 ? sizes[recIdx + 1] : null;

    const meetsVd = vdP <= maxVd;
    const meetsCapacity = deratedCap >= I;

    if (vdP > 3 && vdP <= maxVd) warnings.push("Voltage drop above 3% — check sub-circuit allowance.");

    setResult({
      recommendedSize: recommended,
      deratedCapacity: deratedCap,
      vdPercent: vdP,
      vdVolts: vdV,
      meetsVd,
      meetsCapacity,
      alternativeSize,
      warnings,
    });
  };

  const handlePhaseChange = (val: string) => {
    setPhase(val);
    setVoltage(val === "three" ? "400" : "230");
    setResult(null);
  };

  return (
    <ToolLayout
      title="Cable Sizer"
      subtitle="Find the right cable for your load, distance & conditions"
      disclaimer="Based on AS/NZS 3008.1.1 current capacity and mV/A/m tables. Derating factors are simplified — always verify with the full standard for critical installations."
      onBack={onBack}
      onCalculate={calculate}
      result={result ? (
        <>
          <p className="text-sm font-bold text-foreground mb-3">Recommended Cable</p>
          <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 mb-3">
            <p className="text-3xl font-extrabold text-primary">{result.recommendedSize} mm²</p>
            <p className="text-xs text-muted-foreground mt-1">
              {material === "copper" ? "Copper" : "Aluminium"} • {phase === "single" ? "Single" : "Three"} phase
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4 mb-3">
            <ResultRow label="Derated capacity" value={result.deratedCapacity} unit="A" variant="primary" />
            <ResultRow label="Voltage drop" value={result.vdPercent} unit="%"
              variant={result.vdPercent > 5 ? "destructive" : result.vdPercent > 3 ? "warning" : "primary"} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <ResultRow label="VD (volts)" value={result.vdVolts} unit="V" size="sm" />
            {result.alternativeSize && (
              <ResultRow label="Next size up" value={result.alternativeSize} unit="mm²" size="sm" />
            )}
          </div>
          {result.warnings.map((w, i) => (
            <p key={i} className="text-xs text-destructive mt-2 font-medium">⚠️ {w}</p>
          ))}
        </>
      ) : undefined}
      advancedInputs={
        <>
          <div>
            <Label className="text-sm">Max Voltage Drop (%)</Label>
            <div className="flex gap-2 mt-1">
              {["3", "5", "7"].map(v => (
                <Badge key={v} variant={maxVdPercent === v ? "default" : "outline"}
                  className="cursor-pointer px-3 py-1.5 text-sm"
                  onClick={() => { setMaxVdPercent(v); setResult(null); }}>
                  {v}%
                </Badge>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-sm">Ambient Temperature</Label>
            <Select value={ambientTemp} onValueChange={setAmbientTemp}>
              <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(TEMP_DERATING).map(([t, f]) => (
                  <SelectItem key={t} value={t}>{t}°C {f !== 1.0 ? `(×${f})` : "(reference)"}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-sm">Installation Method</Label>
            <Select value={installMethod} onValueChange={setInstallMethod}>
              <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(INSTALL_DERATING).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label} (×{v.factor})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-sm">Material</Label>
          <Select value={material} onValueChange={(v) => { setMaterial(v); setResult(null); }}>
            <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="copper">Copper</SelectItem>
              <SelectItem value="aluminium">Aluminium</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-sm">Phase</Label>
          <Select value={phase} onValueChange={handlePhaseChange}>
            <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="single">Single Phase</SelectItem>
              <SelectItem value="three">Three Phase</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-sm">Load Current (A)</Label>
          <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="e.g. 32"
            value={current} onChange={(e) => setCurrent(e.target.value)} />
        </div>
        <div>
          <Label className="text-sm">Cable Run (m)</Label>
          <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="e.g. 45"
            value={length} onChange={(e) => setLength(e.target.value)} />
          <p className="text-[10px] text-muted-foreground mt-0.5">One-way length</p>
        </div>
      </div>

      <div>
        <Label className="text-sm">Supply Voltage</Label>
        <div className="flex gap-2 mt-1">
          {["230", "240", "400", "415"].map(v => (
            <Badge key={v} variant={voltage === v ? "default" : "outline"}
              className="cursor-pointer px-3 py-1.5 text-sm"
              onClick={() => { setVoltage(v); setResult(null); }}>
              {v}V
            </Badge>
          ))}
        </div>
      </div>
    </ToolLayout>
  );
};

export default CableSizerTool;
