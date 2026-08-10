import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import ToolLayout from "./ToolLayout";
import ResultRow from "./ResultRow";

// PV short-circuit sizing factor — Isc can exceed STC under high irradiance.
// Confirmed against AS/NZS 5033 by Kyle (2026-08-10).
const SC_FACTOR = 1.25;

type Location = "rooftop" | "inverter";

const LOCATION_LABEL: Record<Location, string> = {
  rooftop: "Rooftop (at array)",
  inverter: "At inverter",
};

interface IsolatorResult {
  minVoltageRating: number;
  minCurrentRating: number;
  isc: number;
  parallelStrings: number;
  location: Location;
}

interface Props { onBack: () => void }

const DCIsolatorTool = ({ onBack }: Props) => {
  const [arrayMaxVoltage, setArrayMaxVoltage] = useState("");
  const [iscStc, setIscStc] = useState("");
  const [parallelStrings, setParallelStrings] = useState("1");
  const [location, setLocation] = useState<Location>("rooftop");
  const [result, setResult] = useState<IsolatorResult | null>(null);

  const calculate = () => {
    const voltage = parseFloat(arrayMaxVoltage);
    const isc = parseFloat(iscStc);
    const strings = parseInt(parallelStrings, 10);

    if (isNaN(voltage) || voltage < 50 || voltage > 1500) return;
    if (isNaN(isc) || isc < 1 || isc > 30) return;
    if (isNaN(strings) || strings < 1 || strings > 6) return;

    const minVoltageRating = Math.ceil(voltage);
    const minCurrentRating = Math.round(SC_FACTOR * isc * strings * 10) / 10;

    setResult({
      minVoltageRating,
      minCurrentRating,
      isc,
      parallelStrings: strings,
      location,
    });
  };

  return (
    <ToolLayout
      title="DC Isolator Rating"
      subtitle="Minimum isolator ratings from array datasheet values"
      disclaimer="Minimum ratings computed from your array's datasheet values with the generic 1.25 short-circuit factor. Which isolators are required, where, and their installation requirements are set by AS/NZS 5033 and AS/NZS 4777 — this tool deliberately embeds none of those requirements; verify against your copies of the standards and the isolator manufacturer's DC rating tables."
      onBack={onBack}
      onCalculate={calculate}
      verifyQuestion={
        result
          ? `What does AS/NZS 5033 require for DC isolators on a PV array with maximum voltage ${result.minVoltageRating} V — location, poles and rating requirements?`
          : undefined
      }
      result={result ? (
        <>
          <div className="p-3 rounded-lg mb-3 border bg-primary/5 border-primary/20">
            <p className="text-xl font-extrabold text-primary">
              ≥ {result.minVoltageRating} V DC · ≥ {result.minCurrentRating} A
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {result.parallelStrings} string{result.parallelStrings > 1 ? "s" : ""} · {LOCATION_LABEL[result.location]}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <ResultRow label="Min voltage rating" value={result.minVoltageRating} unit="V DC" variant="primary" />
            <ResultRow label="Min current rating" value={result.minCurrentRating} unit="A" variant="primary" />
          </div>
          <div className="mt-3">
            <ResultRow
              label="Isc basis"
              value={`1.25 × ${result.isc} A × ${result.parallelStrings}`}
              size="sm"
            />
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            💡 Check the isolator datasheet's DC rating for the actual pole configuration — DC ratings are far lower than AC ratings for the same device.
          </p>
          {result.location === "rooftop" && (
            <p className="text-xs text-muted-foreground mt-2">
              💡 Rooftop isolators cop full weather and UV — mount per the manufacturer's orientation requirements to keep water out of the enclosure.
            </p>
          )}
          <div className="mt-4">
            <p className="text-xs font-bold text-foreground mb-1.5">Verify in your copies of AS/NZS 5033 / 4777:</p>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">💡 Isolation requirements at the array and at the inverter for your installation type</p>
              <p className="text-xs text-muted-foreground">💡 Whether all live conductors must be broken and the required breaking capacity</p>
              <p className="text-xs text-muted-foreground">💡 Weatherproofing/IP and shading requirements for rooftop isolators</p>
              <p className="text-xs text-muted-foreground">💡 Signage and shutdown procedure labelling</p>
              <p className="text-xs text-muted-foreground">💡 Inverter: CEC-approved list and DNSP (network) pre-approval per AS/NZS 4777</p>
            </div>
          </div>
        </>
      ) : undefined}
    >
      <div>
        <Label className="text-sm">Array Maximum Voltage (V)</Label>
        <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="e.g. 480"
          value={arrayMaxVoltage} onChange={(e) => { setArrayMaxVoltage(e.target.value); setResult(null); }} />
        <p className="text-[10px] text-muted-foreground mt-0.5">
          String Voc at the site's coldest temperature — use the PV String Sizing tool's cold-Voc output
        </p>
      </div>
      <div>
        <Label className="text-sm">Module Isc STC (A)</Label>
        <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="e.g. 13.8"
          value={iscStc} onChange={(e) => { setIscStc(e.target.value); setResult(null); }} />
      </div>
      <div>
        <Label className="text-sm">Parallel Strings Through This Isolator</Label>
        <Select value={parallelStrings} onValueChange={(v) => { setParallelStrings(v); setResult(null); }}>
          <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <SelectItem key={n} value={String(n)}>{n}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-sm">Isolator Location</Label>
        <div className="flex gap-2 mt-1">
          {(Object.keys(LOCATION_LABEL) as Location[]).map((loc) => (
            <Badge key={loc} variant={location === loc ? "default" : "outline"}
              className="cursor-pointer px-3 py-1.5 text-sm"
              onClick={() => { setLocation(loc); setResult(null); }}>
              {LOCATION_LABEL[loc]}
            </Badge>
          ))}
        </div>
      </div>
    </ToolLayout>
  );
};

export default DCIsolatorTool;
