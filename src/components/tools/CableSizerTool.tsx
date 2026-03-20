import { useState, useMemo } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import ToolLayout from "./ToolLayout";
import ResultRow from "./ResultRow";
import {
  SystemType, PhaseType, CableMaterial,
  CABLE_TYPES, CURRENT_CAPACITY, MV_PER_AM,
  INSTALL_METHODS, AC_VOLTAGES, DC_VOLTAGES,
  getTempDerating, getGroupingDerating, getMvKey,
  getCapacityKey, getAvailableSizes,
  TEMP_DERATING_PVC, TEMP_DERATING_XLPE,
} from "./electricalData";

interface SizerResult {
  recommendedSize: string;
  deratedCapacity: number;
  vdPercent: number;
  vdVolts: number;
  alternativeSize: string | null;
  totalDerating: number;
  warnings: string[];
  suggestions: string[];
}

interface Props { onBack: () => void }

const CableSizerTool = ({ onBack }: Props) => {
  const [system, setSystem] = useState<SystemType>("ac");
  const [phase, setPhase] = useState<PhaseType>("single");
  const [material, setMaterial] = useState<CableMaterial>("copper");
  const [cableType, setCableType] = useState("flat-tps-v75");
  const [loadMode, setLoadMode] = useState<"amps" | "kw">("amps");
  const [loadValue, setLoadValue] = useState("");
  const [length, setLength] = useState("");
  const [voltage, setVoltage] = useState("230");
  const [maxVdPercent, setMaxVdPercent] = useState("5");
  const [powerFactor, setPowerFactor] = useState("1.0");
  const [ambientTemp, setAmbientTemp] = useState("35");
  const [installMethod, setInstallMethod] = useState("clipped-direct");
  const [circuits, setCircuits] = useState("1");
  const [result, setResult] = useState<SizerResult | null>(null);

  const ct = CABLE_TYPES[cableType];
  const availableSizes = useMemo(() => getAvailableSizes(cableType, material), [cableType, material]);
  const voltageOptions = system === "ac" ? AC_VOLTAGES : DC_VOLTAGES;
  const tempTable = ct?.maxTemp === 75 ? TEMP_DERATING_PVC : TEMP_DERATING_XLPE;

  const availableCableTypes = useMemo(() =>
    Object.entries(CABLE_TYPES).filter(([, v]) => v.materials.includes(material)),
    [material]
  );

  const handleSystemChange = (val: SystemType) => {
    setSystem(val);
    setVoltage(val === "dc" ? "24" : phase === "three" ? "400" : "230");
    setResult(null);
  };

  const handleMaterialChange = (val: CableMaterial) => {
    setMaterial(val);
    const types = Object.entries(CABLE_TYPES).filter(([, v]) => v.materials.includes(val));
    if (!types.find(([k]) => k === cableType)) setCableType(types[0]?.[0] || "xlpe");
    setResult(null);
  };

  const handleCableTypeChange = (val: string) => {
    setCableType(val);
    setResult(null);
  };

  const handlePhaseChange = (val: PhaseType) => {
    setPhase(val);
    setVoltage(val === "three" ? "400" : "230");
    setResult(null);
  };

  const calculate = () => {
    const V = parseFloat(voltage);
    const L = parseFloat(length);
    const pf = system === "ac" ? (parseFloat(powerFactor) || 1.0) : 1.0;
    const maxVd = parseFloat(maxVdPercent);
    let I = parseFloat(loadValue);
    if (isNaN(V) || isNaN(L) || isNaN(I) || V <= 0 || L <= 0 || I <= 0) return;

    if (loadMode === "kw") {
      I = system === "ac" && phase === "three"
        ? (I * 1000) / (Math.sqrt(3) * V * pf)
        : (I * 1000) / (V * pf);
    }

    const insulation = ct?.insulation || "PVC";
    const tempFactor = getTempDerating(insulation, ambientTemp);
    const installFactor = INSTALL_METHODS[installMethod]?.factor || 1.0;
    const groupFactor = getGroupingDerating(parseInt(circuits) || 1);
    const totalDerating = tempFactor * installFactor * groupFactor;

    const mvKey = getMvKey(material, system, phase);
    const mvTable = MV_PER_AM[mvKey] || {};
    const capKey = getCapacityKey(cableType, material);
    const capTable = CURRENT_CAPACITY[capKey] || {};

    const warnings: string[] = [];
    const suggestions: string[] = [];
    let recommended: string | null = null;
    let deratedCap = 0;
    let vdP = 0;
    let vdV = 0;

    for (const size of availableSizes) {
      const baseCap = capTable[size];
      const mv = mvTable[size];
      if (!baseCap || !mv) continue;
      const derated = baseCap * totalDerating;
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
      warnings.push("No standard cable size meets both current capacity and voltage drop requirements.");
      suggestions.push("Consider shorter cable runs, parallel cables, or a different cable type.");
      if (material === "copper" && cableType === "flat-tps-v75") {
        suggestions.push("Try XLPE cable — higher current capacity for the same size.");
      }
      // Show the result with the largest available size
      const lastSize = availableSizes[availableSizes.length - 1];
      const lastMv = mvTable[lastSize];
      const lastCap = capTable[lastSize];
      if (lastMv && lastCap) {
        setResult({
          recommendedSize: `>${lastSize}`,
          deratedCapacity: Math.round((lastCap || 0) * totalDerating),
          vdPercent: Math.round(((lastMv * I * L) / 1000 / V) * 100 * 100) / 100,
          vdVolts: Math.round((lastMv * I * L) / 1000 * 100) / 100,
          alternativeSize: null,
          totalDerating: Math.round(totalDerating * 100) / 100,
          warnings,
          suggestions,
        });
      }
      return;
    }

    const recIdx = availableSizes.indexOf(recommended);
    const alternativeSize = recIdx < availableSizes.length - 1 ? availableSizes[recIdx + 1] : null;

    if (vdP > 3 && vdP <= maxVd) warnings.push("Voltage drop above 3% — check sub-circuit allowance.");
    if (totalDerating < 0.6) warnings.push("Heavy derating applied — verify installation conditions carefully.");

    if (cableType === "flat-tps-v75" && I > 40) {
      suggestions.push("Consider XLPE cable for loads above 40A — better thermal performance.");
    }

    setResult({
      recommendedSize: recommended,
      deratedCapacity: deratedCap,
      vdPercent: vdP,
      vdVolts: vdV,
      alternativeSize,
      totalDerating: Math.round(totalDerating * 100) / 100,
      warnings,
      suggestions,
    });
  };

  return (
    <ToolLayout
      title="Cable Sizer"
      subtitle="Auto-select the right cable for your load, run & conditions"
      disclaimer="Based on AS/NZS 3008.1.1 current capacity and mV/A/m tables. Derating per Tables 22-27. Always verify with the full standard for critical installations."
      onBack={onBack}
      onCalculate={calculate}
      result={result ? (
        <>
          <div className={`p-3 rounded-lg mb-3 border ${
            !result.warnings.length ? "bg-primary/5 border-primary/20" : "bg-destructive/5 border-destructive/20"
          }`}>
            <p className="text-3xl font-extrabold text-primary">{result.recommendedSize} mm²</p>
            <p className="text-xs text-muted-foreground mt-1">
              {ct?.label} {material} • {system === "dc" ? "DC" : phase === "three" ? "3Ø" : "1Ø"} {voltage}V
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
          <div className="mt-2">
            <ResultRow label="Total derating factor" value={result.totalDerating} size="sm" />
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
          {system === "ac" && (
            <div>
              <Label className="text-sm">Power Factor</Label>
              <Select value={powerFactor} onValueChange={setPowerFactor}>
                <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1.0">1.0 — Resistive</SelectItem>
                  <SelectItem value="0.95">0.95 — Mixed loads</SelectItem>
                  <SelectItem value="0.9">0.9 — Motors</SelectItem>
                  <SelectItem value="0.85">0.85 — Heavy motors</SelectItem>
                  <SelectItem value="0.8">0.8 — Poor PF</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label className="text-sm">Ambient Temperature</Label>
            <Select value={ambientTemp} onValueChange={(v) => { setAmbientTemp(v); setResult(null); }}>
              <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(tempTable).map(([t, f]) => (
                  <SelectItem key={t} value={t}>{t}°C {f !== 1.0 ? `(×${f})` : "(ref)"}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-sm">Installation Method</Label>
            <Select value={installMethod} onValueChange={(v) => { setInstallMethod(v); setResult(null); }}>
              <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(INSTALL_METHODS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label} (×{v.factor})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-sm">Grouped Circuits</Label>
            <Select value={circuits} onValueChange={(v) => { setCircuits(v); setResult(null); }}>
              <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1,2,3,4,5,6,7,8,9].map(n => (
                  <SelectItem key={n} value={String(n)}>
                    {n} circuit{n > 1 ? "s" : ""} {n > 1 ? `(×${getGroupingDerating(n)})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      }
    >
      {/* System Type */}
      <div>
        <Label className="text-sm font-bold">System Type</Label>
        <div className="flex gap-2 mt-1">
          {(["ac", "dc"] as const).map(s => (
            <Badge key={s} variant={system === s ? "default" : "outline"}
              className="cursor-pointer px-4 py-2 text-sm font-bold"
              onClick={() => handleSystemChange(s)}>
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
                onClick={() => handlePhaseChange(k as PhaseType)}>
                {l}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-sm">Material</Label>
          <Select value={material} onValueChange={(v) => handleMaterialChange(v as CableMaterial)}>
            <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="copper">Copper</SelectItem>
              <SelectItem value="aluminium">Aluminium</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-sm">Cable Type</Label>
          <Select value={cableType} onValueChange={handleCableTypeChange}>
            <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {availableCableTypes.map(([k, v]) => (
                <SelectItem key={k} value={k}>{v.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label className="text-sm">Load</Label>
        <div className="flex gap-2 mt-1">
          <Input type="number" inputMode="decimal" className="h-11 flex-1"
            placeholder={loadMode === "amps" ? "e.g. 32" : "e.g. 7.4"}
            value={loadValue} onChange={(e) => setLoadValue(e.target.value)} />
          <div className="flex">
            {(["amps", "kw"] as const).map(m => (
              <Badge key={m} variant={loadMode === m ? "default" : "outline"}
                className="cursor-pointer px-3 py-1.5 text-sm rounded-none first:rounded-l-md last:rounded-r-md"
                onClick={() => { setLoadMode(m); setResult(null); }}>
                {m === "amps" ? "A" : "kW"}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      <div>
        <Label className="text-sm">Cable Run (m)</Label>
        <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="e.g. 45"
          value={length} onChange={(e) => setLength(e.target.value)} />
        <p className="text-[10px] text-muted-foreground mt-0.5">One-way length</p>
      </div>

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
    </ToolLayout>
  );
};

export default CableSizerTool;
