import { useState } from "react";
import { Calculator, Zap, Construction, Droplets, ChevronRight, ArrowLeft } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type ToolMode = "menu" | "voltage-drop" | "concrete-volume" | "pipe-sizing";

// ── VERIFIED FORMULAS ──

// Voltage drop per AS/NZS 3008.1.1
// Vd = (mV/A/m × I × L) / 1000
// mV/A/m values from AS/NZS 3008.1.1 Table 40 (copper, PVC, single-phase)
const CABLE_MV_PER_AM: Record<string, number> = {
  "1": 44.0,
  "1.5": 29.0,
  "2.5": 18.0,
  "4": 11.0,
  "6": 7.3,
  "10": 4.4,
  "16": 2.8,
  "25": 1.75,
  "35": 1.25,
  "50": 0.93,
  "70": 0.63,
  "95": 0.47,
  "120": 0.37,
  "150": 0.30,
  "185": 0.25,
  "240": 0.19,
};

function calcVoltageDrop(cableSize: string, current: number, length: number, voltage: number) {
  const mvPerAm = CABLE_MV_PER_AM[cableSize];
  if (!mvPerAm) return null;
  const vdVolts = (mvPerAm * current * length) / 1000;
  const vdPercent = (vdVolts / voltage) * 100;
  return { vdVolts: Math.round(vdVolts * 100) / 100, vdPercent: Math.round(vdPercent * 100) / 100 };
}

// Concrete volume: V = L × W × D (all in metres), output in m³
function calcConcreteVolume(length: number, width: number, depth: number) {
  const volumeM3 = length * width * depth;
  // Add 10% waste factor
  const withWaste = volumeM3 * 1.1;
  return {
    volumeM3: Math.round(volumeM3 * 1000) / 1000,
    withWasteM3: Math.round(withWaste * 1000) / 1000,
    bags20kg: Math.ceil(withWaste / 0.009), // ~0.009m³ per 20kg bag
  };
}

// Pipe sizing: Q = v × A, where A = π(d/2)²
// v = velocity (m/s), d = internal diameter (m)
// Rearranged: d = sqrt(4Q / πv)
const PIPE_SIZES_MM = [15, 20, 25, 32, 40, 50, 65, 80, 100, 150, 200];

function calcPipeSize(flowRateLps: number, maxVelocity: number) {
  // d = sqrt(4Q / πv) — Q in m³/s
  const flowM3s = flowRateLps / 1000;
  const minDiameterM = Math.sqrt((4 * flowM3s) / (Math.PI * maxVelocity));
  const minDiameterMm = minDiameterM * 1000;

  // Find next standard pipe size
  const recommended = PIPE_SIZES_MM.find((s) => s >= minDiameterMm) || PIPE_SIZES_MM[PIPE_SIZES_MM.length - 1];
  const actualVelocity = flowM3s / (Math.PI * Math.pow(recommended / 2000, 2));

  return {
    minDiameterMm: Math.round(minDiameterMm * 10) / 10,
    recommendedMm: recommended,
    actualVelocity: Math.round(actualVelocity * 100) / 100,
  };
}

const Tools = () => {
  const [mode, setMode] = useState<ToolMode>("menu");

  // Voltage drop state
  const [vdCableSize, setVdCableSize] = useState("2.5");
  const [vdCurrent, setVdCurrent] = useState("");
  const [vdLength, setVdLength] = useState("");
  const [vdVoltage, setVdVoltage] = useState("230");
  const [vdResult, setVdResult] = useState<ReturnType<typeof calcVoltageDrop>>(null);

  // Concrete state
  const [conLength, setConLength] = useState("");
  const [conWidth, setConWidth] = useState("");
  const [conDepth, setConDepth] = useState("");
  const [conResult, setConResult] = useState<ReturnType<typeof calcConcreteVolume> | null>(null);

  // Pipe state
  const [pipeFlow, setPipeFlow] = useState("");
  const [pipeVelocity, setPipeVelocity] = useState("1.5");
  const [pipeResult, setPipeResult] = useState<ReturnType<typeof calcPipeSize> | null>(null);

  const runVoltageDrop = () => {
    const c = parseFloat(vdCurrent);
    const l = parseFloat(vdLength);
    const v = parseFloat(vdVoltage);
    if (isNaN(c) || isNaN(l) || isNaN(v) || c <= 0 || l <= 0 || v <= 0) return;
    setVdResult(calcVoltageDrop(vdCableSize, c, l, v));
  };

  const runConcrete = () => {
    const l = parseFloat(conLength);
    const w = parseFloat(conWidth);
    const d = parseFloat(conDepth);
    if (isNaN(l) || isNaN(w) || isNaN(d) || l <= 0 || w <= 0 || d <= 0) return;
    setConResult(calcConcreteVolume(l, w, d));
  };

  const runPipe = () => {
    const f = parseFloat(pipeFlow);
    const v = parseFloat(pipeVelocity);
    if (isNaN(f) || isNaN(v) || f <= 0 || v <= 0) return;
    setPipeResult(calcPipeSize(f, v));
  };

  if (mode === "menu") {
    return (
      <div className="px-5 py-6 pb-24 max-w-md mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Calculator className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="font-display text-xl font-extrabold text-foreground">Trade Tools</h1>
            <p className="text-sm text-muted-foreground">Free local calculators — no AI needed</p>
          </div>
        </div>

        <div className="space-y-3">
          <Card className="p-4 cursor-pointer hover:border-primary/50 transition-colors" onClick={() => setMode("voltage-drop")}>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-yellow-500/10 flex items-center justify-center flex-shrink-0">
                <Zap className="h-5 w-5 text-yellow-600" />
              </div>
              <div className="flex-1">
                <p className="font-bold text-foreground text-sm">Voltage Drop Calculator</p>
                <p className="text-xs text-muted-foreground">AS/NZS 3008.1.1 — copper PVC cables</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </div>
          </Card>

          <Card className="p-4 cursor-pointer hover:border-primary/50 transition-colors" onClick={() => setMode("concrete-volume")}>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-orange-500/10 flex items-center justify-center flex-shrink-0">
                <Construction className="h-5 w-5 text-orange-600" />
              </div>
              <div className="flex-1">
                <p className="font-bold text-foreground text-sm">Concrete Volume Calculator</p>
                <p className="text-xs text-muted-foreground">Slabs, footings & pads — with 10% waste</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </div>
          </Card>

          <Card className="p-4 cursor-pointer hover:border-primary/50 transition-colors" onClick={() => setMode("pipe-sizing")}>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                <Droplets className="h-5 w-5 text-blue-600" />
              </div>
              <div className="flex-1">
                <p className="font-bold text-foreground text-sm">Pipe Sizing Calculator</p>
                <p className="text-xs text-muted-foreground">Flow rate to recommended pipe diameter</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </div>
          </Card>
        </div>

        <p className="text-xs text-muted-foreground text-center mt-6">
          All calculations are 100% local — no tokens used.
        </p>
      </div>
    );
  }

  // ── VOLTAGE DROP ──
  if (mode === "voltage-drop") {
    return (
      <div className="px-5 py-6 pb-24 max-w-md mx-auto">
        <button onClick={() => { setMode("menu"); setVdResult(null); }} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <h2 className="font-display text-lg font-extrabold text-foreground mb-1">Voltage Drop Calculator</h2>
        <p className="text-xs text-muted-foreground mb-5">Per AS/NZS 3008.1.1 — Copper, PVC, single-phase</p>

        <div className="space-y-4">
          <div>
            <Label className="text-sm">Cable Size (mm²)</Label>
            <Select value={vdCableSize} onValueChange={setVdCableSize}>
              <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.keys(CABLE_MV_PER_AM).map((s) => (
                  <SelectItem key={s} value={s}>{s} mm²</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-sm">Current (A)</Label>
            <Input type="number" className="h-11 mt-1" placeholder="e.g. 20" value={vdCurrent} onChange={(e) => setVdCurrent(e.target.value)} />
          </div>
          <div>
            <Label className="text-sm">Cable Length (m) — one way</Label>
            <Input type="number" className="h-11 mt-1" placeholder="e.g. 30" value={vdLength} onChange={(e) => setVdLength(e.target.value)} />
          </div>
          <div>
            <Label className="text-sm">Supply Voltage (V)</Label>
            <Input type="number" className="h-11 mt-1" value={vdVoltage} onChange={(e) => setVdVoltage(e.target.value)} />
          </div>
          <Button onClick={runVoltageDrop} className="w-full h-12 font-bold rounded-xl">Calculate</Button>
        </div>

        {vdResult && (
          <Card className="mt-5 p-4">
            <p className="text-sm font-bold text-foreground mb-2">Result</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-2xl font-extrabold text-foreground">{vdResult.vdVolts}V</p>
                <p className="text-xs text-muted-foreground">Voltage Drop</p>
              </div>
              <div>
                <p className={`text-2xl font-extrabold ${vdResult.vdPercent > 5 ? "text-destructive" : "text-primary"}`}>{vdResult.vdPercent}%</p>
                <p className="text-xs text-muted-foreground">of supply ({vdResult.vdPercent > 5 ? "exceeds 5% limit" : "within 5% limit"})</p>
              </div>
            </div>
            {vdResult.vdPercent > 5 && (
              <p className="text-xs text-destructive mt-3 font-medium">⚠️ Exceeds AS/NZS 3000 maximum 5% voltage drop. Consider a larger cable size.</p>
            )}
          </Card>
        )}

        <p className="text-[10px] text-muted-foreground mt-4">
          Based on AS/NZS 3008.1.1 Table 40 (copper, PVC, single-phase). Values are approximate — always verify with the full standard.
        </p>
      </div>
    );
  }

  // ── CONCRETE VOLUME ──
  if (mode === "concrete-volume") {
    return (
      <div className="px-5 py-6 pb-24 max-w-md mx-auto">
        <button onClick={() => { setMode("menu"); setConResult(null); }} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <h2 className="font-display text-lg font-extrabold text-foreground mb-1">Concrete Volume Calculator</h2>
        <p className="text-xs text-muted-foreground mb-5">Rectangular slabs, footings & pads</p>

        <div className="space-y-4">
          <div>
            <Label className="text-sm">Length (m)</Label>
            <Input type="number" className="h-11 mt-1" placeholder="e.g. 6" value={conLength} onChange={(e) => setConLength(e.target.value)} />
          </div>
          <div>
            <Label className="text-sm">Width (m)</Label>
            <Input type="number" className="h-11 mt-1" placeholder="e.g. 4" value={conWidth} onChange={(e) => setConWidth(e.target.value)} />
          </div>
          <div>
            <Label className="text-sm">Depth (m)</Label>
            <Input type="number" className="h-11 mt-1" placeholder="e.g. 0.1" value={conDepth} onChange={(e) => setConDepth(e.target.value)} />
          </div>
          <Button onClick={runConcrete} className="w-full h-12 font-bold rounded-xl">Calculate</Button>
        </div>

        {conResult && (
          <Card className="mt-5 p-4">
            <p className="text-sm font-bold text-foreground mb-2">Result</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-2xl font-extrabold text-foreground">{conResult.volumeM3}</p>
                <p className="text-xs text-muted-foreground">m³ exact</p>
              </div>
              <div>
                <p className="text-2xl font-extrabold text-primary">{conResult.withWasteM3}</p>
                <p className="text-xs text-muted-foreground">m³ +10% waste</p>
              </div>
              <div>
                <p className="text-2xl font-extrabold text-foreground">{conResult.bags20kg}</p>
                <p className="text-xs text-muted-foreground">× 20kg bags</p>
              </div>
            </div>
          </Card>
        )}

        <p className="text-[10px] text-muted-foreground mt-4">
          Waste factor: 10%. Bag estimate based on ~0.009 m³ per 20 kg premix bag. For large pours, order ready-mix by the m³.
        </p>
      </div>
    );
  }

  // ── PIPE SIZING ──
  if (mode === "pipe-sizing") {
    return (
      <div className="px-5 py-6 pb-24 max-w-md mx-auto">
        <button onClick={() => { setMode("menu"); setPipeResult(null); }} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <h2 className="font-display text-lg font-extrabold text-foreground mb-1">Pipe Sizing Calculator</h2>
        <p className="text-xs text-muted-foreground mb-5">Flow rate → recommended pipe diameter</p>

        <div className="space-y-4">
          <div>
            <Label className="text-sm">Flow Rate (L/s)</Label>
            <Input type="number" className="h-11 mt-1" placeholder="e.g. 0.5" value={pipeFlow} onChange={(e) => setPipeFlow(e.target.value)} />
          </div>
          <div>
            <Label className="text-sm">Max Velocity (m/s)</Label>
            <Input type="number" className="h-11 mt-1" value={pipeVelocity} onChange={(e) => setPipeVelocity(e.target.value)} />
            <p className="text-[10px] text-muted-foreground mt-1">Typical: 1.5 m/s for water supply, 3.0 m/s for fire services</p>
          </div>
          <Button onClick={runPipe} className="w-full h-12 font-bold rounded-xl">Calculate</Button>
        </div>

        {pipeResult && (
          <Card className="mt-5 p-4">
            <p className="text-sm font-bold text-foreground mb-2">Result</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-2xl font-extrabold text-foreground">{pipeResult.minDiameterMm}</p>
                <p className="text-xs text-muted-foreground">mm min. ID</p>
              </div>
              <div>
                <p className="text-2xl font-extrabold text-primary">{pipeResult.recommendedMm}</p>
                <p className="text-xs text-muted-foreground">mm recommended</p>
              </div>
              <div>
                <p className="text-2xl font-extrabold text-foreground">{pipeResult.actualVelocity}</p>
                <p className="text-xs text-muted-foreground">m/s actual</p>
              </div>
            </div>
          </Card>
        )}

        <p className="text-[10px] text-muted-foreground mt-4">
          Based on Q = v × A continuity equation. Standard sizes: AS 1432 / AS 4020. Always verify with project specifications.
        </p>
      </div>
    );
  }

  return null;
};

export default Tools;
