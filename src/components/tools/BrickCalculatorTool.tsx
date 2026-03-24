import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import ToolLayout from "./ToolLayout";
import ResultRow from "./ResultRow";

const BRICK_TYPES: Record<string, { label: string; perM2: number; mortarKgPerM2: number }> = {
  "standard-76": { label: "Standard brick (76mm)", perM2: 50, mortarKgPerM2: 42 },
  "standard-90": { label: "Standard brick (90mm)", perM2: 50, mortarKgPerM2: 48 },
  "block-190": { label: "Concrete block (190mm)", perM2: 12.5, mortarKgPerM2: 14 },
  "block-140": { label: "Concrete block (140mm)", perM2: 12.5, mortarKgPerM2: 12 },
  "block-90": { label: "Concrete block (90mm)", perM2: 12.5, mortarKgPerM2: 10 },
};

interface BrickResult {
  area: number;
  totalBricks: number;
  mortarKg: number;
  mortarBags: number;
  sandM3: number;
  warnings: string[];
}

interface Props { onBack: () => void }

const BrickCalculatorTool = ({ onBack }: Props) => {
  const [brickType, setBrickType] = useState("standard-76");
  const [wallLength, setWallLength] = useState("");
  const [wallHeight, setWallHeight] = useState("");
  const [openings, setOpenings] = useState("0");
  const [wasteFactor, setWasteFactor] = useState("10");
  const [result, setResult] = useState<BrickResult | null>(null);

  const calculate = () => {
    const L = parseFloat(wallLength);
    const H = parseFloat(wallHeight);
    const openingsArea = parseFloat(openings) || 0;
    if (isNaN(L) || isNaN(H) || L <= 0 || H <= 0) return;

    const bt = BRICK_TYPES[brickType];
    if (!bt) return;

    const area = L * H - openingsArea;
    if (area <= 0) return;

    const waste = 1 + parseFloat(wasteFactor) / 100;
    const totalBricks = Math.ceil(area * bt.perM2 * waste);
    const mortarKg = Math.round(area * bt.mortarKgPerM2 * waste);
    const mortarBags = Math.ceil(mortarKg / 20);
    const sandM3 = Math.round((mortarKg / 1500) * 4 * 100) / 100; // ~4:1 sand:cement

    const warnings: string[] = [];
    if (H > 3) warnings.push("Wall height above 3m — may need engineering for wind bracing.");
    if (area > 50) warnings.push("Large wall area — consider ordering in bulk for better pricing.");

    setResult({ area: Math.round(area * 100) / 100, totalBricks, mortarKg, mortarBags, sandM3, warnings });
  };

  return (
    <ToolLayout
      title="Brick & Block Estimator"
      subtitle="Calculate bricks, mortar & sand for walls"
      disclaimer="Estimates based on standard bond patterns. Actual quantities vary with joint thickness and bond type. Add 5-10% waste for cuts and breakage."
      onBack={onBack}
      onCalculate={calculate}
      result={result ? (
        <>
          <div className="p-3 rounded-lg mb-3 border bg-primary/5 border-primary/20">
            <p className="text-3xl font-extrabold text-primary">{result.totalBricks.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Total {brickType.includes("block") ? "blocks" : "bricks"} (incl. {wasteFactor}% waste)
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <ResultRow label="Wall area" value={result.area} unit="m²" size="sm" />
            <ResultRow label="Mortar" value={result.mortarBags} unit="bags" size="sm" variant="primary" />
            <ResultRow label="Sand" value={result.sandM3} unit="m³" size="sm" />
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
              {["5", "10", "15"].map(w => (
                <Badge key={w} variant={wasteFactor === w ? "default" : "outline"}
                  className="cursor-pointer px-3 py-1.5 text-sm"
                  onClick={() => { setWasteFactor(w); setResult(null); }}>
                  {w}%
                </Badge>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-sm">Openings area (m²)</Label>
            <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="e.g. 3.6"
              value={openings} onChange={(e) => setOpenings(e.target.value)} />
            <p className="text-[10px] text-muted-foreground mt-0.5">Total area of doors & windows to subtract</p>
          </div>
        </>
      }
    >
      <div>
        <Label className="text-sm">Brick / Block Type</Label>
        <Select value={brickType} onValueChange={(v) => { setBrickType(v); setResult(null); }}>
          <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(BRICK_TYPES).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-sm">Wall Length (m)</Label>
          <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="e.g. 12"
            value={wallLength} onChange={(e) => setWallLength(e.target.value)} />
        </div>
        <div>
          <Label className="text-sm">Wall Height (m)</Label>
          <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="e.g. 2.7"
            value={wallHeight} onChange={(e) => setWallHeight(e.target.value)} />
        </div>
      </div>
    </ToolLayout>
  );
};

export default BrickCalculatorTool;
