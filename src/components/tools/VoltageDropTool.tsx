import { useState, useMemo } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import ToolLayout from "./ToolLayout";
import ResultRow from "./ResultRow";
import WorkingTable, { WorkingStep } from "./WorkingTable";
import AddToProjectModal from "./AddToProjectModal";
import { saveCalculationToProject } from "./projectUtils";
import {
  SystemType, PhaseType, CableMaterial,
  CABLE_TYPES, CURRENT_CAPACITY,
  INSTALL_METHODS, AC_VOLTAGES, DC_VOLTAGES,
  getTempDerating, getGroupingDerating, mvPerAm, conductorTempFor,
  getCapacityKey, getAvailableSizes,
  TEMP_DERATING_PVC, TEMP_DERATING_XLPE,
} from "./electricalData";

interface VdResult {
  vdVolts: number;
  vdPercent: number;
  deratedCapacity: number | null;
  capacityOk: boolean;
  recommendedSize: string | null;
  totalDerating: number;
  warnings: string[];
  suggestions: string[];
  // Kept for the "show the working" breakdown — not shown in the main result UI
  designCurrent: number;
  loadConverted: boolean;
  mvUsed: number;
  tempFactor: number;
  installFactor: number;
  groupFactor: number;
  baseCapacityUsed: number | null;
}

interface Props { onBack: () => void }

const VoltageDropTool = ({ onBack }: Props) => {
  const [system, setSystem] = useState<SystemType>("ac");
  const [phase, setPhase] = useState<PhaseType>("single");
  const [material, setMaterial] = useState<CableMaterial>("copper");
  const [cableType, setCableType] = useState("flat-tps-v75");
  const [cableSize, setCableSize] = useState("2.5");
  const [loadMode, setLoadMode] = useState<"amps" | "kw">("amps");
  const [loadValue, setLoadValue] = useState("");
  const [length, setLength] = useState("");
  const [voltage, setVoltage] = useState("230");
  const [powerFactor, setPowerFactor] = useState("1.0");
  const [ambientTemp, setAmbientTemp] = useState("35");
  const [installMethod, setInstallMethod] = useState("clipped-direct");
  const [circuits, setCircuits] = useState("1");
  const [result, setResult] = useState<VdResult | null>(null);
  const [showProjectModal, setShowProjectModal] = useState(false);

  const ct = CABLE_TYPES[cableType];
  const availableSizes = useMemo(() => getAvailableSizes(cableType, material), [cableType, material]);
  const voltageOptions = system === "ac" ? AC_VOLTAGES : DC_VOLTAGES;
  const tempTable = ct?.maxTemp === 75 ? TEMP_DERATING_PVC : TEMP_DERATING_XLPE;

  // Available cable types for the selected material
  const availableCableTypes = useMemo(() =>
    Object.entries(CABLE_TYPES).filter(([, v]) => v.materials.includes(material)),
    [material]
  );

  // Sync cable size when sizes change
  const syncSize = (sizes: string[]) => {
    if (!sizes.includes(cableSize)) setCableSize(sizes[0] || "2.5");
  };

  const handleSystemChange = (val: SystemType) => {
    setSystem(val);
    setVoltage(val === "dc" ? "24" : phase === "three" ? "400" : "230");
    setResult(null);
  };

  const handleMaterialChange = (val: CableMaterial) => {
    setMaterial(val);
    const types = Object.entries(CABLE_TYPES).filter(([, v]) => v.materials.includes(val));
    if (!types.find(([k]) => k === cableType)) {
      setCableType(types[0]?.[0] || "xlpe");
    }
    setResult(null);
  };

  const handleCableTypeChange = (val: string) => {
    setCableType(val);
    const sizes = getAvailableSizes(val, material);
    syncSize(sizes);
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
    let I = parseFloat(loadValue);

    if (isNaN(V) || isNaN(L) || isNaN(I) || V <= 0 || L <= 0 || I <= 0) return;

    // Convert kW to amps if needed
    const loadConverted = loadMode === "kw";
    if (loadConverted) {
      if (system === "ac" && phase === "three") {
        I = (I * 1000) / (Math.sqrt(3) * V * pf);
      } else {
        I = (I * 1000) / (V * pf);
      }
    }
    const designCurrent = Math.round(I * 100) / 100;

    const conductorTemp = conductorTempFor(ct?.maxTemp);
    const mv = mvPerAm(material, cableSize, system, phase, conductorTemp, pf, cableType);
    if (!mv) return;

    const vdVolts = (mv * I * L) / 1000;
    const vdPercent = (vdVolts / V) * 100;

    // Derating
    const insulation = ct?.insulation || "PVC";
    const tempFactor = getTempDerating(insulation, ambientTemp);
    const installFactor = INSTALL_METHODS[installMethod]?.factor || 1.0;
    const groupFactor = getGroupingDerating(parseInt(circuits) || 1);
    const totalDerating = tempFactor * installFactor * groupFactor;

    const capKey = getCapacityKey(cableType, material);
    const baseCapacity = CURRENT_CAPACITY[capKey]?.[cableSize] || null;
    const deratedCapacity = baseCapacity ? Math.round(baseCapacity * totalDerating) : null;
    const capacityOk = deratedCapacity ? I <= deratedCapacity : true;

    const warnings: string[] = [];
    const suggestions: string[] = [];

    if (vdPercent > 5) warnings.push("Exceeds AS/NZS 3000 maximum 5% voltage drop.");
    if (installMethod === "buried-direct" || installMethod === "buried-conduit") {
      warnings.push("Buried capacity shown is a guide — AS/NZS 3008 rates buried cables from separate soil-based tables. Verify against the buried tables or ask the AI chat.");
    }
    if (vdPercent > 3 && vdPercent <= 5) warnings.push("Above 3% — check sub-circuit allowance remains.");
    if (!capacityOk && deratedCapacity) warnings.push(`Load ${Math.round(I)}A exceeds derated capacity of ${deratedCapacity}A.`);

    // Recommendation
    let recommendedSize: string | null = null;
    if (vdPercent > 5 || !capacityOk) {
      for (const size of availableSizes) {
        const testMv = mvPerAm(material, size, system, phase, conductorTemp, pf, cableType);
        if (!testMv) continue;
        const testVd = ((testMv * I * L) / 1000 / V) * 100;
        const testCap = CURRENT_CAPACITY[getCapacityKey(cableType, material)]?.[size];
        const testDerated = testCap ? testCap * totalDerating : Infinity;
        if (testVd <= 5 && I <= testDerated) {
          recommendedSize = size;
          break;
        }
      }
      if (recommendedSize) {
        suggestions.push(`Increase cable to ${recommendedSize} mm² to meet requirements.`);
      } else {
        suggestions.push("No single cable meets requirements — consider parallel runs or shorter route.");
      }
    }

    if (vdPercent > 5 && installMethod !== "free-air") {
      suggestions.push("Consider free-air installation for higher current capacity.");
    }
    if (!capacityOk && parseInt(circuits) > 1) {
      suggestions.push("Reduce cable grouping to improve current capacity.");
    }

    setResult({
      vdVolts: Math.round(vdVolts * 100) / 100,
      vdPercent: Math.round(vdPercent * 100) / 100,
      deratedCapacity,
      capacityOk,
      recommendedSize,
      totalDerating: Math.round(totalDerating * 100) / 100,
      warnings,
      suggestions,
      designCurrent,
      loadConverted,
      mvUsed: mv,
      tempFactor: Math.round(tempFactor * 100) / 100,
      installFactor: Math.round(installFactor * 100) / 100,
      groupFactor: Math.round(groupFactor * 100) / 100,
      baseCapacityUsed: baseCapacity,
    });
  };

  const workingSteps: WorkingStep[] = result ? [
    ...(result.loadConverted ? [{
      label: "Convert load to design current",
      working: system === "ac" && phase === "three"
        ? `(${loadValue} × 1000) ÷ (√3 × ${voltage} V × ${powerFactor} pf)`
        : `(${loadValue} × 1000) ÷ (${voltage} V × ${powerFactor} pf)`,
      result: `${result.designCurrent} A`,
      reference: "P = √3×V×I×pf (3Ø) or P = V×I×pf (1Ø)",
    }] : []),
    {
      label: "Voltage drop",
      working: `(${result.mvUsed} mV/A·m × ${result.designCurrent} A × ${length} m) ÷ 1000`,
      result: `${result.vdVolts} V`,
      reference: `AS/NZS 3008.1.1 Tables 30, 34-35 — ${cableSize} mm² ${material}`,
    },
    {
      label: "Voltage drop % check",
      working: `${result.vdVolts} V ÷ ${voltage} V × 100`,
      result: `${result.vdPercent}% vs 5% max`,
      reference: "AS/NZS 3000 max 5% voltage drop",
    },
    ...(result.baseCapacityUsed !== null ? [{
      label: "Combined derating factor",
      working: `${result.tempFactor} (${ambientTemp}°C) × ${result.installFactor} (${INSTALL_METHODS[installMethod]?.label}) × ${result.groupFactor} (${circuits} circuit${circuits !== "1" ? "s" : ""})`,
      result: `×${result.totalDerating}`,
      reference: "AS/NZS 3008.1.1 Tables 22-27",
    }, {
      label: "Derated current capacity check",
      working: `${result.baseCapacityUsed} A (table) × ${result.totalDerating}`,
      result: `${result.deratedCapacity} A ${result.capacityOk ? "≥" : "<"} ${result.designCurrent} A required`,
      reference: `AS/NZS 3008.1.1 current capacity — ${cableSize} mm²`,
    }] : []),
  ] : [];

  return (
    <ToolLayout
      title="Voltage Drop Calculator"
      subtitle="Per AS/NZS 3008.1.1 — Full cable analysis with derating"
      disclaimer="Based on AS/NZS 3008.1.1 current capacity tables and resistance/reactance from Tables 30, 34-35. Derating factors are per Tables 22-27. Always verify with the full standard and manufacturer data for critical installations."
      onBack={onBack}
      onCalculate={calculate}
      verifyQuestion={result
        ? `Is a ${cableSize} mm² ${material} ${ct?.label ?? ""} cable compliant for a ${loadValue}${loadMode === "kw" ? " kW" : " A"} load over a ${length} m run at ${voltage} V ${system === "dc" ? "DC" : phase === "three" ? "three phase" : "single phase"}? Check voltage drop and current capacity.`
        : undefined}
      result={result ? (
        <>
          {/* Pass/Fail Header */}
          <div className={`p-3 rounded-lg mb-3 border ${
            result.vdPercent <= 5 && result.capacityOk
              ? "bg-primary/5 border-primary/20"
              : "bg-destructive/5 border-destructive/20"
          }`}>
            <p className={`text-sm font-extrabold ${
              result.vdPercent <= 5 && result.capacityOk ? "text-primary" : "text-destructive"
            }`}>
              {result.vdPercent <= 5 && result.capacityOk ? "✅ COMPLIANT" : "❌ NON-COMPLIANT"}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {cableSize} mm² {ct?.label} {material} • {system === "dc" ? "DC" : phase === "three" ? "3Ø" : "1Ø"} {voltage}V
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-3">
            <ResultRow label="Voltage Drop" value={result.vdVolts} unit="V" />
            <ResultRow
              label="Drop %"
              value={result.vdPercent}
              unit="%"
              variant={result.vdPercent > 5 ? "destructive" : result.vdPercent > 3 ? "warning" : "primary"}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            {result.deratedCapacity && (
              <ResultRow label="Derated capacity" value={result.deratedCapacity} unit="A"
                variant={result.capacityOk ? "default" : "destructive"} size="sm" />
            )}
            <ResultRow label="Total derating" value={result.totalDerating} size="sm" />
          </div>

          {result.recommendedSize && (
            <div className="mt-3 p-2.5 rounded-lg bg-primary/5 border border-primary/20">
              <p className="text-xs font-bold text-primary">💡 Recommended: {result.recommendedSize} mm²</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Smallest compliant size for this run</p>
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

          {/* Add to Project Button */}
          <Button
            onClick={() => setShowProjectModal(true)}
            variant="outline"
            className="w-full mt-4"
          >
            Add to Project
          </Button>
        </>
      ) : undefined}
      advancedInputs={
        <>
          {system === "ac" && (
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
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {INSTALL_METHODS[installMethod]?.description}
            </p>
          </div>
          <div>
            <Label className="text-sm">Grouped Circuits</Label>
            <Select value={circuits} onValueChange={(v) => { setCircuits(v); setResult(null); }}>
              <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1,2,3,4,5,6,7,8,9].map(n => (
                  <SelectItem key={n} value={String(n)}>
                    {n} circuit{n > 1 ? "s" : ""} {n > 1 ? `(×${getGroupingDerating(n)})` : "(no derating)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      }
    >
      {/* System Type - AC/DC */}
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

      {/* Phase (AC only) */}
      {system === "ac" && (
        <div>
          <Label className="text-sm">Phase</Label>
          <div className="flex gap-2 mt-1">
            {([["single", "Single Phase (1Ø)"], ["three", "Three Phase (3Ø)"]] as const).map(([k, l]) => (
              <Badge key={k} variant={phase === k ? "default" : "outline"}
                className="cursor-pointer px-3 py-1.5 text-sm"
                onClick={() => handlePhaseChange(k as PhaseType)}>
                {l}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Cable Specification */}
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
        <Label className="text-sm">Cable Size (mm²)</Label>
        <Select value={cableSize} onValueChange={(v) => { setCableSize(v); setResult(null); }}>
          <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {availableSizes.map(s => (
              <SelectItem key={s} value={s}>{s} mm²</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          {ct?.insulation} — max {ct?.maxTemp}°C
        </p>
      </div>

      {/* Load Input */}
      <div>
        <Label className="text-sm">Load</Label>
        <div className="flex gap-2 mt-1">
          <Input type="number" inputMode="decimal" className="h-11 flex-1"
            placeholder={loadMode === "amps" ? "e.g. 20" : "e.g. 4.6"}
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

      {/* Length */}
      <div>
        <Label className="text-sm">Cable Run (m)</Label>
        <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="e.g. 30"
          value={length} onChange={(e) => setLength(e.target.value)} />
        <p className="text-[10px] text-muted-foreground mt-0.5">One-way distance</p>
      </div>

      {/* Voltage */}
      <div>
        <Label className="text-sm">Supply Voltage (V)</Label>
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

      {/* Add to Project Modal */}
      <AddToProjectModal
        isOpen={showProjectModal}
        onClose={() => setShowProjectModal(false)}
        onSave={(projectId, projectName, calcLabel) => {
          saveCalculationToProject(
            projectId,
            projectName,
            "voltage-drop",
            "Voltage Drop",
            {
              system,
              phase,
              material,
              cableType,
              cableSize,
              loadMode,
              loadValue,
              length,
              voltage,
              powerFactor,
              ambientTemp,
              installMethod,
              circuits,
            },
            result,
            `${cableSize} mm² ${material} — ${loadValue}${loadMode === "kw" ? " kW" : " A"} over ${length} m: ${result?.vdPercent.toFixed(2)}% VD`,
            calcLabel
          );
          setShowProjectModal(false);
        }}
        calculationSummary={`Voltage Drop: ${result?.vdPercent.toFixed(2)}% (${result?.vdVolts.toFixed(2)}V)`}
      />
    </ToolLayout>
  );
};

export default VoltageDropTool;
