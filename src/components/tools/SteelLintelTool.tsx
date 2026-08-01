import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ToolLayout from "./ToolLayout";
import ResultRow from "./ResultRow";

type LoadCase = "masonry" | "single" | "two";

// Indicative sizes compiled from typical Australian galvanised lintel manufacturer
// span tables (110 mm brickwork) — NOT from AS 4100 calculation.
interface LintelEntry {
  maxOpening: number; // mm
  section: string;
}

const LINTEL_TABLE: Record<LoadCase, LintelEntry[]> = {
  masonry: [
    { maxOpening: 1200, section: "90 × 90 × 6 EA" },
    { maxOpening: 1500, section: "100 × 100 × 6 EA" },
    { maxOpening: 2400, section: "150 × 90 × 8 UA" },
    { maxOpening: 3000, section: "150 × 100 × 10 UA" },
  ],
  single: [
    { maxOpening: 900, section: "90 × 90 × 8 EA" },
    { maxOpening: 1200, section: "100 × 100 × 6 EA" },
    { maxOpening: 1800, section: "150 × 90 × 8 UA" },
    { maxOpening: 2400, section: "150 × 100 × 10 UA" },
    { maxOpening: 3000, section: "200 PFC" },
  ],
  two: [
    { maxOpening: 1500, section: "150 PFC" },
    { maxOpening: 1800, section: "180 PFC" },
    { maxOpening: 2100, section: "200 PFC" },
    { maxOpening: 2400, section: "200 UB 18.2" },
    { maxOpening: 2700, section: "200 UB 22.3" },
    { maxOpening: 3000, section: "250 UB 25.7" },
  ],
};

const LOAD_CASE_LABELS: Record<LoadCase, string> = {
  masonry: "Masonry above only (arching over opening)",
  single: "Masonry + single-storey roof load",
  two: "Masonry + roof + upper floor (two storey)",
};

const MIN_OPENING = 600;
const MAX_OPENING = 3000;

interface LintelResult {
  inRange: boolean;
  section: string | null;
  bearing: number | null;
  loadCase: LoadCase;
  opening: number;
}

interface Props { onBack: () => void }

const SteelLintelTool = ({ onBack }: Props) => {
  const [loadCase, setLoadCase] = useState<LoadCase>("masonry");
  const [opening, setOpening] = useState("");
  const [result, setResult] = useState<LintelResult | null>(null);

  const calculate = () => {
    const openingMm = parseFloat(opening);
    if (isNaN(openingMm)) return;

    if (openingMm < MIN_OPENING || openingMm > MAX_OPENING) {
      setResult({ inRange: false, section: null, bearing: null, loadCase, opening: openingMm });
      return;
    }

    const entry = LINTEL_TABLE[loadCase].find((e) => e.maxOpening >= openingMm);
    if (!entry) {
      setResult({ inRange: false, section: null, bearing: null, loadCase, opening: openingMm });
      return;
    }

    const bearing = openingMm > 2400 ? 230 : 150;

    setResult({ inRange: true, section: entry.section, bearing, loadCase, opening: openingMm });
  };

  return (
    <ToolLayout
      title="Steel Lintel Sizing"
      subtitle="Indicative lintel guide — 110 mm brickwork openings"
      disclaimer="Indicative sections compiled from typical Australian lintel manufacturers' published span tables for 110 mm single-leaf brickwork. This is NOT an AS 4100 structural design — bending, shear, deflection and load-width assumptions must be verified by a structural engineer or certified manufacturer tables for your exact loads. Always confirm before ordering or installing."
      onBack={onBack}
      onCalculate={calculate}
      verifyQuestion={
        result && result.inRange
          ? `What factors determine steel lintel selection for a ${result.opening} mm clear opening under "${LOAD_CASE_LABELS[result.loadCase]}" loading?`
          : undefined
      }
      result={result ? (
        result.inRange ? (
          <>
            <div className="p-3 rounded-lg mb-3 border bg-primary/5 border-primary/20">
              <p className="text-2xl font-extrabold text-primary">{result.section}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {LOAD_CASE_LABELS[result.loadCase]} · {result.opening} mm clear opening
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <ResultRow label="Section" value={result.section ?? ""} variant="primary" />
              <ResultRow label="Min bearing each end" value={result.bearing ?? ""} unit="mm" />
              <ResultRow label="Load case" value={LOAD_CASE_LABELS[result.loadCase]} size="sm" />
            </div>
            <p className="text-xs text-destructive mt-3 font-medium">
              ⚠️ Indicative only — final lintel selection must be verified by a structural engineer or
              against the lintel manufacturer's certified span tables for your exact loading.
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              💡 Galvanised lintels in exposure zones near the coast may need duplex/stainless coating —
              check the manufacturer's durability requirements.
            </p>
          </>
        ) : (
          <p className="text-xs text-destructive font-medium">
            ⚠️ Outside this guide's range — engineer design required
          </p>
        )
      ) : undefined}
    >
      <div>
        <Label className="text-sm">Load Case</Label>
        <Select value={loadCase} onValueChange={(v) => { setLoadCase(v as LoadCase); setResult(null); }}>
          <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="masonry">Masonry above only (arching over opening)</SelectItem>
            <SelectItem value="single">Masonry + single-storey roof load</SelectItem>
            <SelectItem value="two">Masonry + roof + upper floor (two storey)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-sm">Clear Opening Width (mm)</Label>
        <Input type="number" inputMode="numeric" className="h-11 mt-1" placeholder="e.g. 1800"
          value={opening} onChange={(e) => { setOpening(e.target.value); setResult(null); }} />
        <p className="text-[10px] text-muted-foreground mt-0.5">Valid range: 600–3000 mm</p>
      </div>
    </ToolLayout>
  );
};

export default SteelLintelTool;
