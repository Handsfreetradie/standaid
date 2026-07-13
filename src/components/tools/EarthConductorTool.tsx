import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ToolLayout from "./ToolLayout";
import ResultRow from "./ResultRow";

// AS/NZS 3000:2018 Table 5.1 — MINIMUM COPPER EARTHING CONDUCTOR SIZE.
// Values transcribed verbatim (2026-07-13) from the vision-captured Table 5.1
// of the user's uploaded AS/NZS 3000 — both columns, including footnotes.
// null = not listed in the standard for that combination.
interface EarthRow {
  active: string;
  cuActive: string | null;   // earth size with copper actives
  alActive: string | null;   // earth size with aluminium actives
  note?: "multicore-only" | "check-5331";
}

const TABLE_5_1: EarthRow[] = [
  { active: "1",    cuActive: "1",    alActive: null, note: "multicore-only" },
  { active: "1.5",  cuActive: "1.5",  alActive: null, note: "multicore-only" },
  { active: "2.5",  cuActive: "2.5",  alActive: null },
  { active: "4",    cuActive: "2.5",  alActive: null },
  { active: "6",    cuActive: "2.5",  alActive: null },
  { active: "10",   cuActive: "4",    alActive: null },
  { active: "16",   cuActive: "6",    alActive: "4" },
  { active: "25",   cuActive: "6",    alActive: "6" },
  { active: "35",   cuActive: "10",   alActive: "6" },
  { active: "50",   cuActive: "16",   alActive: "10" },
  { active: "70",   cuActive: "25",   alActive: "10" },
  { active: "95",   cuActive: "25",   alActive: "16" },
  { active: "120",  cuActive: "35",   alActive: "25" },
  { active: "150",  cuActive: "50",   alActive: "25" },
  { active: "185",  cuActive: "70",   alActive: "35" },
  { active: "240",  cuActive: "95",   alActive: "50" },
  { active: "300",  cuActive: "120",  alActive: "70" },
  { active: "400",  cuActive: "≥120", alActive: "≥95",  note: "check-5331" },
  { active: "500",  cuActive: "≥120", alActive: "≥95",  note: "check-5331" },
  { active: "630",  cuActive: "≥120", alActive: "≥120", note: "check-5331" },
];

interface Props { onBack: () => void }

const EarthConductorTool = ({ onBack }: Props) => {
  const [activeSize, setActiveSize] = useState("2.5");
  const [activeMaterial, setActiveMaterial] = useState<"copper" | "aluminium">("copper");
  const [result, setResult] = useState<EarthRow | null>(null);

  const rows = activeMaterial === "copper"
    ? TABLE_5_1
    : TABLE_5_1.filter((r) => r.alActive !== null);

  const calculate = () => {
    const row = TABLE_5_1.find((r) => r.active === activeSize);
    setResult(row ?? null);
  };

  const earthSize = result
    ? (activeMaterial === "copper" ? result.cuActive : result.alActive)
    : null;

  return (
    <ToolLayout
      title="Earth Conductor Size"
      subtitle="AS/NZS 3000 Table 5.1 — minimum copper earthing conductor"
      disclaimer="Minimum sizes from AS/NZS 3000:2018 Table 5.1. Table 5.1 gives the MINIMUM — a larger earth may be required by Clause 5.3.3.1.1 (e.g. calculated per fault current), and unprotected buried earthing conductors have their own minimums in Clause 5.3.3. Always confirm against your copy of the standard."
      onBack={onBack}
      onCalculate={calculate}
      verifyQuestion={
        result
          ? `What is the minimum copper earthing conductor size for a ${activeSize} mm² ${activeMaterial} active conductor according to Table 5.1?`
          : undefined
      }
      result={result ? (
        <>
          <div className="p-3 rounded-lg mb-3 border bg-primary/5 border-primary/20">
            <p className="text-sm font-extrabold text-primary">
              Minimum earth: {earthSize} mm² copper
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {activeSize} mm² {activeMaterial} active • AS/NZS 3000 Table 5.1
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <ResultRow label="Active conductor" value={`${activeSize} mm²`} size="sm" />
            <ResultRow label="Min. earth (Cu)" value={`${earthSize} mm²`} variant="primary" />
          </div>
          {result.note === "multicore-only" && (
            <p className="text-xs text-destructive mt-3 font-medium">
              ⚠️ A {earthSize} mm² earth is only permitted where it's part of a multi-core cable or
              flexible cord (not a lift travelling cable) — Clause 5.3.3.4(b) and (c). A separate
              earthing conductor must be at least 2.5 mm².
            </p>
          )}
          {result.note === "check-5331" && (
            <p className="text-xs text-destructive mt-3 font-medium">
              ⚠️ For actives this size, Table 5.1 gives a floor only — a larger earthing conductor
              may be required to satisfy Clause 5.3.3.1.1. Check the calculation method.
            </p>
          )}
        </>
      ) : undefined}
    >
      <div>
        <Label className="text-sm">Active Conductor Material</Label>
        <Select value={activeMaterial} onValueChange={(v) => { setActiveMaterial(v as "copper" | "aluminium"); setResult(null); }}>
          <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="copper">Copper actives</SelectItem>
            <SelectItem value="aluminium">Aluminium actives</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-sm">Active Conductor Size (mm²)</Label>
        <Select value={activeSize} onValueChange={(v) => { setActiveSize(v); setResult(null); }}>
          <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {rows.map((r) => (
              <SelectItem key={r.active} value={r.active}>{r.active} mm²</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          Largest active conductor of the circuit supplying the equipment
        </p>
      </div>
    </ToolLayout>
  );
};

export default EarthConductorTool;
