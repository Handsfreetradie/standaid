import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import ToolLayout from "./ToolLayout";
import ResultRow from "./ResultRow";

// Simplified AS 1684 span tables — max span in mm for common scenarios
const TIMBER_DATA: Record<string, Record<string, Record<string, number>>> = {
  "floor-joist": {
    "MGP10": { "70x35": 1200, "90x35": 1600, "90x45": 1800, "120x35": 2100, "120x45": 2400, "140x45": 2700, "190x45": 3300, "240x45": 4000 },
    "MGP12": { "70x35": 1400, "90x35": 1800, "90x45": 2000, "120x35": 2400, "120x45": 2700, "140x45": 3000, "190x45": 3700, "240x45": 4500 },
    "MGP15": { "70x35": 1500, "90x35": 1900, "90x45": 2200, "120x35": 2600, "120x45": 2900, "140x45": 3300, "190x45": 4100, "240x45": 4900 },
  },
  "rafter": {
    "MGP10": { "70x35": 1500, "90x35": 2000, "90x45": 2200, "120x35": 2700, "120x45": 3000, "140x45": 3400, "190x45": 4200 },
    "MGP12": { "70x35": 1700, "90x35": 2200, "90x45": 2500, "120x35": 3000, "120x45": 3400, "140x45": 3800, "190x45": 4700 },
    "MGP15": { "70x35": 1900, "90x35": 2500, "90x45": 2800, "120x35": 3300, "120x45": 3700, "140x45": 4200, "190x45": 5100 },
  },
  "bearer": {
    "MGP10": { "90x90": 1800, "120x120": 2400, "140x45": 1600, "190x45": 2100, "240x45": 2600 },
    "MGP12": { "90x90": 2000, "120x120": 2700, "140x45": 1800, "190x45": 2400, "240x45": 2900 },
    "MGP15": { "90x90": 2200, "120x120": 3000, "140x45": 2000, "190x45": 2600, "240x45": 3200 },
  },
};

const SPACING_OPTIONS = ["450", "600", "900"];

interface SpanResult {
  maxSpan: number;
  maxSpanFormatted: string;
  inputSpan: number;
  passes: boolean;
  nextSizeUp: string | null;
  nextSizeSpan: number | null;
  warnings: string[];
}

interface Props { onBack: () => void }

const TimberSpanTool = ({ onBack }: Props) => {
  const [application, setApplication] = useState("floor-joist");
  const [grade, setGrade] = useState("MGP10");
  const [timberSize, setTimberSize] = useState("90x45");
  const [spacing, setSpacing] = useState("450");
  const [span, setSpan] = useState("");
  const [result, setResult] = useState<SpanResult | null>(null);

  const appData = TIMBER_DATA[application] || {};
  const gradeData = appData[grade] || {};
  const availableSizes = Object.keys(gradeData);

  const calculate = () => {
    const inputSpanMm = parseFloat(span) * 1000;
    if (isNaN(inputSpanMm) || inputSpanMm <= 0) return;

    // Adjust for spacing (tables based on 450mm, reduce for 600/900)
    const spacingFactor = spacing === "450" ? 1.0 : spacing === "600" ? 0.9 : 0.75;
    const maxSpan = Math.round((gradeData[timberSize] || 0) * spacingFactor);
    const passes = inputSpanMm <= maxSpan;

    // Find next size up
    const idx = availableSizes.indexOf(timberSize);
    let nextSizeUp: string | null = null;
    let nextSizeSpan: number | null = null;
    if (!passes && idx < availableSizes.length - 1) {
      for (let i = idx + 1; i < availableSizes.length; i++) {
        const testSpan = Math.round((gradeData[availableSizes[i]] || 0) * spacingFactor);
        if (testSpan >= inputSpanMm) {
          nextSizeUp = availableSizes[i];
          nextSizeSpan = testSpan;
          break;
        }
      }
    }

    const warnings: string[] = [];
    if (!passes) warnings.push("Span exceeds maximum — increase timber size or reduce spacing.");
    if (maxSpan > 0 && inputSpanMm > maxSpan * 0.9 && passes) warnings.push("Span is close to maximum — consider next size up for safety margin.");

    setResult({
      maxSpan,
      maxSpanFormatted: `${(maxSpan / 1000).toFixed(1)}m`,
      inputSpan: inputSpanMm,
      passes,
      nextSizeUp,
      nextSizeSpan,
      warnings,
    });
  };

  return (
    <ToolLayout
      title="Timber Span Calculator"
      subtitle="AS 1684 — Max spans for joists, rafters & bearers"
      disclaimer="Simplified from AS 1684 span tables. Values assume single span, N2 wind class, sheet roof. Always consult full span tables or engineer for specific loading conditions."
      onBack={onBack}
      onCalculate={calculate}
      result={result ? (
        <>
          <div className={`p-3 rounded-lg mb-3 border ${
            result.passes ? "bg-primary/5 border-primary/20" : "bg-destructive/5 border-destructive/20"
          }`}>
            <p className={`text-sm font-extrabold ${result.passes ? "text-primary" : "text-destructive"}`}>
              {result.passes ? "✅ SPAN OK" : "❌ EXCEEDS MAX SPAN"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Max span: {result.maxSpanFormatted} • Your span: {(result.inputSpan / 1000).toFixed(1)}m
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <ResultRow label="Max span" value={result.maxSpanFormatted} variant="primary" />
            <ResultRow label="Utilisation" value={Math.round((result.inputSpan / result.maxSpan) * 100)} unit="%" 
              variant={result.passes ? "default" : "destructive"} size="sm" />
          </div>
          {result.nextSizeUp && (
            <div className="mt-3 p-2.5 rounded-lg bg-primary/5 border border-primary/20">
              <p className="text-xs font-bold text-primary">💡 Use {result.nextSizeUp} instead (max {(result.nextSizeSpan! / 1000).toFixed(1)}m)</p>
            </div>
          )}
          {result.warnings.map((w, i) => (
            <p key={i} className="text-xs text-destructive mt-2 font-medium">⚠️ {w}</p>
          ))}
        </>
      ) : undefined}
    >
      <div>
        <Label className="text-sm">Application</Label>
        <Select value={application} onValueChange={(v) => { setApplication(v); setResult(null); }}>
          <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="floor-joist">Floor joist</SelectItem>
            <SelectItem value="rafter">Rafter</SelectItem>
            <SelectItem value="bearer">Bearer</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-sm">Timber Grade</Label>
          <Select value={grade} onValueChange={(v) => { setGrade(v); setResult(null); }}>
            <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="MGP10">MGP10</SelectItem>
              <SelectItem value="MGP12">MGP12</SelectItem>
              <SelectItem value="MGP15">MGP15</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-sm">Timber Size</Label>
          <Select value={timberSize} onValueChange={(v) => { setTimberSize(v); setResult(null); }}>
            <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {availableSizes.map(s => (
                <SelectItem key={s} value={s}>{s} mm</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <Label className="text-sm">Spacing</Label>
        <div className="flex gap-2 mt-1">
          {SPACING_OPTIONS.map(s => (
            <Badge key={s} variant={spacing === s ? "default" : "outline"}
              className="cursor-pointer px-3 py-1.5 text-sm"
              onClick={() => { setSpacing(s); setResult(null); }}>
              {s}mm
            </Badge>
          ))}
        </div>
      </div>
      <div>
        <Label className="text-sm">Required Span (m)</Label>
        <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="e.g. 3.6"
          value={span} onChange={(e) => setSpan(e.target.value)} />
      </div>
    </ToolLayout>
  );
};

export default TimberSpanTool;
