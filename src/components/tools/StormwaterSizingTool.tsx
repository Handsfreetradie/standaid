import { useState } from "react";
import { Label, Button } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ToolLayout from "./ToolLayout";
import AddToProjectModal from "./AddToProjectModal";
import { saveCalculationToProject } from "./projectUtils";
import ResultRow from "./ResultRow";

// Indicative 5-minute duration, 5% AEP (1-in-20 ARI) rainfall intensities compiled by lead
// engineer from Bureau of Meteorology IFD data — indicative values for preliminary sizing;
// check current BoM IFD data for the exact site.
const INTENSITY_TABLE: { label: string; intensity: number }[] = [
  { label: "Perth", intensity: 150 },
  { label: "Sydney", intensity: 190 },
  { label: "Newcastle", intensity: 200 },
  { label: "Melbourne", intensity: 130 },
  { label: "Brisbane", intensity: 230 },
  { label: "Gold Coast", intensity: 240 },
  { label: "Adelaide", intensity: 120 },
  { label: "Hobart", intensity: 100 },
  { label: "Canberra", intensity: 130 },
  { label: "Darwin", intensity: 290 },
  { label: "Cairns", intensity: 280 },
  { label: "Townsville", intensity: 250 },
];

const OTHER_LOCATION = "Other / manual entry";

// Indicative downpipe capacities for eaves gutters at minimum fall, compiled by lead engineer
// from typical AS/NZS 3500.3-aligned manufacturer data — verify against Table G1/manufacturer
// for the actual profile.
const DOWNPIPE_CAPACITY: { label: string; capacity: number }[] = [
  { label: "75 mm round", capacity: 1.6 },
  { label: "90 mm round", capacity: 2.6 },
  { label: "100 mm round", capacity: 3.5 },
  { label: "100 × 50 rect", capacity: 2.0 },
  { label: "100 × 75 rect", capacity: 3.2 },
  { label: "100 × 100 rect", capacity: 4.4 },
];

// Same indicative provenance as DOWNPIPE_CAPACITY above — required eaves gutter profile by
// flow per downpipe. Above the top tier a deep profile / hydraulic design is required.
const GUTTER_TABLE: { maxFlow: number; label: string }[] = [
  { maxFlow: 1.0, label: "115 mm quad" },
  { maxFlow: 1.4, label: "125 mm quad" },
  { maxFlow: 2.2, label: "150 mm quad / 115 high-front" },
];
const GUTTER_HYDRAULIC_DESIGN = "Deep profile / hydraulic design required";

interface StormwaterResult {
  totalFlow: number;
  downpipeCount: number;
  maxCatchmentPerDP: number;
  gutterLabel: string;
  gutterExceeds: boolean;
  downpipeLabel: string;
  intensity: number;
  area: number;
}

interface Props { onBack: () => void }

const StormwaterSizingTool = ({ onBack }: Props) => {
  const [location, setLocation] = useState("Perth");
  const [intensity, setIntensity] = useState("150");
  const [area, setArea] = useState("");
  const [downpipeType, setDownpipeType] = useState("100 mm round");
  const [result, setResult] = useState<StormwaterResult | null>(null);
  const [showProjectModal, setShowProjectModal] = useState(false);

  const handleLocationChange = (value: string) => {
    setLocation(value);
    const match = INTENSITY_TABLE.find((l) => l.label === value);
    if (match) setIntensity(String(match.intensity));
    setResult(null);
  };

  const calculate = () => {
    const intensityNum = parseFloat(intensity);
    const areaNum = parseFloat(area);
    if (isNaN(intensityNum) || isNaN(areaNum)) return;
    if (intensityNum < 50 || intensityNum > 500) return;
    if (areaNum < 1 || areaNum > 1000) return;

    const dp = DOWNPIPE_CAPACITY.find((d) => d.label === downpipeType);
    if (!dp) return;

    const totalFlow = (intensityNum * areaNum) / 3600;
    const downpipeCount = Math.max(1, Math.ceil(totalFlow / dp.capacity));
    const maxCatchmentPerDP = (dp.capacity * 3600) / intensityNum;
    const flowPerDP = totalFlow / downpipeCount;

    const tier = GUTTER_TABLE.find((t) => flowPerDP <= t.maxFlow);
    const gutterLabel = tier ? tier.label : GUTTER_HYDRAULIC_DESIGN;

    setResult({
      totalFlow,
      downpipeCount,
      maxCatchmentPerDP,
      gutterLabel,
      gutterExceeds: !tier,
      downpipeLabel: dp.label,
      intensity: intensityNum,
      area: areaNum,
    });
  };

  return (
    <ToolLayout
      title="Stormwater Sizing"
      subtitle="AS/NZS 3500.3 — eaves gutter & downpipe guide"
      disclaimer="Preliminary guide using indicative 5-minute 5% AEP rainfall intensities and typical downpipe capacities aligned with AS/NZS 3500.3. Actual design must use current BoM IFD data for the site, the standard's tables for the exact gutter profile and slope, and overflow provisions per Section 4. Box gutters are excluded — they require hydraulic design. Always confirm against your copy of the standard."
      onBack={onBack}
      onCalculate={calculate}
      verifyQuestion={
        result
          ? `Can you verify the downpipe and eaves gutter sizing method for a ${result.area} m² roof catchment at ${result.intensity} mm/h rainfall intensity per AS/NZS 3500.3?`
          : undefined
      }
      result={result ? (
        <>
          <div className="p-3 rounded-lg mb-3 border bg-primary/5 border-primary/20">
            <p className="text-sm font-extrabold text-primary">
              {result.downpipeCount} × {result.downpipeLabel} downpipe{result.downpipeCount !== 1 ? "s" : ""}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {result.totalFlow.toFixed(2)} L/s total flow · {result.intensity} mm/h · {result.area} m²
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <ResultRow label="Total flow" value={result.totalFlow.toFixed(2)} unit="L/s" />
            <ResultRow label="Downpipes required" value={result.downpipeCount} variant="primary" />
            <ResultRow label="Max catchment per DP" value={result.maxCatchmentPerDP.toFixed(1)} unit="m²" size="sm" />
            <ResultRow label="Suggested eaves gutter" value={result.gutterLabel} size="sm" />
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            💡 Box gutters are out of scope here — they require design to AS/NZS 3500.3 Section 7 by a hydraulic designer.
          </p>
          {result.gutterExceeds && (
            <p className="text-xs text-destructive mt-2 font-medium">
              ⚠️ Flow per downpipe exceeds common eaves gutter profiles — add downpipes or get a hydraulic design.
            </p>
          )}
          {result.downpipeCount > 8 && (
            <p className="text-xs text-destructive mt-2 font-medium">
              ⚠️ Consider splitting the roof into separate gutter runs.
            </p>
          )}
        <div className="mt-4 pt-4 border-t">
            <button
              onClick={() => setShowProjectModal(true)}
              className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors text-sm font-medium"
            >
              Add to Project
            </button>
          </div>

        </>
      ) : undefined}
    >
      <div>
        <Label className="text-sm">Location</Label>
        <Select value={location} onValueChange={handleLocationChange}>
          <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {INTENSITY_TABLE.map((l) => (
              <SelectItem key={l.label} value={l.label}>{l.label}</SelectItem>
            ))}
            <SelectItem value={OTHER_LOCATION}>{OTHER_LOCATION}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-sm">Rainfall Intensity (mm/h)</Label>
        <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="e.g. 150"
          value={intensity} onChange={(e) => { setIntensity(e.target.value); setResult(null); }} />
      </div>
      <div>
        <Label className="text-sm">Total Roof Catchment Area (m²)</Label>
        <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="e.g. 45"
          value={area} onChange={(e) => { setArea(e.target.value); setResult(null); }} />
        <p className="text-[10px] text-muted-foreground mt-0.5">
          Roof plan area draining to this gutter run, plus half of any vertical wall area that drains onto the roof
        </p>
      </div>
      <div>
        <Label className="text-sm">Downpipe Type</Label>
        <Select value={downpipeType} onValueChange={(v) => { setDownpipeType(v); setResult(null); }}>
          <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {DOWNPIPE_CAPACITY.map((d) => (
              <SelectItem key={d.label} value={d.label}>{d.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <AddToProjectModal
        isOpen={showProjectModal}
        onClose={() => setShowProjectModal(false)}
        onSave={(projectId, projectName, calcLabel) => {
          saveCalculationToProject(
            projectId,
            projectName,
            "stormwater",
            "Stormwater Sizing",
            {}, // Inputs - populate based on tool state
            result,
            `Stormwater Sizing calculation`,
            calcLabel
          );
          setShowProjectModal(false);
        }}
        calculationSummary={result ? `Stormwater Sizing` : ''}
      />
        </ToolLayout>
  );
};

export default StormwaterSizingTool;
