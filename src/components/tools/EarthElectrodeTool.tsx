import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ToolLayout from "./ToolLayout";
import ResultRow from "./ResultRow";

// Typical soil resistivity ranges (midpoint values) as supplied by lead
// engineer — actual resistivity varies strongly with moisture and season;
// measure where possible.
const SOIL_TABLE: { key: string; label: string; value: number }[] = [
  { key: "moist-loam", label: "Moist loam", value: 30 },
  { key: "clay", label: "Clay", value: 40 },
  { key: "sandy-clay", label: "Sandy clay", value: 100 },
  { key: "moist-sand", label: "Moist sand", value: 200 },
  { key: "dry-sand", label: "Dry sand", value: 300 },
  { key: "gravel", label: "Gravel", value: 500 },
  { key: "rocky", label: "Rocky ground", value: 1000 },
];
const MANUAL_KEY = "manual";

const ROD_LENGTHS = [1.2, 1.5, 1.8, 2.4, 3.0, 4.8];
const ROD_DIAMETERS_MM = [12.7, 14.2, 16];
const ROD_COUNTS = [1, 2, 3, 4, 5, 6, 8, 10];

// Parallel-rod utilisation factors for spacing ≈ rod length, as supplied by
// lead engineer — approximate; closer spacing performs worse.
const UTILISATION: Record<number, number> = {
  1: 1.0,
  2: 0.58,
  3: 0.43,
  4: 0.34,
  5: 0.28,
  6: 0.24,
  8: 0.19,
  10: 0.16,
};

interface ElectrodeResult {
  r1: number;
  rTotal: number;
  epr: number | null;
  target: number | null;
  targetMet: boolean | null;
  numRods: number;
  rodLength: number;
  soilLabel: string;
  resistivity: number;
}

interface Props { onBack: () => void }

const EarthElectrodeTool = ({ onBack }: Props) => {
  const [soilKey, setSoilKey] = useState("sandy-clay");
  const [resistivity, setResistivity] = useState("100");
  const [rodLength, setRodLength] = useState("1.8");
  const [rodDiameter, setRodDiameter] = useState("12.7");
  const [numRods, setNumRods] = useState("1");
  const [faultCurrent, setFaultCurrent] = useState("");
  const [targetResistance, setTargetResistance] = useState("");
  const [result, setResult] = useState<ElectrodeResult | null>(null);

  const handleSoilChange = (key: string) => {
    setSoilKey(key);
    const soil = SOIL_TABLE.find((s) => s.key === key);
    if (soil) setResistivity(String(soil.value));
    setResult(null);
  };

  const calculate = () => {
    const rho = parseFloat(resistivity);
    const L = parseFloat(rodLength);
    const dMm = parseFloat(rodDiameter);
    const n = parseInt(numRods, 10);

    if (isNaN(rho) || rho < 1 || rho > 10000) return;
    if (isNaN(L) || L <= 0) return;
    if (isNaN(dMm) || dMm <= 0) return;
    if (isNaN(n) || !UTILISATION[n]) return;

    const d = dMm / 1000; // mm -> m
    const r1 = (rho / (2 * Math.PI * L)) * (Math.log((4 * L) / d) - 1);
    const rTotal = r1 * UTILISATION[n];

    const If = parseFloat(faultCurrent);
    const epr = !isNaN(If) && If > 0 ? If * rTotal : null;

    const target = parseFloat(targetResistance);
    const hasTarget = !isNaN(target) && target > 0;
    const targetMet = hasTarget ? rTotal <= target : null;

    const soil = SOIL_TABLE.find((s) => s.key === soilKey);
    const soilLabel = soilKey === MANUAL_KEY || !soil ? "manual entry" : soil.label;

    setResult({
      r1: Math.round(r1 * 100) / 100,
      rTotal: Math.round(rTotal * 100) / 100,
      epr: epr !== null ? Math.round(epr * 10) / 10 : null,
      target: hasTarget ? target : null,
      targetMet,
      numRods: n,
      rodLength: L,
      soilLabel,
      resistivity: rho,
    });
  };

  const eprHazard = result?.epr !== null && result?.epr !== undefined && result.epr > 50;
  const targetFailed = result?.target !== null && result?.targetMet === false;

  return (
    <ToolLayout
      title="Earth Electrode Estimator"
      subtitle="Driven-rod resistance & EPR estimate"
      disclaimer="Single-rod resistance from the standard driven-rod formula R = ρ/(2πL) × (ln(4L/d) − 1) with approximate parallel-utilisation factors for rods spaced one rod-length apart. Soil resistivity presets are indicative midpoints — real values vary by an order of magnitude with moisture, season and depth. This is a planning estimate, not a design: measure with an earth tester, and use engineered design (AS 2067) where touch/step voltages matter. Always confirm against your copy of the standard."
      onBack={onBack}
      onCalculate={calculate}
      verifyQuestion={
        result
          ? "What does AS/NZS 3000 Section 5 require for earth electrodes, and does it mandate a specific maximum earth electrode resistance value?"
          : undefined
      }
      result={result ? (
        <>
          <div className="p-3 rounded-lg mb-3 border bg-primary/5 border-primary/20">
            <p className="text-2xl font-extrabold text-primary">
              ≈ {result.rTotal.toFixed(1)} Ω
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {result.numRods} × {result.rodLength} m rod{result.numRods > 1 ? "s" : ""} in {result.soilLabel} ({result.resistivity} Ω·m)
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <ResultRow label="Combined resistance" value={result.rTotal} unit="Ω" variant="primary" />
            <ResultRow label="Single rod" value={result.r1} unit="Ω" size="sm" />
            {result.epr !== null && (
              <ResultRow
                label="Earth potential rise"
                value={result.epr}
                unit="V"
                variant={eprHazard ? "destructive" : "default"}
                size="sm"
              />
            )}
            {result.target !== null && (
              <ResultRow
                label={`Target — ${result.targetMet ? "met" : "not met"}`}
                value={result.target}
                unit="Ω"
                variant={targetFailed ? "destructive" : "default"}
                size="sm"
              />
            )}
          </div>

          <p className="text-xs text-destructive mt-3 font-medium">
            ⚠️ Estimate only — verify with an earth-resistance tester after installation. Soil resistivity changes with moisture and season.
          </p>
          {eprHazard && (
            <p className="text-xs text-destructive mt-2 font-medium">
              ⚠️ Earth potential rise exceeds 50 V under the entered fault current — prospective touch voltages may be hazardous. This installation needs engineered earthing design (AS 2067 / network operator requirements).
            </p>
          )}
          {targetFailed && (
            <p className="text-xs text-destructive mt-2 font-medium">
              ⚠️ Estimated resistance exceeds the target — add rods, use longer rods, or improve the soil (bentonite/backfill), then re-test.
            </p>
          )}
          <div className="mt-3 p-2.5 rounded-lg bg-muted">
            <p className="text-xs text-foreground">
              💡 Strips, plates and HV earth grids (touch/step voltage design) are outside this estimator — they need engineered design to AS 2067 / IEEE 80.
            </p>
          </div>
          <div className="mt-2 p-2.5 rounded-lg bg-muted">
            <p className="text-xs text-foreground">
              💡 In an MEN system the electrode supplements the MEN connection — AS/NZS 3000 does not set a universal maximum electrode resistance for LV consumer installations; targets usually come from the network operator or the job spec.
            </p>
          </div>
        </>
      ) : undefined}
      advancedInputs={
        <>
          <div>
            <Label className="text-sm">Prospective earth fault current If (A)</Label>
            <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="optional, e.g. 500"
              value={faultCurrent} onChange={(e) => { setFaultCurrent(e.target.value); setResult(null); }} />
          </div>
          <div>
            <Label className="text-sm">Target resistance (Ω)</Label>
            <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="optional, e.g. 10"
              value={targetResistance} onChange={(e) => { setTargetResistance(e.target.value); setResult(null); }} />
          </div>
        </>
      }
    >
      <p className="text-xs text-muted-foreground -mt-1">
        Scope: driven vertical rod electrodes only.
      </p>
      <div>
        <Label className="text-sm">Soil type</Label>
        <Select value={soilKey} onValueChange={handleSoilChange}>
          <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {SOIL_TABLE.map((s) => (
              <SelectItem key={s.key} value={s.key}>{s.label} (~{s.value} Ω·m)</SelectItem>
            ))}
            <SelectItem value={MANUAL_KEY}>Manual entry</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-sm">Soil resistivity ρ (Ω·m)</Label>
        <Input type="number" inputMode="decimal" className="h-11 mt-1"
          value={resistivity}
          onChange={(e) => { setResistivity(e.target.value); setSoilKey(MANUAL_KEY); setResult(null); }} />
        <p className="text-[10px] text-muted-foreground mt-0.5">Valid range 1–10000 Ω·m. Auto-filled from soil type, editable.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-sm">Rod length</Label>
          <Select value={rodLength} onValueChange={(v) => { setRodLength(v); setResult(null); }}>
            <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ROD_LENGTHS.map((l) => (
                <SelectItem key={l} value={String(l)}>{l} m</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-sm">Rod diameter</Label>
          <Select value={rodDiameter} onValueChange={(v) => { setRodDiameter(v); setResult(null); }}>
            <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ROD_DIAMETERS_MM.map((d) => (
                <SelectItem key={d} value={String(d)}>{d} mm</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <Label className="text-sm">Number of rods</Label>
        <Select value={numRods} onValueChange={(v) => { setNumRods(v); setResult(null); }}>
          <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ROD_COUNTS.map((n) => (
              <SelectItem key={n} value={String(n)}>{n} rod{n > 1 ? "s" : ""}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[10px] text-muted-foreground mt-0.5">Rods spaced at least one rod length apart</p>
      </div>
    </ToolLayout>
  );
};

export default EarthElectrodeTool;
