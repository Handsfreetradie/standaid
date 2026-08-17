import { useState } from "react";
import { Label, Button } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import ToolLayout from "./ToolLayout";
import AddToProjectModal from "./AddToProjectModal";
import { saveCalculationToProject } from "./projectUtils";
import ResultRow from "./ResultRow";

// Pure datasheet physics — no AS/NZS 5033/4777 values are embedded here.
// vocCold = Voc x (1 + coeffVoc/100 x (tMin - 25))   [coeff is negative, so a
//           cold morning (tMin < 25) pushes Voc UP — this is what can exceed
//           the inverter's max DC input and damage it]
// vmpHot  = Vmp x (1 + coeffVmp/100 x (tCellMax - 25)) [a hot cell pushes Vmp
//           DOWN — this is what can fall out of the inverter's MPPT window]
// maxPanels = floor(inverterMaxDC / vocCold), capped further by any DC system
//             voltage limit the user enters for their installation type
// minPanels = ceil(mpptMin / vmpHot)
// Method supplied by the lead engineer — do not add table values or limits.
interface PVResult {
  n: number;
  vocCold: number;
  vmpHot: number;
  maxPanels: number;
  minPanels: number;
  stringVocCold: number;
  stringVmpHot: number;
  inverterMaxDC: number;
  mpptMin: number;
  dcLimit: number | null;
  tMin: number;
  tCellMax: number;
  pass: boolean;
  exceedsInverterMax: boolean;
  exceedsLimit: boolean;
  underVoltage: boolean;
  noWindowFits: boolean;
}

interface Props { onBack: () => void }

const PVStringSizingTool = ({ onBack }: Props) => {
  // Panel (module datasheet)
  const [vocStc, setVocStc] = useState("");
  const [vmpStc, setVmpStc] = useState("");
  const [coeffVoc, setCoeffVoc] = useState("");
  const [coeffVmp, setCoeffVmp] = useState("");

  // Inverter (inverter datasheet)
  const [inverterMaxDC, setInverterMaxDC] = useState("");
  const [mpptMin, setMpptMin] = useState("");

  // Site
  const [tMin, setTMin] = useState("0");
  const [tCellMax, setTCellMax] = useState("70");

  // Design
  const [panelsPerString, setPanelsPerString] = useState("");

  // Advanced
  const [dcLimit, setDcLimit] = useState("");

  const [result, setResult] = useState<PVResult | null>(null);
  const [showProjectModal, setShowProjectModal] = useState(false);

  const clearResult = () => setResult(null);

  const calculate = () => {
    const voc = parseFloat(vocStc);
    const vmp = parseFloat(vmpStc);
    const cVoc = parseFloat(coeffVoc);
    const cVmp = parseFloat(coeffVmp);
    const invMax = parseFloat(inverterMaxDC);
    const mppt = parseFloat(mpptMin);
    const tMinVal = parseFloat(tMin);
    const tCellMaxVal = parseFloat(tCellMax);
    const n = parseInt(panelsPerString, 10);
    const limitVal = dcLimit.trim() === "" ? null : parseFloat(dcLimit);

    if (isNaN(voc) || voc < 10 || voc > 100) return;
    if (isNaN(vmp) || vmp < 10 || vmp > 100 || vmp >= voc) return;
    if (isNaN(cVoc) || cVoc < -1 || cVoc > 0) return;
    if (isNaN(cVmp) || cVmp < -1 || cVmp > 0) return;
    if (isNaN(invMax) || invMax < 100 || invMax > 2000) return;
    if (isNaN(mppt) || mppt < 50 || mppt > 1500 || mppt >= invMax) return;
    if (isNaN(tMinVal) || tMinVal < -20 || tMinVal > 25) return;
    if (isNaN(tCellMaxVal) || tCellMaxVal < 40 || tCellMaxVal > 90) return;
    if (isNaN(n) || n < 1 || n > 40) return;
    if (limitVal !== null && (isNaN(limitVal) || limitVal <= 0)) return;

    const vocCold = voc * (1 + (cVoc / 100) * (tMinVal - 25));
    const vmpHot = vmp * (1 + (cVmp / 100) * (tCellMaxVal - 25));

    const maxPanelsInverter = Math.floor(invMax / vocCold);
    const maxPanelsLimit = limitVal !== null ? Math.floor(limitVal / vocCold) : Infinity;
    const maxPanels = Math.min(maxPanelsInverter, maxPanelsLimit);
    const minPanels = Math.ceil(mppt / vmpHot);

    const stringVocCold = n * vocCold;
    const stringVmpHot = n * vmpHot;

    const exceedsInverterMax = stringVocCold > invMax;
    const exceedsLimit = limitVal !== null && stringVocCold > limitVal;
    const underVoltage = stringVmpHot < mppt;
    const noWindowFits = minPanels > maxPanels;

    const pass = !noWindowFits && n <= maxPanels && n >= minPanels && !exceedsLimit;

    setResult({
      n,
      vocCold,
      vmpHot,
      maxPanels,
      minPanels,
      stringVocCold,
      stringVmpHot,
      inverterMaxDC: invMax,
      mpptMin: mppt,
      dcLimit: limitVal,
      tMin: tMinVal,
      tCellMax: tCellMaxVal,
      pass,
      exceedsInverterMax,
      exceedsLimit,
      underVoltage,
      noWindowFits,
    });
  };

  return (
    <ToolLayout
      title="PV String Sizing"
      subtitle="Temperature-corrected string voltage vs inverter window"
      disclaimer="Pure datasheet physics: string voltages temperature-corrected with the module's own coefficients and compared against the inverter's datasheet window. Installation requirements (DC voltage limits by installation type, cabling, isolation, earthing, signage) come from AS/NZS 5033 and AS/NZS 4777 — this tool deliberately embeds none of them; verify against your copies of the standards."
      onBack={onBack}
      onCalculate={calculate}
      verifyQuestion={
        result
          ? `What does AS/NZS 5033 require for a PV array with a maximum string open-circuit voltage of ${result.stringVocCold.toFixed(0)} V on a residential installation?`
          : undefined
      }
      result={result ? (
        <>
          <div className={`p-3 rounded-lg mb-3 border ${
            result.pass ? "bg-primary/5 border-primary/20" : "bg-destructive/5 border-destructive/20"
          }`}>
            <p className={`text-sm font-extrabold ${result.pass ? "text-primary" : "text-destructive"}`}>
              {result.pass ? `String OK — ${result.n} panels` : "String outside window"}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              cold Voc {result.stringVocCold.toFixed(1)} V · hot Vmp {result.stringVmpHot.toFixed(1)} V
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-3">
            <ResultRow label="Allowed panels per string" value={`${result.minPanels}–${result.maxPanels}`} variant="primary" />
            <ResultRow label={`String Voc at ${result.tMin}°C`} value={result.stringVocCold.toFixed(1)} unit="V"
              variant={result.exceedsInverterMax || result.exceedsLimit ? "destructive" : "default"} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <ResultRow label={`String Vmp at ${result.tCellMax}°C`} value={result.stringVmpHot.toFixed(1)} unit="V"
              variant={result.underVoltage ? "destructive" : "default"} />
            <ResultRow label="Inverter window" value={`${result.mpptMin}–${result.inverterMaxDC} V`} size="sm" />
          </div>

          {result.exceedsInverterMax && (
            <p className="text-xs text-destructive mt-3 font-medium">
              ⚠️ Cold-morning Voc exceeds the inverter's max DC input — reduce panels per string. Exceeding it can
              destroy the inverter and void warranty.
            </p>
          )}
          {result.underVoltage && (
            <p className="text-xs text-destructive mt-3 font-medium">
              ⚠️ Hot-day Vmp falls below the MPPT window — add panels per string or the inverter will drop out on
              hot afternoons.
            </p>
          )}
          {result.exceedsLimit && (
            <p className="text-xs text-destructive mt-3 font-medium">
              ⚠️ String Voc exceeds the DC system voltage limit you entered for this installation type.
            </p>
          )}
          {result.noWindowFits && (
            <p className="text-xs text-destructive mt-3 font-medium">
              ⚠️ No string length fits this panel/inverter combination across your temperature range — different
              inverter or panel needed.
            </p>
          )}

          <p className="text-xs text-muted-foreground mt-3">
            💡 Voc rises as temperature falls — the cold-morning check protects the inverter; the hot-day check
            keeps the MPPT running.
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            💡 Datasheet maths only — array cabling, isolation, earthing and signage requirements come from
            AS/NZS 5033: check your uploaded copy.
          </p>
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
      advancedInputs={
        <div>
          <Label className="text-sm">Maximum DC System Voltage Limit (V)</Label>
          <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="optional"
            value={dcLimit} onChange={(e) => { setDcLimit(e.target.value); clearResult(); }} />
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Any limit that applies to your installation type per your copy of AS/NZS 5033 (e.g. domestic dwellings
            have a specific DC voltage cap) — check the standard
          </p>
        </div>
      }
    >
      {/* Panel */}
      <div>
        <Label className="text-sm font-bold">Panel (module datasheet)</Label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-sm">Voc STC (V)</Label>
          <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="e.g. 41.0"
            value={vocStc} onChange={(e) => { setVocStc(e.target.value); clearResult(); }} />
          <p className="text-[10px] text-muted-foreground mt-0.5">Valid range 10–100 V</p>
        </div>
        <div>
          <Label className="text-sm">Vmp STC (V)</Label>
          <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="e.g. 34.5"
            value={vmpStc} onChange={(e) => { setVmpStc(e.target.value); clearResult(); }} />
          <p className="text-[10px] text-muted-foreground mt-0.5">Must be less than Voc</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-sm">Temp coeff. of Voc (%/°C)</Label>
          <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="-0.28"
            value={coeffVoc} onChange={(e) => { setCoeffVoc(e.target.value); clearResult(); }} />
          <p className="text-[10px] text-muted-foreground mt-0.5">Valid range −1 to 0</p>
        </div>
        <div>
          <Label className="text-sm">Temp coeff. of Vmp/Pmax (%/°C)</Label>
          <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="-0.35"
            value={coeffVmp} onChange={(e) => { setCoeffVmp(e.target.value); clearResult(); }} />
          <p className="text-[10px] text-muted-foreground mt-0.5">Valid range −1 to 0</p>
        </div>
      </div>

      {/* Inverter */}
      <div>
        <Label className="text-sm font-bold">Inverter (inverter datasheet)</Label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-sm">Max DC input voltage (V)</Label>
          <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="e.g. 600"
            value={inverterMaxDC} onChange={(e) => { setInverterMaxDC(e.target.value); clearResult(); }} />
          <p className="text-[10px] text-muted-foreground mt-0.5">Valid range 100–2000 V</p>
        </div>
        <div>
          <Label className="text-sm">MPPT minimum voltage (V)</Label>
          <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="e.g. 200"
            value={mpptMin} onChange={(e) => { setMpptMin(e.target.value); clearResult(); }} />
          <p className="text-[10px] text-muted-foreground mt-0.5">Must be less than max DC input</p>
        </div>
      </div>

      {/* Site */}
      <div>
        <Label className="text-sm font-bold">Site</Label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-sm">Minimum ambient temp. (°C)</Label>
          <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="0"
            value={tMin} onChange={(e) => { setTMin(e.target.value); clearResult(); }} />
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Coldest expected morning temperature at the site; panels can reach ambient at dawn
          </p>
        </div>
        <div>
          <Label className="text-sm">Maximum cell temp. (°C)</Label>
          <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder="70"
            value={tCellMax} onChange={(e) => { setTCellMax(e.target.value); clearResult(); }} />
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Cell temperature on a hot day, typically ambient + 25–30 °C
          </p>
        </div>
      </div>

      {/* Design */}
      <div>
        <Label className="text-sm font-bold">Design</Label>
      </div>
      <div>
        <Label className="text-sm">Panels per string</Label>
        <Input type="number" inputMode="numeric" className="h-11 mt-1" placeholder="e.g. 10"
          value={panelsPerString} onChange={(e) => { setPanelsPerString(e.target.value); clearResult(); }} />
        <p className="text-[10px] text-muted-foreground mt-0.5">Valid range 1–40</p>
      </div>

      <AddToProjectModal
        isOpen={showProjectModal}
        onClose={() => setShowProjectModal(false)}
        onSave={(projectId, projectName, calcLabel) => {
          saveCalculationToProject(
            projectId,
            projectName,
            "pv-string",
            "PV String Sizing",
            {}, // Inputs - populate based on tool state
            result,
            `PV String Sizing calculation`,
            calcLabel
          );
          setShowProjectModal(false);
        }}
        calculationSummary={result ? `PV String Sizing` : ''}
      />
        </ToolLayout>
  );
};

export default PVStringSizingTool;
