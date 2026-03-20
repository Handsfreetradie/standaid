import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import ToolLayout from "./ToolLayout";
import ResultRow from "./ResultRow";

interface RoofResult {
  pitchDegrees: number;
  pitchRatio: string;
  rafterLength: number;
  ridgeHeight: number;
  roofArea: number;
  sheetsRequired: number;
  warnings: string[];
}

interface Props { onBack: () => void }

const RoofPitchTool = ({ onBack }: Props) => {
  const [mode, setMode] = useState<"calculate" | "check">("calculate");
  const [spanWidth, setSpanWidth] = useState("");
  const [ridgeHeight, setRidgeHeight] = useState("");
  const [pitchDegrees, setPitchDegrees] = useState("");
  const [roofLength, setRoofLength] = useState("");
  const [sheetWidth, setSheetWidth] = useState("762"); // standard corrugated
  const [result, setResult] = useState<RoofResult | null>(null);

  const calculate = () => {
    const warnings: string[] = [];
    let pitch = 0;
    let rise = 0;
    let halfSpan = 0;
    let rafter = 0;

    if (mode === "calculate") {
      const span = parseFloat(spanWidth);
      const height = parseFloat(ridgeHeight);
      if (isNaN(span) || isNaN(height) || span <= 0 || height <= 0) return;
      halfSpan = span / 2;
      rise = height;
      pitch = Math.atan(rise / halfSpan) * (180 / Math.PI);
      rafter = Math.sqrt(halfSpan * halfSpan + rise * rise);
    } else {
      const span = parseFloat(spanWidth);
      pitch = parseFloat(pitchDegrees);
      if (isNaN(span) || isNaN(pitch) || span <= 0 || pitch <= 0) return;
      halfSpan = span / 2;
      rise = halfSpan * Math.tan(pitch * (Math.PI / 180));
      rafter = Math.sqrt(halfSpan * halfSpan + rise * rise);
    }

    const length = parseFloat(roofLength) || 0;
    const roofArea = length > 0 ? rafter * length * 2 : 0;
    const sheetW = (parseFloat(sheetWidth) || 762) / 1000;
    const sheetsRequired = length > 0 ? Math.ceil((length / sheetW) * 2) : 0;

    // Standard pitch ratios
    const ratioNum = Math.round((rise / halfSpan) * 12);
    const pitchRatio = `${ratioNum}:12`;

    if (pitch < 5) warnings.push("Pitch below 5° — not suitable for most roof sheeting without special sealing.");
    if (pitch < 10) warnings.push("Low pitch — check manufacturer minimum pitch requirements for your roofing material.");
    if (pitch > 35) warnings.push("Steep pitch — may need additional fixings for wind uplift.");

    setResult({
      pitchDegrees: Math.round(pitch * 10) / 10,
      pitchRatio,
      rafterLength: Math.round(rafter * 1000) / 1000,
      ridgeHeight: Math.round(rise * 1000) / 1000,
      roofArea: Math.round(roofArea * 100) / 100,
      sheetsRequired,
      warnings,
    });
  };

  return (
    <ToolLayout
      title="Roof Pitch Calculator"
      subtitle="Calculate pitch, rafter length & roof area"
      disclaimer="Rafter length is geometric (add for eaves overhang). Sheet count assumes standard corrugated profile with no overlap — add 10% for overlaps."
      onBack={onBack}
      onCalculate={calculate}
      result={result ? (
        <>
          <div className="p-3 rounded-lg mb-3 border bg-primary/5 border-primary/20">
            <p className="text-3xl font-extrabold text-primary">{result.pitchDegrees}°</p>
            <p className="text-xs text-muted-foreground mt-1">Pitch ratio: {result.pitchRatio}</p>
          </div>
          <div className="grid grid-cols-2 gap-4 mb-3">
            <ResultRow label="Rafter length" value={result.rafterLength} unit="m" variant="primary" />
            <ResultRow label="Ridge height" value={result.ridgeHeight} unit="m" />
          </div>
          {result.roofArea > 0 && (
            <div className="grid grid-cols-2 gap-4">
              <ResultRow label="Roof area" value={result.roofArea} unit="m²" size="sm" />
              <ResultRow label="Sheets (approx)" value={result.sheetsRequired} size="sm" />
            </div>
          )}
          {result.warnings.map((w, i) => (
            <p key={i} className="text-xs text-destructive mt-2 font-medium">⚠️ {w}</p>
          ))}
        </>
      ) : undefined}
    >
      <div>
        <Label className="text-sm">Mode</Label>
        <div className="flex gap-2 mt-1">
          {([["calculate", "Find pitch from dimensions"], ["check", "Check from known pitch"]] as const).map(([k, l]) => (
            <Badge key={k} variant={mode === k ? "default" : "outline"}
              className="cursor-pointer px-3 py-1.5 text-sm"
              onClick={() => { setMode(k as "calculate" | "check"); setResult(null); }}>
              {l}
            </Badge>
          ))}
        </div>
      </div>
      <div>
        <Label className="text-sm">Building Span Width (m)</Label>
        <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="e.g. 8"
          value={spanWidth} onChange={(e) => setSpanWidth(e.target.value)} />
        <p className="text-[10px] text-muted-foreground mt-0.5">Wall-to-wall width</p>
      </div>
      {mode === "calculate" ? (
        <div>
          <Label className="text-sm">Ridge Height above wall plate (m)</Label>
          <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="e.g. 1.5"
            value={ridgeHeight} onChange={(e) => setRidgeHeight(e.target.value)} />
        </div>
      ) : (
        <div>
          <Label className="text-sm">Pitch (degrees)</Label>
          <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="e.g. 22.5"
            value={pitchDegrees} onChange={(e) => setPitchDegrees(e.target.value)} />
        </div>
      )}
      <div>
        <Label className="text-sm">Roof Length (m) — optional</Label>
        <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="e.g. 15"
          value={roofLength} onChange={(e) => setRoofLength(e.target.value)} />
        <p className="text-[10px] text-muted-foreground mt-0.5">For area & sheet estimates</p>
      </div>
    </ToolLayout>
  );
};

export default RoofPitchTool;
