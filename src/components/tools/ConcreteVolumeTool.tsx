import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import ToolLayout from "./ToolLayout";
import ResultRow from "./ResultRow";

type ShapeType = "rectangular" | "circular" | "triangular";

const MIX_GRADES: Record<string, { label: string; mpa: number; use: string }> = {
  "N20": { label: "N20", mpa: 20, use: "Footpaths, blinding, non-structural" },
  "N25": { label: "N25", mpa: 25, use: "Driveways, house slabs, footings" },
  "N32": { label: "N32", mpa: 32, use: "Suspended slabs, beams, structural" },
  "N40": { label: "N40", mpa: 40, use: "High-strength structural, post-tension" },
  "N50": { label: "N50", mpa: 50, use: "Special structural applications" },
};

const REBAR_KG_PER_M3: Record<string, number> = {
  "none": 0,
  "light": 50,   // SL62 mesh ~ 3.6 kg/m²
  "standard": 100, // SL82 mesh or light bar
  "heavy": 150,   // N12/N16 bar at close centres
};

interface ConResult {
  volumeM3: number;
  withWasteM3: number;
  bags20kg: number;
  bags40kg: number;
  truckLoads: number;
  rebarKg: number;
  warnings: string[];
}

interface Props { onBack: () => void }

const ConcreteVolumeTool = ({ onBack }: Props) => {
  const [shape, setShape] = useState<ShapeType>("rectangular");
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [depth, setDepth] = useState("");
  const [diameter, setDiameter] = useState("");
  const [wasteFactor, setWasteFactor] = useState("10");
  const [mixGrade, setMixGrade] = useState("N25");
  const [rebarLevel, setRebarLevel] = useState("none");
  const [quantity, setQuantity] = useState("1");
  const [result, setResult] = useState<ConResult | null>(null);

  const calculate = () => {
    const d = parseFloat(depth);
    const qty = parseInt(quantity) || 1;
    if (isNaN(d) || d <= 0) return;

    let baseVolume = 0;
    const warnings: string[] = [];

    if (shape === "rectangular") {
      const l = parseFloat(length);
      const w = parseFloat(width);
      if (isNaN(l) || isNaN(w) || l <= 0 || w <= 0) return;
      baseVolume = l * w * d;
    } else if (shape === "circular") {
      const dia = parseFloat(diameter);
      if (isNaN(dia) || dia <= 0) return;
      baseVolume = Math.PI * Math.pow(dia / 2, 2) * d;
    } else if (shape === "triangular") {
      const l = parseFloat(length);
      const w = parseFloat(width);
      if (isNaN(l) || isNaN(w) || l <= 0 || w <= 0) return;
      baseVolume = 0.5 * l * w * d;
    }

    baseVolume *= qty;
    const waste = parseFloat(wasteFactor) / 100;
    const withWaste = baseVolume * (1 + waste);
    const bags20kg = Math.ceil(withWaste / 0.009);
    const bags40kg = Math.ceil(withWaste / 0.018);
    const truckLoads = Math.ceil(withWaste / 6); // standard agitator ~6m³
    const rebarKg = Math.round(REBAR_KG_PER_M3[rebarLevel] * withWaste);

    if (d < 0.075) warnings.push("Depth under 75mm — may not meet minimum slab thickness for AS 2870.");
    if (d > 0.3 && shape === "rectangular") warnings.push("Thick pour — consider staged pours or specialist advice.");
    if (withWaste > 2) warnings.push("Volume over 2m³ — recommend ready-mix truck delivery over bags.");
    if (withWaste > 0.5 && bags20kg > 0) warnings.push(`${bags20kg} bags is a lot of mixing — ready-mix is usually cheaper above 0.5m³.`);

    setResult({
      volumeM3: Math.round(baseVolume * 1000) / 1000,
      withWasteM3: Math.round(withWaste * 1000) / 1000,
      bags20kg,
      bags40kg,
      truckLoads,
      rebarKg,
      warnings,
    });
  };

  return (
    <ToolLayout
      title="Concrete Volume Calculator"
      subtitle="Slabs, footings, pads & columns — with waste & rebar"
      disclaimer="Waste factor is adjustable (default 10%). Ready-mix trucks typically carry 5–6 m³. Bag estimates based on 20kg (~0.009m³) and 40kg (~0.018m³) premix. Rebar estimates are approximate."
      onBack={onBack}
      onCalculate={calculate}
      result={result ? (
        <>
          <p className="text-sm font-bold text-foreground mb-3">Results</p>
          <div className="grid grid-cols-2 gap-4 mb-3">
            <ResultRow label="Exact volume" value={result.volumeM3} unit="m³" />
            <ResultRow label={`+ ${wasteFactor}% waste`} value={result.withWasteM3} unit="m³" variant="primary" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <ResultRow label="20kg bags" value={result.bags20kg} size="sm" />
            <ResultRow label="40kg bags" value={result.bags40kg} size="sm" />
            <ResultRow label="Truck loads" value={result.truckLoads} size="sm" />
          </div>
          {result.rebarKg > 0 && (
            <div className="mt-3 p-2.5 rounded-lg bg-muted">
              <p className="text-xs font-bold text-foreground">🔩 Est. reinforcement: ~{result.rebarKg} kg</p>
            </div>
          )}
          <div className="mt-3 p-2.5 rounded-lg bg-primary/5 border border-primary/20">
            <p className="text-xs font-bold text-primary">📋 Mix: {MIX_GRADES[mixGrade]?.label} ({MIX_GRADES[mixGrade]?.mpa} MPa)</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{MIX_GRADES[mixGrade]?.use}</p>
          </div>
          {result.warnings.map((w, i) => (
            <p key={i} className="text-xs text-destructive mt-2 font-medium">⚠️ {w}</p>
          ))}
        </>
      ) : undefined}
      advancedInputs={
        <>
          <div>
            <Label className="text-sm">Waste Factor (%)</Label>
            <div className="flex gap-2 mt-1">
              {["5", "10", "15", "20"].map((w) => (
                <Badge key={w} variant={wasteFactor === w ? "default" : "outline"}
                  className="cursor-pointer px-3 py-1.5 text-sm"
                  onClick={() => { setWasteFactor(w); setResult(null); }}>
                  {w}%
                </Badge>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-sm">Concrete Grade</Label>
            <Select value={mixGrade} onValueChange={setMixGrade}>
              <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(MIX_GRADES).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label} — {v.use}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-sm">Reinforcement</Label>
            <Select value={rebarLevel} onValueChange={setRebarLevel}>
              <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="light">Light — SL62 mesh</SelectItem>
                <SelectItem value="standard">Standard — SL82 / light bar</SelectItem>
                <SelectItem value="heavy">Heavy — N12/N16 bar</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-sm">Quantity (identical pours)</Label>
            <Input type="number" inputMode="numeric" className="h-11 mt-1" value={quantity}
              onChange={(e) => setQuantity(e.target.value)} />
          </div>
        </>
      }
    >
      {/* Shape selector */}
      <div>
        <Label className="text-sm">Shape</Label>
        <div className="flex gap-2 mt-1">
          {([["rectangular", "Rectangle"], ["circular", "Circle"], ["triangular", "Triangle"]] as const).map(([k, l]) => (
            <Badge key={k} variant={shape === k ? "default" : "outline"}
              className="cursor-pointer px-3 py-1.5 text-sm"
              onClick={() => { setShape(k); setResult(null); }}>
              {l}
            </Badge>
          ))}
        </div>
      </div>

      {/* Dimensions */}
      {shape === "circular" ? (
        <div>
          <Label className="text-sm">Diameter (m)</Label>
          <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="e.g. 2.5"
            value={diameter} onChange={(e) => setDiameter(e.target.value)} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-sm">{shape === "triangular" ? "Base" : "Length"} (m)</Label>
            <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="e.g. 6"
              value={length} onChange={(e) => setLength(e.target.value)} />
          </div>
          <div>
            <Label className="text-sm">{shape === "triangular" ? "Height" : "Width"} (m)</Label>
            <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="e.g. 4"
              value={width} onChange={(e) => setWidth(e.target.value)} />
          </div>
        </div>
      )}

      <div>
        <Label className="text-sm">Depth / Thickness (m)</Label>
        <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="e.g. 0.1"
          value={depth} onChange={(e) => setDepth(e.target.value)} />
        <div className="flex gap-2 mt-1.5">
          {[["0.075", "75mm"], ["0.1", "100mm"], ["0.15", "150mm"], ["0.2", "200mm"]].map(([v, l]) => (
            <Badge key={v} variant={depth === v ? "secondary" : "outline"}
              className="cursor-pointer px-2 py-0.5 text-[10px]"
              onClick={() => setDepth(v)}>
              {l}
            </Badge>
          ))}
        </div>
      </div>
    </ToolLayout>
  );
};

export default ConcreteVolumeTool;
