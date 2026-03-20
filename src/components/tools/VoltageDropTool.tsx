import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import ToolLayout from "./ToolLayout";
import ResultRow from "./ResultRow";

// AS/NZS 3008.1.1 Table 40 — mV/A/m values
// Keys: `${material}-${phase}` → { cableSize: mvPerAm }
const MV_TABLE: Record<string, Record<string, number>> = {
  "copper-single": {
    "1": 44.0, "1.5": 29.0, "2.5": 18.0, "4": 11.0, "6": 7.3,
    "10": 4.4, "16": 2.8, "25": 1.75, "35": 1.25, "50": 0.93,
    "70": 0.63, "95": 0.47, "120": 0.37, "150": 0.30, "185": 0.25, "240": 0.19,
  },
  "copper-three": {
    "1": 38.0, "1.5": 25.0, "2.5": 15.5, "4": 9.5, "6": 6.4,
    "10": 3.8, "16": 2.4, "25": 1.5, "35": 1.1, "50": 0.81,
    "70": 0.55, "95": 0.41, "120": 0.32, "150": 0.26, "185": 0.22, "240": 0.165,
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

// Temperature derating factors per AS/NZS 3008 Table 27
const TEMP_DERATING: Record<string, number> = {
  "25": 1.10, "30": 1.04, "35": 1.0, "40": 0.94, "45": 0.87,
  "50": 0.79, "55": 0.71, "60": 0.61,
};

// Installation method derating per AS/NZS 3008 Table 22-25 (simplified)
const INSTALL_DERATING: Record<string, { label: string; factor: number }> = {
  "clipped": { label: "Clipped direct", factor: 1.0 },
  "conduit": { label: "In conduit / trunking", factor: 0.94 },
  "buried-direct": { label: "Buried direct", factor: 0.97 },
  "buried-conduit": { label: "Buried in conduit", factor: 0.88 },
  "insulation": { label: "In thermal insulation", factor: 0.75 },
  "tray-touching": { label: "On tray (touching)", factor: 0.87 },
  "tray-spaced": { label: "On tray (spaced)", factor: 1.0 },
  "free-air": { label: "Free air / suspended", factor: 1.05 },
};

const CABLE_SIZES_COPPER = ["1", "1.5", "2.5", "4", "6", "10", "16", "25", "35", "50", "70", "95", "120", "150", "185", "240"];
const CABLE_SIZES_ALUMINIUM = ["16", "25", "35", "50", "70", "95", "120", "150", "185", "240"];

interface VdResult {
  vdVolts: number;
  vdPercent: number;
  deratedCapacity: number | null;
  recommendedSize: string | null;
  warnings: string[];
}

interface Props { onBack: () => void }

const VoltageDropTool = ({ onBack }: Props) => {
  // Core inputs
  const [material, setMaterial] = useState("copper");
  const [phase, setPhase] = useState("single");
  const [cableSize, setCableSize] = useState("2.5");
  const [current, setCurrent] = useState("");
  const [length, setLength] = useState("");
  const [voltage, setVoltage] = useState("230");

  // Advanced inputs
  const [powerFactor, setPowerFactor] = useState("1.0");
  const [ambientTemp, setAmbientTemp] = useState("35");
  const [installMethod, setInstallMethod] = useState("clipped");
  const [circuits, setCircuits] = useState("1");

  const [result, setResult] = useState<VdResult | null>(null);

  const availableSizes = material === "copper" ? CABLE_SIZES_COPPER : CABLE_SIZES_ALUMINIUM;
  const tableKey = `${material}-${phase}`;

  const calculate = () => {
    const I = parseFloat(current);
    const L = parseFloat(length);
    const V = parseFloat(voltage);
    const pf = parseFloat(powerFactor) || 1.0;
    if (isNaN(I) || isNaN(L) || isNaN(V) || I <= 0 || L <= 0 || V <= 0) return;

    const table = MV_TABLE[tableKey] || {};
    const mvPerAm = table[cableSize];
    if (!mvPerAm) return;

    // Vd = (mV/A/m × I × L × PF) / 1000
    const vdVolts = (mvPerAm * I * L * pf) / 1000;
    const vdPercent = (vdVolts / V) * 100;

    // Derating
    const tempFactor = TEMP_DERATING[ambientTemp] || 1.0;
    const installFactor = INSTALL_DERATING[installMethod]?.factor || 1.0;
    const groupFactor = parseInt(circuits) > 1 ? Math.max(0.7, 1 - (parseInt(circuits) - 1) * 0.08) : 1.0;
    const totalDerating = tempFactor * installFactor * groupFactor;

    // Rough current capacity estimates (copper PVC single)
    const BASE_CAPACITY: Record<string, number> = {
      "1": 14, "1.5": 17.5, "2.5": 24, "4": 32, "6": 41, "10": 56, "16": 73,
      "25": 97, "35": 119, "50": 144, "70": 184, "95": 223, "120": 260,
      "150": 299, "185": 341, "240": 400,
    };
    const baseCapacity = BASE_CAPACITY[cableSize] || null;
    const deratedCapacity = baseCapacity ? Math.round(baseCapacity * totalDerating) : null;

    const warnings: string[] = [];
    if (vdPercent > 5) warnings.push("Exceeds AS/NZS 3000 maximum 5% voltage drop.");
    if (vdPercent > 3 && vdPercent <= 5) warnings.push("Above 3% — consider final sub-circuit allowance.");
    if (deratedCapacity && I > deratedCapacity) warnings.push(`Current ${I}A exceeds derated cable capacity of ${deratedCapacity}A.`);

    // Recommend smallest cable that stays under 5%
    let recommendedSize: string | null = null;
    if (vdPercent > 5) {
      for (const size of availableSizes) {
        const mv = table[size];
        if (!mv) continue;
        const testVd = (mv * I * L * pf) / 1000;
        if ((testVd / V) * 100 <= 5) {
          recommendedSize = size;
          break;
        }
      }
    }

    setResult({
      vdVolts: Math.round(vdVolts * 100) / 100,
      vdPercent: Math.round(vdPercent * 100) / 100,
      deratedCapacity,
      recommendedSize,
      warnings,
    });
  };

  // Reset cable size if it's not available for the selected material
  const handleMaterialChange = (val: string) => {
    setMaterial(val);
    const sizes = val === "copper" ? CABLE_SIZES_COPPER : CABLE_SIZES_ALUMINIUM;
    if (!sizes.includes(cableSize)) setCableSize(sizes[0]);
    setResult(null);
  };

  const handlePhaseChange = (val: string) => {
    setPhase(val);
    setVoltage(val === "three" ? "400" : "230");
    setResult(null);
  };

  return (
    <ToolLayout
      title="Voltage Drop Calculator"
      subtitle="Per AS/NZS 3008.1.1 — Full cable analysis"
      disclaimer="Based on AS/NZS 3008.1.1 mV/A/m tables. Derating factors are simplified — always verify with the full standard for critical installations."
      onBack={onBack}
      onCalculate={calculate}
      result={result ? (
        <>
          <p className="text-sm font-bold text-foreground mb-3">Results</p>
          <div className="grid grid-cols-2 gap-4">
            <ResultRow label="Voltage Drop" value={result.vdVolts} unit="V" />
            <ResultRow
              label={result.vdPercent > 5 ? "EXCEEDS 5% limit" : result.vdPercent > 3 ? "Within limit (watch)" : "Within 5% limit"}
              value={result.vdPercent}
              unit="%"
              variant={result.vdPercent > 5 ? "destructive" : result.vdPercent > 3 ? "warning" : "primary"}
            />
            {result.deratedCapacity && (
              <ResultRow label="Derated capacity" value={result.deratedCapacity} unit="A" />
            )}
          </div>
          {result.recommendedSize && (
            <div className="mt-3 p-2.5 rounded-lg bg-primary/5 border border-primary/20">
              <p className="text-xs font-bold text-primary">💡 Recommended: {result.recommendedSize} mm² cable</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Smallest size that keeps voltage drop ≤ 5%</p>
            </div>
          )}
          {result.warnings.map((w, i) => (
            <p key={i} className="text-xs text-destructive mt-2 font-medium">⚠️ {w}</p>
          ))}
        </>
      ) : undefined}
      advancedInputs={
        <>
          <div>
            <Label className="text-sm">Power Factor</Label>
            <Select value={powerFactor} onValueChange={setPowerFactor}>
              <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1.0">1.0 — Resistive (heaters, lights)</SelectItem>
                <SelectItem value="0.95">0.95 — Mixed loads</SelectItem>
                <SelectItem value="0.9">0.9 — Motors / inductive</SelectItem>
                <SelectItem value="0.85">0.85 — Heavy motors</SelectItem>
                <SelectItem value="0.8">0.8 — Poor PF loads</SelectItem>
              </SelectContent>
            </Select>
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
          <div>
            <Label className="text-sm">Grouped Circuits</Label>
            <Select value={circuits} onValueChange={setCircuits}>
              <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 circuit (no derating)</SelectItem>
                <SelectItem value="2">2 circuits</SelectItem>
                <SelectItem value="3">3 circuits</SelectItem>
                <SelectItem value="4">4 circuits</SelectItem>
                <SelectItem value="5">5+ circuits</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      }
    >
      {/* Core inputs */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-sm">Cable Material</Label>
          <Select value={material} onValueChange={handleMaterialChange}>
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

      <div>
        <Label className="text-sm">Cable Size (mm²)</Label>
        <Select value={cableSize} onValueChange={(v) => { setCableSize(v); setResult(null); }}>
          <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {availableSizes.map((s) => (
              <SelectItem key={s} value={s}>{s} mm²</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-sm">Load Current (A)</Label>
          <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="e.g. 20"
            value={current} onChange={(e) => setCurrent(e.target.value)} />
        </div>
        <div>
          <Label className="text-sm">Cable Length (m)</Label>
          <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="e.g. 30"
            value={length} onChange={(e) => setLength(e.target.value)} />
          <p className="text-[10px] text-muted-foreground mt-0.5">One-way run</p>
        </div>
      </div>

      <div>
        <Label className="text-sm">Supply Voltage (V)</Label>
        <div className="flex gap-2 mt-1">
          {["230", "240", "400", "415"].map((v) => (
            <Badge
              key={v}
              variant={voltage === v ? "default" : "outline"}
              className="cursor-pointer px-3 py-1.5 text-sm"
              onClick={() => { setVoltage(v); setResult(null); }}
            >
              {v}V
            </Badge>
          ))}
        </div>
      </div>
    </ToolLayout>
  );
};

export default VoltageDropTool;
