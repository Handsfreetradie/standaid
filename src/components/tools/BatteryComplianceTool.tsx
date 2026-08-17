import { useState } from "react";
import { Label, Button } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ToolLayout from "./ToolLayout";
import AddToProjectModal from "./AddToProjectModal";
import { saveCalculationToProject } from "./projectUtils";
import ResultRow from "./ResultRow";

// Location screening categories reflecting AS/NZS 5139's structure as supplied
// by lead engineer — deliberately contains NO clearance values or clause
// numbers; the user's own copy of the standard supplies those.
type Chemistry = "li" | "vla" | "vrla" | "flow" | "other";
type Location = "garage" | "external-wall" | "plant-room" | "outdoors" | "habitable" | "ceiling-under-stairs";
type Surface = "non-combustible" | "combustible" | "na";
type Verdict = "restricted" | "conditional";

const CHEMISTRY_LABEL: Record<Chemistry, string> = {
  li: "Lithium-ion (incl. LFP)",
  vla: "Lead-acid — vented",
  vrla: "Lead-acid — sealed (VRLA/AGM/gel)",
  flow: "Flow battery",
  other: "Other",
};

const LOCATION_LABEL: Record<Location, string> = {
  garage: "Garage (attached to dwelling)",
  "external-wall": "External wall of dwelling",
  "plant-room": "Dedicated plant/battery room",
  outdoors: "Outdoors — freestanding structure",
  habitable: "Inside a habitable room",
  "ceiling-under-stairs": "Roof space / under stairs / wall cavity",
};

const SURFACE_LABEL: Record<Surface, string> = {
  "non-combustible": "Non-combustible",
  combustible: "Combustible (timber frame, cladding)",
  na: "N/A — freestanding",
};

const RESTRICTED_LOCATIONS: Location[] = ["habitable", "ceiling-under-stairs"];

const CHECKLIST_ITEMS = [
  { key: "zones", label: "Restricted location check", desc: "Distances from doors, windows, exits, and adjoining habitable rooms" },
  { key: "mounting", label: "Mounting surface", desc: "Barrier/fire-rating requirements where the surface or nearby wall is combustible" },
  { key: "ventilation", label: "Ventilation", desc: "Chemistry-dependent" },
  { key: "signage", label: "Signage & emergency info", desc: "Required signs and shutdown documentation" },
  { key: "mechanical", label: "Protection from mechanical damage", desc: "Vehicle impact in garages" },
  { key: "ip", label: "IP rating & sun exposure", desc: "" },
  { key: "docs", label: "System documentation", desc: "Commissioning records the installer must leave on site" },
] as const;

interface Props { onBack: () => void }

interface Result {
  chemistry: Chemistry;
  capacity: number;
  location: Location;
  surface: Surface;
  verdict: Verdict;
}

const BatteryComplianceTool = ({ onBack }: Props) => {
  const [chemistry, setChemistry] = useState<Chemistry>("li");
  const [capacity, setCapacity] = useState("");
  const [location, setLocation] = useState<Location>("garage");
  const [surface, setSurface] = useState<Surface>("non-combustible");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showProjectModal, setShowProjectModal] = useState(false);

  const calculate = () => {
    setError(null);
    const cap = parseFloat(capacity);
    if (!capacity || isNaN(cap)) {
      setError("Enter the usable capacity in kWh.");
      return;
    }
    if (cap < 0.5 || cap > 200) {
      setError("Usable capacity must be between 0.5 and 200 kWh.");
      return;
    }

    const verdict: Verdict = RESTRICTED_LOCATIONS.includes(location) ? "restricted" : "conditional";

    setResult({ chemistry, capacity: cap, location, surface, verdict });
  };

  const verifyQuestion = result
    ? `What are the restricted location and clearance zone requirements in AS/NZS 5139 for a ${CHEMISTRY_LABEL[result.chemistry]} battery installed at: ${LOCATION_LABEL[result.location]}?`
    : undefined;

  return (
    <ToolLayout
      title="Battery Install Checker"
      subtitle="AS/NZS 5139 location & requirements screening"
      disclaimer="Pre-installation screening only, reflecting the structure of AS/NZS 5139 (locations, restricted zones, barriers, ventilation, signage). It deliberately contains no clearance distances or clause values — those are copyrighted and vary by edition: pull them from your own uploaded copy of the standard, and have the design verified before installation."
      onBack={onBack}
      onCalculate={calculate}
      verifyQuestion={verifyQuestion}
      result={result ? (
        <>
          {result.verdict === "restricted" ? (
            <div className="p-3 rounded-lg mb-3 border bg-destructive/5 border-destructive/20">
              <p className="text-sm font-extrabold text-destructive">
                Location likely NOT permitted
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {CHEMISTRY_LABEL[result.chemistry]} · {result.capacity} kWh · {LOCATION_LABEL[result.location]}
              </p>
            </div>
          ) : (
            <div className="p-3 rounded-lg mb-3 border bg-primary/5 border-primary/20">
              <p className="text-sm font-extrabold text-primary">
                Location possible — verify restricted zones
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {CHEMISTRY_LABEL[result.chemistry]} · {result.capacity} kWh · {LOCATION_LABEL[result.location]}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <ResultRow
              label="Verdict"
              value={result.verdict === "restricted" ? "Restricted" : "Conditional — verify zones"}
              variant={result.verdict === "restricted" ? "destructive" : "primary"}
            />
            <ResultRow label="Chemistry" value={CHEMISTRY_LABEL[result.chemistry]} size="sm" />
            <ResultRow label="Capacity" value={result.capacity} unit="kWh" size="sm" />
          </div>

          {result.verdict === "restricted" ? (
            <>
              <p className="text-xs text-destructive mt-3 font-medium">
                ⚠️ AS/NZS 5139 heavily restricts battery systems in habitable rooms, ceiling spaces,
                wall cavities and under stairways or escape routes. Choose a different location, then
                confirm the restriction wording in your copy of the standard.
              </p>
              <p className="text-xs text-muted-foreground mt-3">
                💡 Tap 'Verify with AI' below to pull the actual clearance and zone dimensions from
                YOUR uploaded copy of AS/NZS 5139 — this tool deliberately doesn't embed them.
              </p>
            </>
          ) : (
            <>
              <div className="mt-4 space-y-3">
                {CHECKLIST_ITEMS.map((item) => (
                  <div key={item.key}>
                    <p className="text-sm font-bold text-foreground">{item.label}</p>
                    {item.desc && <p className="text-xs text-muted-foreground">{item.desc}</p>}
                    {item.key === "mounting" && surface === "combustible" && (
                      <p className="text-xs text-destructive mt-1 font-medium">
                        ⚠️ Combustible surface selected — a non-combustible barrier requirement almost
                        certainly applies; check its required extent in your copy.
                      </p>
                    )}
                    {item.key === "ventilation" && chemistry === "vla" && (
                      <p className="text-xs text-destructive mt-1 font-medium">
                        ⚠️ Vented lead-acid gases hydrogen on charge — dedicated ventilation sizing is
                        mandatory; check the method in your copy.
                      </p>
                    )}
                    {item.key === "mechanical" && location === "garage" && (
                      <p className="text-xs text-destructive mt-1 font-medium">
                        ⚠️ Garage install — vehicle impact protection (bollard/barrier or height
                        mounting) requirements apply.
                      </p>
                    )}
                    {item.key === "ip" && location === "outdoors" && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Outdoors — check enclosure IP and shading requirements against the
                        manufacturer's specs.
                      </p>
                    )}
                  </div>
                ))}
              </div>

              {result.capacity > 100 && (
                <p className="text-xs text-destructive mt-3 font-medium">
                  ⚠️ Above typical residential scale — additional requirements and possibly a
                  different standards pathway apply; this screening is residential-scale only.
                </p>
              )}

              <p className="text-xs text-muted-foreground mt-3">
                💡 Tap 'Verify with AI' below to pull the actual clearance and zone dimensions from
                YOUR uploaded copy of AS/NZS 5139 — this tool deliberately doesn't embed them.
              </p>
            </>
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
        <Label className="text-sm">Battery Chemistry</Label>
        <Select value={chemistry} onValueChange={(v) => { setChemistry(v as Chemistry); setResult(null); }}>
          <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(CHEMISTRY_LABEL) as Chemistry[]).map((c) => (
              <SelectItem key={c} value={c}>{CHEMISTRY_LABEL[c]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-sm">Usable Capacity (kWh)</Label>
        <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="e.g. 13.5"
          value={capacity} onChange={(e) => { setCapacity(e.target.value); setResult(null); setError(null); }} />
        <p className="text-[10px] text-muted-foreground mt-0.5">Valid range 0.5–200 kWh</p>
        {error && <p className="text-xs text-destructive mt-1 font-medium">{error}</p>}
      </div>
      <div>
        <Label className="text-sm">Proposed Location</Label>
        <Select value={location} onValueChange={(v) => { setLocation(v as Location); setResult(null); }}>
          <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(LOCATION_LABEL) as Location[]).map((l) => (
              <SelectItem key={l} value={l}>{LOCATION_LABEL[l]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-sm">Wall/Mounting Surface</Label>
        <div className="flex flex-wrap gap-2 mt-1">
          {(Object.keys(SURFACE_LABEL) as Surface[]).map((s) => (
            <Badge key={s} variant={surface === s ? "default" : "outline"}
              className="cursor-pointer px-3 py-1.5 text-sm"
              onClick={() => { setSurface(s); setResult(null); }}>
              {SURFACE_LABEL[s]}
            </Badge>
          ))}
        </div>
      </div>

      <AddToProjectModal
        isOpen={showProjectModal}
        onClose={() => setShowProjectModal(false)}
        onSave={(projectId, projectName, calcLabel) => {
          saveCalculationToProject(
            projectId,
            projectName,
            "battery-check",
            "Battery Compliance",
            {}, // Inputs - populate based on tool state
            result,
            `Battery Compliance calculation`,
            calcLabel
          );
          setShowProjectModal(false);
        }}
        calculationSummary={result ? `Battery Compliance` : ''}
      />
        </ToolLayout>
  );
};

export default BatteryComplianceTool;
