import { useState } from "react";
import { Label, Button } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import ToolLayout from "./ToolLayout";
import AddToProjectModal from "./AddToProjectModal";
import { saveCalculationToProject } from "./projectUtils";
import ResultRow from "./ResultRow";

type Hazard = "low" | "medium" | "high";
type Protection = "containment" | "zone" | "individual";

// Connection types → preset hazard rating.
// Presets per AS/NZS 3500.1 Cl 4.3 hazard-rating methodology, supplied by lead engineer.
// Note: Section 7 (irrigation, p.50) actually uses a 4-tier system (Types A-D),
// where Type A (outlet >150mm above ground, no ponding, no chemical injection)
// needs no backflow device at all. This tool simplifies that to a binary
// chemicals/no-chemicals split, which is conservative (may recommend a device
// an elevated Type A outlet wouldn't legally need) but never unsafe.
const CONNECTION_TYPES: { value: string; label: string; preset: Hazard }[] = [
  { value: "cooling-tower", label: "Cooling tower make-up", preset: "high" },
  { value: "fire-additives", label: "Fire system with foam/additives", preset: "high" },
  { value: "fire-plain", label: "Fire hose reel (no additives)", preset: "medium" },
  { value: "irrigation-chem", label: "Irrigation with fertiliser/chemical injection", preset: "high" },
  { value: "irrigation-plain", label: "Garden irrigation (no chemicals)", preset: "low" },
  { value: "washdown", label: "Wash-down bay / bin wash area", preset: "high" },
  { value: "process", label: "Commercial/industrial process water", preset: "high" },
  { value: "boiler", label: "Boiler feed (treated)", preset: "high" },
  { value: "hose-tap", label: "Domestic hose tap", preset: "low" },
  { value: "other", label: "Other connection", preset: "medium" },
];

const PROTECTION_LEVELS: { value: Protection; label: string }[] = [
  { value: "containment", label: "Containment (at meter/boundary)" },
  { value: "zone", label: "Zone protection" },
  { value: "individual", label: "Individual (at fixture)" },
];

// Device selection table — AS/NZS 3500.1 Table 4.1(a)/(b), verified against the standard 2026-08-10.
interface DeviceResult {
  primary: string;
  alternatives: string;
  testable: boolean;
}

const DEVICE_TABLE: Record<Hazard, DeviceResult> = {
  high: {
    primary: "Reduced Pressure Zone Device (RPZD)",
    alternatives: "Registered air gap or Registered break tank",
    testable: true,
  },
  medium: {
    primary: "Double Check Valve (DCV)",
    alternatives: "Pressure-type vacuum breaker (non-continuous pressure only)",
    testable: true,
  },
  low: {
    primary: "Dual Check Valve (non-testable)",
    alternatives: "Atmospheric vacuum breaker / hose-connection vacuum breaker",
    testable: false,
  },
};

const HAZARD_LABEL: Record<Hazard, string> = { low: "Low", medium: "Medium", high: "High" };

interface Props { onBack: () => void }

const BackflowPreventionTool = ({ onBack }: Props) => {
  const [connectionType, setConnectionType] = useState("hose-tap");
  const [hazard, setHazard] = useState<Hazard>("low");
  const [protection, setProtection] = useState<Protection>("containment");
  const [result, setResult] = useState<DeviceResult | null>(null);
  const [showProjectModal, setShowProjectModal] = useState(false);

  const handleConnectionTypeChange = (value: string) => {
    setConnectionType(value);
    const preset = CONNECTION_TYPES.find((c) => c.value === value)?.preset;
    if (preset) setHazard(preset);
    setResult(null);
  };

  const calculate = () => {
    setResult(DEVICE_TABLE[hazard]);
  };

  const connectionLabel = CONNECTION_TYPES.find((c) => c.value === connectionType)?.label ?? "";
  const protectionLabel = PROTECTION_LEVELS.find((p) => p.value === protection)?.label ?? "";

  return (
    <ToolLayout
      title="Backflow Prevention"
      subtitle="AS/NZS 3500.1 — device selection by hazard rating"
      disclaimer="Device selection per AS/NZS 3500.1 Table 4.1(a)/(b), hazard ratings per Cl 4.3 — verified against the standard. Irrigation presets are simplified from Section 7's 4-tier system; an elevated outlet may need no device at all under Type A. The network utility (water supplier) has final say on containment requirements and device registration, and hazard ratings for specific installations are determined by inspection. Always confirm against your copy of the standard and your local utility's requirements."
      onBack={onBack}
      onCalculate={calculate}
      verifyQuestion={
        result
          ? `What is the required backflow prevention device for a ${connectionLabel} connection with a ${HAZARD_LABEL[hazard]} hazard rating according to AS/NZS 3500.1?`
          : undefined
      }
      result={result ? (
        <>
          <div className="p-3 rounded-lg mb-3 border bg-primary/5 border-primary/20">
            <p className="text-sm font-extrabold text-primary">{result.primary}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {HAZARD_LABEL[hazard]} hazard · {protectionLabel}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <ResultRow
              label="Hazard rating"
              value={HAZARD_LABEL[hazard]}
              size="sm"
              variant={hazard === "high" ? "destructive" : hazard === "medium" ? "warning" : "default"}
            />
            <ResultRow
              label="Testable"
              value={result.testable ? "Yes — annual test" : "No"}
              size="sm"
              variant={result.testable ? "warning" : "default"}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Alternative devices: {result.alternatives}
          </p>
          <p className="text-[10px] text-muted-foreground mt-2">
            High = potential to cause death · Medium = potential to endanger health · Low = nuisance, does not endanger health or cause injury (AS/NZS 3500.1 Cl 4.3)
          </p>
          {result.testable && (
            <p className="text-xs text-destructive mt-3 font-medium">
              ⚠️ Testable devices require commissioning and ANNUAL testing by a licensed plumber with
              backflow accreditation.
            </p>
          )}
          {hazard === "high" && (
            <p className="text-xs text-destructive mt-3 font-medium">
              ⚠️ An RPZD discharges water — it needs a drain and must not be installed in a pit that can
              flood; keep it accessible.
            </p>
          )}
          {protection === "containment" && (
            <p className="text-xs text-muted-foreground mt-3 font-medium">
              💡 Containment protection at the boundary protects the network, but individual/zone
              protection may still be required at the fixture by the local network utility.
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
        <Label className="text-sm">Connection Type</Label>
        <Select value={connectionType} onValueChange={handleConnectionTypeChange}>
          <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {CONNECTION_TYPES.map((c) => (
              <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="text-sm">Hazard Rating</Label>
        <div className="flex gap-2 mt-1">
          {(["low", "medium", "high"] as const).map((h) => (
            <Badge key={h} variant={hazard === h ? "default" : "outline"}
              className="cursor-pointer px-3 py-1.5 text-sm"
              onClick={() => { setHazard(h); setResult(null); }}>
              {HAZARD_LABEL[h]}
            </Badge>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          Auto-set from connection type — override if the inspected hazard differs
        </p>
      </div>

      <div>
        <Label className="text-sm">Protection Level</Label>
        <Select value={protection} onValueChange={(v) => { setProtection(v as Protection); setResult(null); }}>
          <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PROTECTION_LEVELS.map((p) => (
              <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
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
            "backflow",
            "Backflow Prevention",
            {}, // Inputs - populate based on tool state
            result,
            `Backflow Prevention calculation`,
            calcLabel
          );
          setShowProjectModal(false);
        }}
        calculationSummary={result ? `Backflow Prevention` : ''}
      />
        </ToolLayout>
  );
};

export default BackflowPreventionTool;
