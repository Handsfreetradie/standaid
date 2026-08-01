import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ToolLayout from "./ToolLayout";
import ResultRow from "./ResultRow";

// Rates per AS 1668.2 (mechanical ventilation) as supplied by lead engineer —
// commonly used values; confirm the clause/table for the specific application.
// "category" drives the hero wording (exhaust vs outside air) and which
// quantity input is shown; "note" room types are outside this tool's scope
// and are not calculated.
interface RoomType {
  label: string;
  category: "exhaust" | "outside-air" | "note";
  rate?: number; // L/s per unit
  quantityLabel?: string;
  unitSuffix?: string;
  note?: string;
}

const ROOM_TYPES: Record<string, RoomType> = {
  office: {
    label: "Office / general occupiable space",
    category: "outside-air",
    rate: 10,
    quantityLabel: "Number of occupants",
    unitSuffix: "people",
  },
  toilet: {
    label: "Toilets / sanitary compartments",
    category: "exhaust",
    rate: 25,
    quantityLabel: "Number of pans / urinals",
    unitSuffix: "fixtures",
  },
  shower: {
    label: "Shower / change rooms",
    category: "exhaust",
    rate: 25,
    quantityLabel: "Number of shower heads",
    unitSuffix: "showers",
  },
  cleaner: {
    label: "Cleaner's room / store",
    category: "exhaust",
    rate: 5,
    quantityLabel: "Floor area (m²)",
    unitSuffix: "m²",
  },
  garbage: {
    label: "Garbage / waste room",
    category: "exhaust",
    rate: 5,
    quantityLabel: "Floor area (m²)",
    unitSuffix: "m²",
  },
  "kitchen-note": {
    label: "Commercial kitchen (hood exhaust)",
    category: "note",
    note: "Commercial kitchen hoods are sized by hood face velocity and appliance duty under AS 1668.2 Section 3 — outside this tool's scope.",
  },
  "carpark-note": {
    label: "Car park",
    category: "note",
    note: "Car park ventilation uses the AS 1668.2 car-park method (usage, exposure, CO limits) — outside this tool's scope.",
  },
};

// Standard round duct sizes — same series as DuctSizingTool so the two tools agree.
const STANDARD_ROUND_SIZES = [100, 125, 150, 175, 200, 225, 250, 300, 350, 400, 450, 500, 600];

const VELOCITIES: Record<string, string> = {
  "3": "Low noise",
  "5": "Default",
  "7": "Compact riser",
};

interface VentResult {
  roomKey: string;
  roomLabel: string;
  category: "exhaust" | "outside-air";
  quantity: number;
  unitSuffix: string;
  flowLps: number;
  velocity: number;
  ductDiameter: number | null;
  ach: number | null;
}

interface Props { onBack: () => void }

const VentilationSizingTool = ({ onBack }: Props) => {
  const [roomKey, setRoomKey] = useState("office");
  const [quantity, setQuantity] = useState("");
  const [floorArea, setFloorArea] = useState("");
  const [ceilingHeight, setCeilingHeight] = useState("");
  const [velocity, setVelocity] = useState("5");
  const [result, setResult] = useState<VentResult | null>(null);

  const room = ROOM_TYPES[roomKey];

  const calculate = () => {
    if (room.category === "note" || !room.rate) return;

    const qty = parseFloat(quantity);
    if (isNaN(qty) || qty <= 0 || qty > 10000) return;

    const targetVelocity = parseFloat(velocity) || 5;
    const flowLps = Math.round(room.rate * qty * 10) / 10;

    // Round duct: area A (m²) = Q (m³/s) / velocity (m/s); d = sqrt(4A/π) in mm
    const flowM3s = flowLps / 1000;
    const diamM = Math.sqrt((4 * (flowM3s / targetVelocity)) / Math.PI);
    const diamMm = diamM * 1000;
    const ductDiameter = STANDARD_ROUND_SIZES.find((d) => d >= diamMm) ?? null;

    let ach: number | null = null;
    const area = parseFloat(floorArea);
    const height = parseFloat(ceilingHeight);
    if (!isNaN(area) && area > 0 && !isNaN(height) && height > 0) {
      ach = Math.round(((flowLps * 3.6) / (area * height)) * 10) / 10;
    }

    setResult({
      roomKey,
      roomLabel: room.label,
      category: room.category as "exhaust" | "outside-air",
      quantity: qty,
      unitSuffix: room.unitSuffix ?? "",
      flowLps,
      velocity: targetVelocity,
      ductDiameter,
      ach,
    });
  };

  return (
    <ToolLayout
      title="Ventilation Sizing"
      subtitle="AS 1668.2 — exhaust & outside-air flow rates"
      disclaimer="Flow rates from commonly applied AS 1668.2 requirements (10 L/s per person outside air for occupiable spaces; 25 L/s per sanitary fixture/shower; 5 L/s·m² for cleaner and garbage rooms). AS 1668.2 has detailed conditions, alternative methods and exceptions per application — confirm the applicable clause and any NCC referencing before relying on these figures. Always confirm against your copy of the standard."
      onBack={onBack}
      onCalculate={calculate}
      verifyQuestion={
        result
          ? `What is the required ventilation rate for a ${result.roomLabel} under AS 1668.2?`
          : undefined
      }
      result={result ? (
        <>
          <div className="p-3 rounded-lg mb-3 border bg-primary/5 border-primary/20">
            <p className="text-sm font-extrabold text-primary">
              {result.flowLps} L/s {result.category === "exhaust" ? "exhaust" : "outside air"}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {result.roomLabel} • {result.quantity} {result.unitSuffix}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <ResultRow label="Required flow" value={result.flowLps} unit="L/s" variant="primary" />
            <ResultRow
              label="Suggested round duct"
              value={result.ductDiameter ? `⌀${result.ductDiameter}` : "—"}
              unit={result.ductDiameter ? "mm" : undefined}
            />
            <ResultRow label="Duct velocity" value={result.velocity} unit="m/s" size="sm" />
            {result.ach !== null && (
              <ResultRow label="Air changes per hour" value={result.ach} unit="ACH" size="sm" />
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-3 font-medium">
            💡 Select the fan for {result.flowLps} L/s at the system's total static pressure —
            duct length, bends and filters set the pressure, not this tool.
          </p>
          {result.ductDiameter === null && (
            <p className="text-xs text-destructive mt-3 font-medium">
              ⚠️ Flow needs multiple ducts or a rectangular duct — split the run or size per AS 1668.2.
            </p>
          )}
        </>
      ) : undefined}
      advancedInputs={
        <>
          <div>
            <Label className="text-sm">Room Floor Area (m²)</Label>
            <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="Optional — for ACH"
              value={floorArea} onChange={(e) => { setFloorArea(e.target.value); setResult(null); }} />
          </div>
          <div>
            <Label className="text-sm">Ceiling Height (m)</Label>
            <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="Optional — for ACH"
              value={ceilingHeight} onChange={(e) => { setCeilingHeight(e.target.value); setResult(null); }} />
          </div>
          <div>
            <Label className="text-sm">Target Duct Velocity</Label>
            <Select value={velocity} onValueChange={(v) => { setVelocity(v); setResult(null); }}>
              <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(VELOCITIES).map(([k, label]) => (
                  <SelectItem key={k} value={k}>{k} m/s — {label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      }
    >
      <div>
        <Label className="text-sm">Room Type</Label>
        <Select value={roomKey} onValueChange={(v) => { setRoomKey(v); setQuantity(""); setResult(null); }}>
          <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(ROOM_TYPES).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {room.category === "note" ? (
        <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
          {room.note}
        </p>
      ) : (
        <div>
          <Label className="text-sm">{room.quantityLabel}</Label>
          <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="e.g. 10"
            value={quantity} onChange={(e) => { setQuantity(e.target.value); setResult(null); }} />
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {room.rate} L/s per {room.unitSuffix === "m²" ? "m²" : room.unitSuffix === "people" ? "person" : room.unitSuffix?.replace(/s$/, "")}
          </p>
        </div>
      )}
    </ToolLayout>
  );
};

export default VentilationSizingTool;
