import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import ToolLayout from "./ToolLayout";
import ResultRow from "./ResultRow";

// Simplified heat load factors per m² (W/m²) based on AU climate zones
const CLIMATE_ZONES: Record<string, { label: string; coolingFactor: number; heatingFactor: number }> = {
  "tropical": { label: "Tropical (Darwin, Cairns)", coolingFactor: 180, heatingFactor: 0 },
  "subtropical": { label: "Subtropical (Brisbane)", coolingFactor: 150, heatingFactor: 60 },
  "temperate": { label: "Temperate (Sydney)", coolingFactor: 130, heatingFactor: 90 },
  "cool": { label: "Cool (Melbourne)", coolingFactor: 100, heatingFactor: 120 },
  "cold": { label: "Cold (Canberra, Hobart)", coolingFactor: 80, heatingFactor: 150 },
};

const INSULATION: Record<string, { label: string; factor: number }> = {
  "none": { label: "No insulation", factor: 1.4 },
  "ceiling": { label: "Ceiling batts only", factor: 1.1 },
  "ceiling-wall": { label: "Ceiling + wall insulation", factor: 0.9 },
  "full": { label: "Fully insulated (inc. floor)", factor: 0.75 },
};

const WINDOW_FACTOR: Record<string, { label: string; factor: number }> = {
  "small": { label: "Small windows (<15% wall)", factor: 0.9 },
  "standard": { label: "Standard windows", factor: 1.0 },
  "large": { label: "Large windows / glazing", factor: 1.25 },
  "floor-ceiling": { label: "Floor-to-ceiling glass", factor: 1.5 },
};

interface HeatResult {
  coolingKw: number;
  heatingKw: number;
  coolingBtu: number;
  heatingBtu: number;
  recommendedCooling: string;
  recommendedHeating: string;
  warnings: string[];
}

interface Props { onBack: () => void }

const HeatLoadTool = ({ onBack }: Props) => {
  const [floorArea, setFloorArea] = useState("");
  const [ceilingHeight, setCeilingHeight] = useState("2.7");
  const [climate, setClimate] = useState("temperate");
  const [insulation, setInsulation] = useState("ceiling");
  const [windows, setWindows] = useState("standard");
  const [occupants, setOccupants] = useState("2");
  const [result, setResult] = useState<HeatResult | null>(null);

  const calculate = () => {
    const area = parseFloat(floorArea);
    const height = parseFloat(ceilingHeight);
    if (isNaN(area) || area <= 0) return;

    const cz = CLIMATE_ZONES[climate];
    const ins = INSULATION[insulation];
    const win = WINDOW_FACTOR[windows];
    if (!cz || !ins || !win) return;

    const heightFactor = height > 2.7 ? 1 + (height - 2.7) * 0.15 : 1.0;
    const occupantLoad = (parseInt(occupants) || 2) * 75; // W per person

    const coolingW = area * cz.coolingFactor * ins.factor * win.factor * heightFactor + occupantLoad;
    const heatingW = area * cz.heatingFactor * ins.factor * heightFactor;

    const coolingKw = Math.round(coolingW / 100) / 10;
    const heatingKw = Math.round(heatingW / 100) / 10;
    const coolingBtu = Math.round(coolingW * 3.412);
    const heatingBtu = Math.round(heatingW * 3.412);

    // System sizing recommendations
    const systemSizes = [2.5, 3.5, 5.0, 7.1, 8.0, 10.0, 12.5, 14.0, 16.0, 20.0];
    const recommendedCooling = systemSizes.find(s => s >= coolingKw) || systemSizes[systemSizes.length - 1];
    const recommendedHeating = systemSizes.find(s => s >= heatingKw) || systemSizes[systemSizes.length - 1];

    const warnings: string[] = [];
    if (coolingKw > 14) warnings.push("Large cooling load — consider split ducted or multiple units.");
    if (area > 200) warnings.push("Large floor area — zoning recommended for efficiency.");

    setResult({
      coolingKw,
      heatingKw,
      coolingBtu,
      heatingBtu,
      recommendedCooling: `${recommendedCooling} kW`,
      recommendedHeating: `${recommendedHeating} kW`,
      warnings,
    });
  };

  return (
    <ToolLayout
      title="Heat Load Estimator"
      subtitle="Estimate cooling & heating capacity for spaces"
      disclaimer="Simplified estimate based on area, climate, and insulation factors. For accurate sizing use AS/NZS 5149 or manufacturer load calculation software. Does not account for orientation, shading, or internal equipment loads."
      onBack={onBack}
      onCalculate={calculate}
      result={result ? (
        <>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="p-3 rounded-lg border bg-blue-500/5 border-blue-500/20">
              <p className="text-2xl font-extrabold text-blue-600">{result.coolingKw} kW</p>
              <p className="text-[10px] text-muted-foreground">Cooling ({result.coolingBtu.toLocaleString()} BTU)</p>
            </div>
            <div className="p-3 rounded-lg border bg-orange-500/5 border-orange-500/20">
              <p className="text-2xl font-extrabold text-orange-600">{result.heatingKw} kW</p>
              <p className="text-[10px] text-muted-foreground">Heating ({result.heatingBtu.toLocaleString()} BTU)</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="p-2 rounded-lg bg-muted">
              <p className="text-xs text-foreground">❄️ Rec. unit: <span className="font-bold">{result.recommendedCooling}</span></p>
            </div>
            <div className="p-2 rounded-lg bg-muted">
              <p className="text-xs text-foreground">🔥 Rec. unit: <span className="font-bold">{result.recommendedHeating}</span></p>
            </div>
          </div>
          {result.warnings.map((w, i) => (
            <p key={i} className="text-xs text-destructive mt-2 font-medium">⚠️ {w}</p>
          ))}
        </>
      ) : undefined}
      advancedInputs={
        <>
          <div>
            <Label className="text-sm">Ceiling Height (m)</Label>
            <Input type="number" inputMode="decimal" className="h-11 mt-1" value={ceilingHeight}
              onChange={(e) => setCeilingHeight(e.target.value)} />
          </div>
          <div>
            <Label className="text-sm">Occupants</Label>
            <Input type="number" inputMode="numeric" className="h-11 mt-1" value={occupants}
              onChange={(e) => setOccupants(e.target.value)} />
          </div>
          <div>
            <Label className="text-sm">Windows</Label>
            <Select value={windows} onValueChange={(v) => { setWindows(v); setResult(null); }}>
              <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(WINDOW_FACTOR).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      }
    >
      <div>
        <Label className="text-sm">Floor Area (m²)</Label>
        <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="e.g. 65"
          value={floorArea} onChange={(e) => setFloorArea(e.target.value)} />
      </div>
      <div>
        <Label className="text-sm">Climate Zone</Label>
        <Select value={climate} onValueChange={(v) => { setClimate(v); setResult(null); }}>
          <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(CLIMATE_ZONES).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-sm">Insulation Level</Label>
        <Select value={insulation} onValueChange={(v) => { setInsulation(v); setResult(null); }}>
          <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(INSULATION).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label} (×{v.factor})</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </ToolLayout>
  );
};

export default HeatLoadTool;
