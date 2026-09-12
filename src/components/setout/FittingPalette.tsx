import { useState } from "react";
import { Trash2, Check, RotateCcw, RotateCw, Lock, Unlock, X, Settings2, ChevronUp, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useProfile } from "@/hooks/useData";
import { useUpdateSetoutQuickPicks } from "@/hooks/useSetoutQuickPicks";
import { cn } from "@/lib/utils";
import { FITTING_LABELS, FITTING_SYMBOLS, type FittingType } from "@/components/setout/symbols";
import { BEAM_ANGLE_OPTIONS, DEFAULT_BEAM_ANGLE, DEFAULT_MOUNTING_HEIGHT, defaultHeightForType } from "@/lib/setoutGeometry";
import { fromMm, toMm } from "@/lib/units";
import {
  CATEGORY_FOR_TYPE,
  FITTING_CATEGORY_ORDER,
  LAYER_LABELS,
  isSingleWallFitting,
  type FittingSpecs,
  type FittingStatus,
  type MeasurementLock,
  type MeasurementRef,
  type SetoutCircuit,
  type SetoutFitting, measurementRefId,
  DEFAULT_TWIN_SPACING_MM,
  DEFAULT_WIFI_RANGE_M,
} from "@/lib/setoutTypes";
import { pathLength } from "@/lib/setoutPathGeometry";
import { DEFAULT_EXTRUSION_STOCK_LENGTH_M, DEFAULT_LED_WATTS_PER_METRE } from "@/lib/setoutMaterials";
import { CABLE_TYPES, type CableMaterial } from "@/components/tools/electricalData";

const FITTING_TYPES = Object.keys(FITTING_SYMBOLS) as FittingType[];
const TYPES_BY_CATEGORY = FITTING_CATEGORY_ORDER.map((category) => ({
  category,
  types: FITTING_TYPES.filter((type) => CATEGORY_FOR_TYPE[type] === category),
})).filter((group) => group.types.length > 0);

const DOWNLIGHT_SIZE_OPTIONS = [100, 90, 70, 50] as const;
const GPO_VARIANT_OPTIONS: { value: NonNullable<FittingSpecs["gpoVariant"]>; label: string }[] = [
  { value: "standard", label: "Standard" },
  { value: "external", label: "External" },
];
// Absent ratingAmps means the standard 10 A — offered here as its own
// option so there's a way back to it, not just up from it.
const GPO_RATING_OPTIONS: { ratingAmps?: 15 | 20 | 32; threePhase?: boolean; label: string }[] = [
  { label: "10A" },
  { ratingAmps: 15, label: "15A" },
  { ratingAmps: 20, label: "20A" },
  { ratingAmps: 32, label: "32A" },
  { ratingAmps: 32, threePhase: true, label: "32A 3-phase" },
];
// Fitting types that use the shared single/double glyph convention (GPO,
// para flood, 1200mm fluoro). Only a GPO also comes as a 4-gang plate, so
// the options are looked up per type rather than being one shared [1, 2] —
// offering "4 gang" on a 1200mm fluoro would be offering something that
// isn't made.
const COUNT_VARIANT_TYPES: FittingType[] = ["gpo", "para_flood", "fluoro_1200"];
const COUNT_OPTIONS_FOR_TYPE: Partial<Record<FittingType, readonly (1 | 2 | 4)[]>> = {
  gpo: [1, 2, 4],
  para_flood: [1, 2],
  fluoro_1200: [1, 2],
};
const COUNT_LABELS: Record<1 | 2 | 4, string> = { 1: "Single", 2: "Double", 4: "4 gang" };

// Outlets on one data plate. Plates are made in these sizes; 3 and 5 are
// unusual but do exist, so the tradie isn't blocked from recording one.
const DATA_PORT_OPTIONS = [1, 2, 3, 4, 5, 6] as const;

const LED_PROFILE_OPTIONS = ["surface", "recessed", "suspended", "corner"] as const;

// Placed-appliance types that count toward Maximum Demand automatically once
// given a rating — see APPLIANCE_LOAD_GROUP_BY_TYPE in setoutMaximumDemand.ts.
const APPLIANCE_RATING_FITTING_TYPES: FittingType[] = [
  "cooktop",
  "oven",
  "hot_water_unit",
  "spa_pool_heater",
  "other_appliance",
  "heated_towel_rail",
  "underfloor_heating_stat",
  "ducted_heating_unit",
  "rev_cycle_unit",
  "evap_cooling_unit",
  "ac_condenser",
  "ac_head_unit",
  "cooling_unit",
];
// A split system is usually drawn as an outdoor condenser + indoor head as a
// PAIR — rating both would double-count the one system's load, so these get
// an extra warning line the other appliance types don't need.
const SPLIT_SYSTEM_PAIR_TYPES: FittingType[] = ["ac_condenser", "ac_head_unit", "ducted_heating_unit", "rev_cycle_unit", "evap_cooling_unit", "cooling_unit"];

const WATER_HEATER_TYPE_OPTIONS: { value: NonNullable<FittingSpecs["waterHeaterType"]>; label: string }[] = [
  { value: "storage", label: "Storage (tank)" },
  { value: "instantaneous", label: "Instantaneous" },
];

const SOLAR_CSA_SIZES: Record<CableMaterial, string[]> = CABLE_TYPES.xlpe.sizes;

// One-tap presets for the fitting variants a tradie places over and over —
// picking one sets the type AND its specs together, so a run of "GPO
// (double)" or "Downlight (twin)" doesn't mean placing a bare fitting and
// then digging into its spec panel each time. `key` is a stable id (never
// derived from `label`/`specs`, which are free to change wording/shape
// later) — that's what persists in a tradie's customised quick-pick list
// (profiles.setout_quick_picks), so re-labelling a preset here doesn't
// silently drop it from anyone's saved list.
interface FittingPreset {
  key: string;
  type: FittingType;
  specs: FittingSpecs;
  label: string;
}

// The full catalogue a tradie can choose from — DEFAULT_QUICK_PICK_KEYS
// below is just the starting set every new account sees; anything else
// here is available to add via the "Customise" popover.
const ALL_QUICK_PICK_PRESETS: FittingPreset[] = [
  { key: "downlight", type: "downlight", specs: {}, label: "Downlight" },
  { key: "downlight_twin", type: "downlight", specs: { twin: true }, label: "Downlight (twin)" },
  { key: "downlight_can", type: "downlight", specs: { downlightSizeMm: 100 }, label: "Downlight (can)" },
  { key: "switch", type: "switch", specs: {}, label: "Switch" },
  { key: "switch_4gang", type: "switch", specs: { gangs: [[], [], [], []] }, label: "Switch (4-gang)" },
  // Double is what actually gets ordered/placed most often on a real job —
  // "GPO" defaults to it rather than a single, with single still one tap
  // away for the times a job genuinely wants just one.
  { key: "gpo", type: "gpo", specs: { count: 2 }, label: "GPO" },
  { key: "gpo_single", type: "gpo", specs: { count: 1 }, label: "GPO (single)" },
  { key: "gpo_quad", type: "gpo", specs: { count: 4 }, label: "GPO (4-gang)" },
  { key: "gpo_15a", type: "gpo", specs: { count: 1, ratingAmps: 15 }, label: "GPO (15A)" },
  { key: "gpo_20a", type: "gpo", specs: { count: 1, ratingAmps: 20 }, label: "GPO (20A)" },
  { key: "gpo_32a", type: "gpo", specs: { count: 1, ratingAmps: 32 }, label: "GPO (32A)" },
  { key: "gpo_3phase", type: "gpo", specs: { count: 1, ratingAmps: 32, threePhase: true }, label: "3-phase outlet (32A)" },
  { key: "gpo_switch_combo", type: "gpo_switch_combo", specs: {}, label: "Double GPO + switch (25XA)" },
  { key: "exhaust_fan", type: "exhaust_fan", specs: {}, label: "Exhaust fan" },
  { key: "ceiling_fan", type: "ceiling_fan", specs: {}, label: "Ceiling fan" },
  { key: "smoke_detector", type: "smoke_detector", specs: {}, label: "Smoke alarm" },
  { key: "data", type: "data", specs: {}, label: "Data outlet" },
  { key: "tv_point", type: "tv_point", specs: {}, label: "TV point" },
  { key: "wifi_ap", type: "wifi_ap", specs: {}, label: "WiFi access point" },
  // Kept as its own preset (distinct from the plain "Oven" appliance below)
  // — a UBO/RHOOD is a specific connection-point fitting some jobs use
  // instead of/as well as the appliance itself.
  { key: "oven", type: "ubo_rhood", specs: {}, label: "Oven connection (UBO/RHOOD)" },
  { key: "oven_appliance", type: "oven", specs: {}, label: "Oven" },
  { key: "cooktop", type: "cooktop", specs: {}, label: "Cooktop" },
  { key: "cooktop_isolator", type: "cooktop_isolator", specs: {}, label: "Cooktop isolating switch" },
  { key: "hot_water", type: "hot_water_unit", specs: {}, label: "Hot water system" },
  { key: "aircon", type: "ac_head_unit", specs: {}, label: "Aircon (split system)" },
  { key: "other_appliance", type: "other_appliance", specs: {}, label: "Other appliance" },
  { key: "heated_towel_rail", type: "heated_towel_rail", specs: {}, label: "Heated towel rail" },
  { key: "underfloor_heating", type: "underfloor_heating_stat", specs: {}, label: "Underfloor heating stat" },
  { key: "solar_inverter", type: "solar_inverter", specs: {}, label: "Solar inverter" },
  { key: "spa_pool_heater", type: "spa_pool_heater", specs: {}, label: "Spa/pool heater" },
];
const ALL_QUICK_PICK_PRESETS_BY_KEY = new Map(ALL_QUICK_PICK_PRESETS.map((p) => [p.key, p]));

const DEFAULT_QUICK_PICK_KEYS = [
  "downlight",
  "downlight_twin",
  "downlight_can",
  "switch",
  "switch_4gang",
  "gpo",
  "gpo_single",
  "gpo_15a",
  "gpo_20a",
  "gpo_32a",
  "gpo_3phase",
  "gpo_switch_combo",
  "oven",
  "cooktop",
  "hot_water",
  "aircon",
  "other_appliance",
];

// Only the fields the presets above actually vary — comparing over this
// fixed set (rather than just "every key preset has"), with a missing field
// normalised to null on both sides, is what makes the plain "Downlight"
// preset ({}) correctly read as NOT active when a twin or can preset is the
// one actually selected, instead of vacuously matching every downlight.
const PRESET_FIELDS: (keyof FittingSpecs)[] = ["twin", "downlightSizeMm", "count", "ratingAmps", "threePhase"];
function specsMatchPreset(current: FittingSpecs | null | undefined, preset: FittingSpecs): boolean {
  const specs = current ?? {};
  const primitivesMatch = PRESET_FIELDS.every((key) => (specs[key] ?? null) === (preset[key] ?? null));
  // gangs is an array — compared by gang COUNT, not by reference/contents,
  // since that's all a quick-pick preset means by it. Absent on either side
  // reads as a single gang, matching gangsFor's own default.
  const gangCountMatches = (specs.gangs?.length ?? 1) === (preset.gangs?.length ?? 1);
  return primitivesMatch && gangCountMatches;
}

// A plain controlled <input> whose value prop comes straight from the DB
// fights the user mid-keystroke: every onChange fires a mutation, and the
// refetch that lands between keystrokes can snap the field back to a stale
// value (e.g. dropping the "." out of "0.4"). This keeps its own typing
// buffer and only commits on blur/Enter — remount it (via `key`) whenever
// the underlying value actually changes server-side, e.g. after a drag
// re-locks the measurement, so it doesn't go stale either.
function DraftNumberInput({
  initialValue,
  onCommit,
  ...inputProps
}: {
  initialValue: number;
  onCommit: (value: number) => void;
} & Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "onBlur" | "onKeyDown">) {
  const [draft, setDraft] = useState(String(initialValue));
  return (
    <Input
      {...inputProps}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const parsed = Number(draft);
        onCommit(Number.isFinite(parsed) && draft.trim() !== "" ? parsed : initialValue);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

interface FittingPaletteProps {
  selectedType: FittingType | null;
  onSelectType: (type: FittingType | null) => void;
  // One-tap presets (e.g. "GPO — double") set both the type and a starting
  // set of specs in one go, so the tradie doesn't have to place a bare
  // fitting and then dig into its spec panel just to make it a twin or a
  // 4-gang. selectedPresetSpecs is only for highlighting which preset (if
  // any) is currently active — the actual specs are applied at placement.
  onSelectPreset?: (type: FittingType, specs: FittingSpecs) => void;
  selectedPresetSpecs?: FittingSpecs | null;
  selectedFittingId: string | null;
  onDeleteSelected: () => void;
  selectedFitting?: SetoutFitting | null;
  onUpdateSpecs?: (specs: FittingSpecs) => void;
  onUpdateStatus?: (status: FittingStatus) => void;
  onRotate?: () => void;
  onUpdateMeasurementLock?: (lock: MeasurementLock) => void;
  onPickMeasurementRef?: (slot: "refA" | "refB") => void;
  pickingMeasurementSlot?: "refA" | "refB" | null;
  circuits?: SetoutCircuit[];
  onAssignCircuit?: (circuitId: string | null) => void;
  // The job's default twin-downlight spacing, used only to seed a fitting the
  // first time it's made a twin — see PlanDefaults.
  twinSpacingDefaultMm?: number;
  // The job's ceiling height, in metres — the fallback shown for a downlight
  // placed before this field existed and never got one of its own.
  ceilingHeightDefaultM?: number;
  // Symbols-and-a-dropdown only — no quick-pick grid, no selected-fitting
  // spec editor. For the horizontal floating toolbar, which is meant to
  // stay a slim single bar rather than growing into the full palette.
  compact?: boolean;
}

const FittingPalette = ({
  selectedType,
  onSelectType,
  onSelectPreset,
  selectedPresetSpecs,
  selectedFittingId,
  onDeleteSelected,
  selectedFitting,
  onUpdateSpecs,
  onUpdateStatus,
  onRotate,
  onUpdateMeasurementLock,
  onPickMeasurementRef,
  pickingMeasurementSlot,
  circuits = [],
  onAssignCircuit,
  twinSpacingDefaultMm,
  ceilingHeightDefaultM,
  compact = false,
}: FittingPaletteProps) => {
  const refLabel = (ref: MeasurementRef) => (ref.kind === "wall" ? "Wall" : "Another fitting");

  // Which quick picks show, and in what order — per account (not per plan),
  // since this is about how a tradie likes to work generally, not one job.
  // Unset (new account, never customised) falls back to the built-in set.
  const { data: profile } = useProfile();
  const updateQuickPicks = useUpdateSetoutQuickPicks();
  const quickPickKeys: string[] = (profile as any)?.setout_quick_picks ?? DEFAULT_QUICK_PICK_KEYS;
  const activePresets = quickPickKeys
    .map((key) => ALL_QUICK_PICK_PRESETS_BY_KEY.get(key))
    .filter((p): p is FittingPreset => !!p);

  const [customizeOpen, setCustomizeOpen] = useState(false);

  const toggleQuickPickKey = (key: string) => {
    const next = quickPickKeys.includes(key) ? quickPickKeys.filter((k) => k !== key) : [...quickPickKeys, key];
    updateQuickPicks.mutate(next);
  };

  const moveQuickPickKey = (key: string, direction: "up" | "down") => {
    const index = quickPickKeys.indexOf(key);
    if (index === -1) return;
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= quickPickKeys.length) return;
    const next = [...quickPickKeys];
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
    updateQuickPicks.mutate(next);
  };

  return (
    <div className="space-y-2">
      {!compact && selectedFittingId && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 space-y-2">
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Fitting selected
              {selectedFitting?.status === "confirmed" && (
                <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] font-medium text-primary bg-primary/10 rounded px-1.5 py-0.5">
                  <Check className="h-2.5 w-2.5" /> Confirmed
                </span>
              )}
            </span>
            <div className="grid grid-cols-2 gap-1">
              {onUpdateStatus && selectedFitting && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 justify-start text-muted-foreground"
                  onClick={() => onUpdateStatus(selectedFitting.status === "confirmed" ? "placed" : "confirmed")}
                >
                  {selectedFitting.status === "confirmed" ? (
                    <>
                      <RotateCcw className="h-3.5 w-3.5" /> Unconfirm
                    </>
                  ) : (
                    <>
                      <Check className="h-3.5 w-3.5" /> Confirm
                    </>
                  )}
                </Button>
              )}
              {onRotate && selectedFitting && (
                <Button variant="ghost" size="sm" className="h-8 gap-1.5 justify-start text-muted-foreground" onClick={onRotate}>
                  <RotateCw className="h-3.5 w-3.5" />
                  Rotate
                </Button>
              )}
              {onUpdateSpecs && selectedFitting && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 justify-start text-muted-foreground"
                  onClick={() => onUpdateSpecs({ ...selectedFitting.specs, locked: !selectedFitting.specs.locked })}
                >
                  {selectedFitting.specs.locked ? (
                    <>
                      <Unlock className="h-3.5 w-3.5" /> Unlock
                    </>
                  ) : (
                    <>
                      <Lock className="h-3.5 w-3.5" /> Lock
                    </>
                  )}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 justify-start text-destructive hover:text-destructive"
                onClick={onDeleteSelected}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
            </div>
          </div>

          {selectedFitting?.type === "downlight" && onUpdateSpecs && (
            <div className="space-y-2 border-t border-destructive/10 pt-2">
              <div>
                <p className="text-[11px] font-medium text-muted-foreground mb-1">Size</p>
                <div className="flex gap-1.5">
                  {DOWNLIGHT_SIZE_OPTIONS.map((sizeMm) => {
                    const active = (selectedFitting.specs.downlightSizeMm ?? 90) === sizeMm;
                    return (
                      <button
                        key={sizeMm}
                        type="button"
                        onClick={() => onUpdateSpecs({ ...selectedFitting.specs, downlightSizeMm: sizeMm })}
                        className={cn(
                          "rounded-lg border px-2 py-1 text-[11px] font-medium",
                          active ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground"
                        )}
                      >
                        {sizeMm === 100 ? "100mm (can)" : `${sizeMm}mm`}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <p className="text-[11px] font-medium text-muted-foreground mb-1">Beam angle</p>
                <div className="flex gap-1.5">
                  {BEAM_ANGLE_OPTIONS.map((angle) => {
                    const active = (selectedFitting.specs.beamAngle ?? DEFAULT_BEAM_ANGLE) === angle;
                    return (
                      <button
                        key={angle}
                        type="button"
                        onClick={() => onUpdateSpecs({ ...selectedFitting.specs, beamAngle: angle })}
                        className={cn(
                          "rounded-lg border px-2 py-1 text-[11px] font-medium",
                          active ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground"
                        )}
                      >
                        {angle}°
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <p className="text-[11px] font-medium text-muted-foreground mb-1">Lamps in the fixture</p>
                <div className="flex gap-1.5">
                  {([false, true] as const).map((twin) => {
                    const active = (selectedFitting.specs.twin ?? false) === twin;
                    return (
                      <button
                        key={String(twin)}
                        type="button"
                        onClick={() =>
                          onUpdateSpecs({
                            ...selectedFitting.specs,
                            twin,
                            // Seed the spacing from the job default the first time
                            // it's made a twin, so the tradie doesn't retype it on
                            // every fitting. Once set it belongs to this fitting.
                            twinSpacingMm: twin
                              ? selectedFitting.specs.twinSpacingMm ?? twinSpacingDefaultMm ?? DEFAULT_TWIN_SPACING_MM
                              : selectedFitting.specs.twinSpacingMm,
                          })
                        }
                        className={cn(
                          "rounded-lg border px-2 py-1 text-[11px] font-medium",
                          active ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground"
                        )}
                      >
                        {twin ? "Twin" : "Single"}
                      </button>
                    );
                  })}
                </div>
              </div>
              {selectedFitting.specs.twin && (
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground mb-1">Lamp spacing, centre to centre (mm)</p>
                  <DraftNumberInput
                    key={`twin-spacing-${selectedFitting.id}-${selectedFitting.specs.twinSpacingMm ?? DEFAULT_TWIN_SPACING_MM}`}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="10"
                    className="h-8 text-xs"
                    initialValue={selectedFitting.specs.twinSpacingMm ?? twinSpacingDefaultMm ?? DEFAULT_TWIN_SPACING_MM}
                    onCommit={(value) => onUpdateSpecs({ ...selectedFitting.specs, twinSpacingMm: value > 0 ? value : DEFAULT_TWIN_SPACING_MM })}
                  />
                </div>
              )}
              {/* No mounting height for a downlight: it sits in the ceiling, so there
                  is no height to set it out to. */}
            </div>
          )}

          {selectedFitting?.type === "data" && onUpdateSpecs && (
            <div className="border-t border-destructive/10 pt-2">
              <p className="text-[11px] font-medium text-muted-foreground mb-1">Outlets on the plate</p>
              <div className="flex flex-wrap gap-1.5">
                {DATA_PORT_OPTIONS.map((ports) => {
                  const active = (selectedFitting.specs.ports ?? 1) === ports;
                  return (
                    <button
                      key={ports}
                      type="button"
                      onClick={() => onUpdateSpecs({ ...selectedFitting.specs, ports })}
                      className={cn(
                        "rounded-lg border px-2 py-1 text-[11px] font-medium",
                        active ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground"
                      )}
                    >
                      {ports}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Every outlet on the plate home-runs to the same cabinet, so this sets how many cables get ordered.
              </p>
            </div>
          )}

          {selectedFitting?.type === "wifi_ap" && onUpdateSpecs && (
            <div className="space-y-2 border-t border-destructive/10 pt-2">
              <p className="text-[11px] font-medium text-muted-foreground mb-1">Coverage radius (m)</p>
              <DraftNumberInput
                key={`wifi-range-${selectedFitting.id}-${selectedFitting.specs.wifiRangeM ?? DEFAULT_WIFI_RANGE_M}`}
                type="number"
                inputMode="decimal"
                min="1"
                step="1"
                className="h-8 text-xs"
                initialValue={selectedFitting.specs.wifiRangeM ?? DEFAULT_WIFI_RANGE_M}
                onCommit={(value) => onUpdateSpecs({ ...selectedFitting.specs, wifiRangeM: value > 0 ? value : DEFAULT_WIFI_RANGE_M })}
              />
              <p className="text-[10px] text-muted-foreground">
                Indicative only, not a real RF survey — actual range depends on wall construction and materials. A wall or two of
                brick/masonry cuts it hard; several stud/plasterboard walls barely touch it. Always verify signal on site.
              </p>
            </div>
          )}

          {selectedFitting?.type === "led_strip" && onUpdateSpecs && (
            <div className="space-y-2 border-t border-destructive/10 pt-2">
              <div>
                <p className="text-[11px] font-medium text-muted-foreground mb-1">Run length</p>
                <p className="text-xs font-medium tabular-nums">
                  {Math.round(pathLength(selectedFitting.specs.path ?? []) * 1000)}mm
                  <span className="ml-1 font-normal text-muted-foreground">(drawn on the plan)</span>
                </p>
              </div>
              <div>
                <p className="text-[11px] font-medium text-muted-foreground mb-1">Watts per metre</p>
                <DraftNumberInput
                  key={`led-wpm-${selectedFitting.id}-${selectedFitting.specs.ledWattsPerMetre ?? DEFAULT_LED_WATTS_PER_METRE}`}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="1"
                  className="h-8 text-xs"
                  initialValue={selectedFitting.specs.ledWattsPerMetre ?? DEFAULT_LED_WATTS_PER_METRE}
                  onCommit={(value) => onUpdateSpecs({ ...selectedFitting.specs, ledWattsPerMetre: value > 0 ? value : DEFAULT_LED_WATTS_PER_METRE })}
                />
              </div>
              <div>
                <p className="text-[11px] font-medium text-muted-foreground mb-1">Extrusion stock length (m)</p>
                <DraftNumberInput
                  key={`led-stock-${selectedFitting.id}-${selectedFitting.specs.ledExtrusionStockLengthM ?? DEFAULT_EXTRUSION_STOCK_LENGTH_M}`}
                  type="number"
                  inputMode="decimal"
                  min="0.1"
                  step="0.1"
                  className="h-8 text-xs"
                  initialValue={selectedFitting.specs.ledExtrusionStockLengthM ?? DEFAULT_EXTRUSION_STOCK_LENGTH_M}
                  onCommit={(value) =>
                    onUpdateSpecs({
                      ...selectedFitting.specs,
                      ledExtrusionStockLengthM: value > 0 ? value : DEFAULT_EXTRUSION_STOCK_LENGTH_M,
                    })
                  }
                />
                <p className="mt-1 text-[10px] text-muted-foreground">
                  What the extrusion comes in off the shelf — sets how many lengths get ordered.
                </p>
              </div>
              <div>
                <p className="text-[11px] font-medium text-muted-foreground mb-1">Extrusion</p>
                <div className="flex flex-wrap gap-1.5">
                  {LED_PROFILE_OPTIONS.map((profile) => {
                    const active = (selectedFitting.specs.ledProfile ?? "surface") === profile;
                    return (
                      <button
                        key={profile}
                        type="button"
                        onClick={() => onUpdateSpecs({ ...selectedFitting.specs, ledProfile: profile })}
                        className={cn(
                          "rounded-lg border px-2 py-1 text-[11px] font-medium capitalize",
                          active ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground"
                        )}
                      >
                        {profile}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {selectedFitting && APPLIANCE_RATING_FITTING_TYPES.includes(selectedFitting.type) && onUpdateSpecs && (
            <div className="space-y-2 border-t border-destructive/10 pt-2">
              <div>
                <p className="text-[11px] font-medium text-muted-foreground mb-1">Rating (W)</p>
                <DraftNumberInput
                  key={`rating-w-${selectedFitting.id}-${selectedFitting.specs.ratingW ?? 0}`}
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="100"
                  className="h-8 text-xs"
                  initialValue={selectedFitting.specs.ratingW ?? 0}
                  onCommit={(value) => onUpdateSpecs({ ...selectedFitting.specs, ratingW: value > 0 ? value : undefined })}
                />
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Set this and it counts toward Maximum Demand automatically — no need for a separate manual entry there.
                  {selectedFitting && SPLIT_SYSTEM_PAIR_TYPES.includes(selectedFitting.type) &&
                    " If this is one half of a split system (outdoor condenser + indoor head), rate only one of the pair — rating both double-counts the one system."}
                </p>
              </div>
              {selectedFitting.type === "hot_water_unit" && (
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground mb-1">Type</p>
                  <div className="flex flex-wrap gap-1.5">
                    {WATER_HEATER_TYPE_OPTIONS.map(({ value, label }) => {
                      const active = (selectedFitting.specs.waterHeaterType ?? "storage") === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => onUpdateSpecs({ ...selectedFitting.specs, waterHeaterType: value })}
                          className={cn(
                            "rounded-lg border px-2 py-1 text-[11px] font-medium",
                            active ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground"
                          )}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {selectedFitting?.type === "solar_inverter" && onUpdateSpecs && (
            <div className="space-y-2 border-t border-destructive/10 pt-2">
              <div>
                <p className="text-[11px] font-medium text-muted-foreground mb-1">Output current (A)</p>
                <DraftNumberInput
                  key={`inverter-amps-${selectedFitting.id}-${selectedFitting.specs.inverterOutputAmps ?? 0}`}
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="1"
                  className="h-8 text-xs"
                  initialValue={selectedFitting.specs.inverterOutputAmps ?? 0}
                  onCommit={(value) => onUpdateSpecs({ ...selectedFitting.specs, inverterOutputAmps: value > 0 ? value : undefined })}
                />
              </div>
              <div>
                <p className="text-[11px] font-medium text-muted-foreground mb-1">System</p>
                <div className="flex flex-wrap gap-1.5">
                  {(["ac", "dc"] as const).map((value) => {
                    const active = (selectedFitting.specs.inverterSystemType ?? "ac") === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => onUpdateSpecs({ ...selectedFitting.specs, inverterSystemType: value })}
                        className={cn(
                          "rounded-lg border px-2 py-1 text-[11px] font-medium uppercase",
                          active ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground"
                        )}
                      >
                        {value} {value === "ac" ? "output" : "string"}
                      </button>
                    );
                  })}
                </div>
              </div>
              {(selectedFitting.specs.inverterSystemType ?? "ac") === "ac" && (
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground mb-1">Phase</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(["single", "three"] as const).map((value) => {
                      const active = (selectedFitting.specs.inverterPhase ?? "single") === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => onUpdateSpecs({ ...selectedFitting.specs, inverterPhase: value })}
                          className={cn(
                            "rounded-lg border px-2 py-1 text-[11px] font-medium capitalize",
                            active ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground"
                          )}
                        >
                          {value}-phase
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <div>
                <p className="text-[11px] font-medium text-muted-foreground mb-1">Cable material</p>
                <div className="flex flex-wrap gap-1.5">
                  {(["copper", "aluminium"] as const).map((value) => {
                    const active = (selectedFitting.specs.inverterCableMaterial ?? "copper") === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => onUpdateSpecs({ ...selectedFitting.specs, inverterCableMaterial: value })}
                        className={cn(
                          "rounded-lg border px-2 py-1 text-[11px] font-medium capitalize",
                          active ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground"
                        )}
                      >
                        {value}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <p className="text-[11px] font-medium text-muted-foreground mb-1">Cable CSA (mm²)</p>
                <div className="flex flex-wrap gap-1.5">
                  {SOLAR_CSA_SIZES[selectedFitting.specs.inverterCableMaterial ?? "copper"].map((size) => {
                    const active = selectedFitting.specs.inverterCableCsaMm2 === size;
                    return (
                      <button
                        key={size}
                        type="button"
                        onClick={() => onUpdateSpecs({ ...selectedFitting.specs, inverterCableCsaMm2: size })}
                        className={cn(
                          "rounded-lg border px-2 py-1 text-[11px] font-medium",
                          active ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground"
                        )}
                      >
                        {size}
                      </button>
                    );
                  })}
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Voltage rise is checked automatically against AS/NZS 4777.1's 2% limit in Max Demand — the cable run length is
                measured from this symbol to the nearest switchboard on the plan.
              </p>
            </div>
          )}

          {selectedFitting?.type === "gpo" && onUpdateSpecs && (
            <div className="border-t border-destructive/10 pt-2">
              <p className="text-[11px] font-medium text-muted-foreground mb-1">Variant</p>
              <div className="flex flex-wrap gap-1.5">
                {GPO_VARIANT_OPTIONS.map(({ value, label }) => {
                  const active = (selectedFitting.specs.gpoVariant ?? "standard") === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => onUpdateSpecs({ ...selectedFitting.specs, gpoVariant: value })}
                      className={cn(
                        "rounded-lg border px-2 py-1 text-[11px] font-medium",
                        active ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground"
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {selectedFitting?.type === "gpo" && onUpdateSpecs && (
            <div className="border-t border-destructive/10 pt-2">
              <p className="text-[11px] font-medium text-muted-foreground mb-1">Rating</p>
              <div className="flex flex-wrap gap-1.5">
                {GPO_RATING_OPTIONS.map(({ ratingAmps, threePhase, label }) => {
                  const active =
                    (selectedFitting.specs.ratingAmps ?? undefined) === ratingAmps &&
                    !!selectedFitting.specs.threePhase === !!threePhase;
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => onUpdateSpecs({ ...selectedFitting.specs, ratingAmps, threePhase })}
                      className={cn(
                        "rounded-lg border px-2 py-1 text-[11px] font-medium",
                        active ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground"
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {selectedFitting && COUNT_VARIANT_TYPES.includes(selectedFitting.type) && onUpdateSpecs && (
            <div className="border-t border-destructive/10 pt-2">
              <p className="text-[11px] font-medium text-muted-foreground mb-1">Plate size</p>
              <div className="flex gap-1.5">
                {(COUNT_OPTIONS_FOR_TYPE[selectedFitting.type] ?? ([1, 2] as const)).map((count) => {
                  const active = (selectedFitting.specs.count ?? 1) === count;
                  return (
                    <button
                      key={count}
                      type="button"
                      onClick={() => onUpdateSpecs({ ...selectedFitting.specs, count })}
                      className={cn(
                        "rounded-lg border px-2 py-1 text-[11px] font-medium",
                        active ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground"
                      )}
                    >
                      {COUNT_LABELS[count]}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {selectedFitting && (isSingleWallFitting(selectedFitting.type) || selectedFitting.type === "downlight") && onUpdateSpecs && (
            <div className="border-t border-destructive/10 pt-2">
              <p className="text-[11px] font-medium text-muted-foreground mb-1">
                {selectedFitting.type === "downlight" ? "Ceiling height (mm)" : "Mounting height (mm)"}
              </p>
              <DraftNumberInput
                key={`sw-height-${selectedFitting.id}-${
                  selectedFitting.specs.mountingHeight ??
                  defaultHeightForType(selectedFitting.type) ??
                  ceilingHeightDefaultM ??
                  DEFAULT_MOUNTING_HEIGHT
                }`}
                type="number"
                inputMode="decimal"
                min="0"
                step="0.05"
                className="h-8 text-xs"
                initialValue={toMm(
                  selectedFitting.specs.mountingHeight ??
                    defaultHeightForType(selectedFitting.type) ??
                    ceilingHeightDefaultM ??
                    DEFAULT_MOUNTING_HEIGHT
                )}
                onCommit={(value) => onUpdateSpecs({ ...selectedFitting.specs, mountingHeight: value ? fromMm(value) : 0 })}
              />
              {selectedFitting.type === "downlight" && (
                <p className="mt-1 text-[10px] text-muted-foreground">Sizes this downlight's coverage circle — not a lux calculation.</p>
              )}
            </div>
          )}

          {selectedFitting?.measurement_lock && onUpdateMeasurementLock && (
            <div className="space-y-2 border-t border-destructive/10 pt-2">
              <p className="text-[11px] font-medium text-muted-foreground">
                Measurements (edit if the laser reads different, or pick a different reference from the plan)
              </p>
              <div className="flex gap-2">
                {(["refA", "refB"] as const).map((slot) => {
                  const ref = selectedFitting.measurement_lock![slot];
                  if (!ref) return null;
                  const isPicking = pickingMeasurementSlot === slot;
                  return (
                    <div key={slot} className="flex-1 space-y-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[10px] text-muted-foreground">{refLabel(ref)}</span>
                        <button
                          type="button"
                          className={cn(
                            "text-[10px] font-medium rounded px-1.5 py-0.5 border",
                            isPicking ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
                          )}
                          onClick={() => onPickMeasurementRef?.(slot)}
                        >
                          {isPicking ? "Tap plan…" : "Change"}
                        </button>
                      </div>
                      <DraftNumberInput
                        key={`${slot}-${selectedFitting.id}-${ref.kind}-${measurementRefId(ref)}-${ref.distance.toFixed(2)}`}
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        className="h-8 text-xs"
                        initialValue={Number(ref.distance.toFixed(2))}
                        onCommit={(value) =>
                          onUpdateMeasurementLock({
                            ...selectedFitting.measurement_lock!,
                            [slot]: { ...ref, distance: value },
                          })
                        }
                      />
                    </div>
                  );
                })}
              </div>
              <div className="border-t border-border/30 mt-2 pt-2">
                <label className="text-[10px] text-muted-foreground block mb-1">Note (e.g., "from left window edge")</label>
                <input
                  type="text"
                  placeholder="Optional measurement note"
                  className="w-full h-7 text-xs px-2 rounded border border-input bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  value={selectedFitting.measurement_lock.note ?? ""}
                  onChange={(e) =>
                    onUpdateMeasurementLock({
                      ...selectedFitting.measurement_lock!,
                      note: e.target.value || undefined,
                    })
                  }
                />
              </div>
            </div>
          )}

          {selectedFitting && onAssignCircuit && (
            <div className="border-t border-destructive/10 pt-2">
              <p className="text-[11px] font-medium text-muted-foreground mb-1">Circuit</p>
              <Select
                value={selectedFitting.circuit_id ?? "unassigned"}
                onValueChange={(value) => onAssignCircuit(value === "unassigned" ? null : value)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Assign to circuit" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {circuits.map((circuit) => (
                    <SelectItem key={circuit.id} value={circuit.id}>
                      {circuit.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}

      {!compact && onSelectPreset && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[11px] font-medium text-muted-foreground">Quick pick</p>
            <Popover open={customizeOpen} onOpenChange={setCustomizeOpen}>
              <PopoverTrigger asChild>
                <button type="button" className="text-muted-foreground hover:text-foreground" title="Customise quick pick">
                  <Settings2 className="h-3.5 w-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-72" align="end">
                <p className="text-xs font-semibold text-foreground mb-1">Your quick picks</p>
                <p className="text-[10px] text-muted-foreground mb-2">Applies to your account — the same set shows on every job.</p>
                <div className="space-y-0.5 max-h-56 overflow-y-auto">
                  {quickPickKeys.map((key, i) => {
                    const preset = ALL_QUICK_PICK_PRESETS_BY_KEY.get(key);
                    if (!preset) return null;
                    return (
                      <div key={key} className="flex items-center gap-1.5 py-0.5">
                        <Checkbox checked onCheckedChange={() => toggleQuickPickKey(key)} className="flex-shrink-0" />
                        <span className="flex-1 min-w-0 truncate text-xs text-foreground">{preset.label}</span>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 flex-shrink-0"
                          onClick={() => moveQuickPickKey(key, "up")}
                          disabled={i === 0}
                          title="Move up"
                        >
                          <ChevronUp className="h-3 w-3" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 flex-shrink-0"
                          onClick={() => moveQuickPickKey(key, "down")}
                          disabled={i === quickPickKeys.length - 1}
                          title="Move down"
                        >
                          <ChevronDown className="h-3 w-3" />
                        </Button>
                      </div>
                    );
                  })}
                  {quickPickKeys.length === 0 && <p className="text-xs text-muted-foreground py-2">Nothing picked — add some below.</p>}
                </div>
                {ALL_QUICK_PICK_PRESETS.some((p) => !quickPickKeys.includes(p.key)) && (
                  <>
                    <p className="text-xs font-semibold text-foreground mt-3 mb-1">Add more</p>
                    <div className="space-y-0.5 max-h-40 overflow-y-auto">
                      {ALL_QUICK_PICK_PRESETS.filter((p) => !quickPickKeys.includes(p.key)).map((preset) => (
                        <div key={preset.key} className="flex items-center gap-1.5 py-0.5">
                          <Checkbox checked={false} onCheckedChange={() => toggleQuickPickKey(preset.key)} className="flex-shrink-0" />
                          <span className="flex-1 min-w-0 truncate text-xs text-muted-foreground">{preset.label}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </PopoverContent>
            </Popover>
          </div>
          {activePresets.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">No quick picks set — tap the gear above to add some.</p>
          ) : (
            <div className="grid grid-cols-2 gap-1.5">
              {activePresets.map((preset) => {
                const Icon = FITTING_SYMBOLS[preset.type];
                const active = selectedType === preset.type && specsMatchPreset(selectedPresetSpecs, preset.specs);
                return (
                  <button
                    key={preset.key}
                    type="button"
                    onClick={() => onSelectPreset(preset.type, preset.specs)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] font-medium text-left transition-colors",
                      active ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground"
                    )}
                  >
                    <Icon size={15} className="flex-shrink-0" strokeWidth={1.5} />
                    {preset.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-1.5">
        <Select
          value={selectedType ?? undefined}
          onValueChange={(value) => {
            onSelectType(value as FittingType);
            // A bare pick from the full list is "no preset" — without this,
            // picking Downlight here right after a Downlight (twin) quick
            // pick would still carry the twin spec across silently. A plain
            // GPO pick still defaults to a double, matching the quick pick —
            // a single is one tap away in the spec editor below instead.
            onSelectPreset?.(value as FittingType, value === "gpo" ? { count: 2 } : {});
          }}
        >
          <SelectTrigger className="h-11 flex-1">
            <SelectValue placeholder="Choose a fitting to place">
              {selectedType && (
                <span className="flex items-center gap-2">
                  {(() => {
                    const Icon = FITTING_SYMBOLS[selectedType];
                    return <Icon size={16} className="text-primary flex-shrink-0" strokeWidth={1.5} />;
                  })()}
                  {FITTING_LABELS[selectedType]}
                </span>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {TYPES_BY_CATEGORY.map(({ category, types }) => (
              <SelectGroup key={category}>
                <SelectLabel>{LAYER_LABELS[category]}</SelectLabel>
                {types.map((type) => {
                  const Icon = FITTING_SYMBOLS[type];
                  return (
                    <SelectItem key={type} value={type}>
                      <span className="flex items-center gap-2">
                        <Icon size={16} className="text-foreground flex-shrink-0" strokeWidth={1.5} />
                        {FITTING_LABELS[type]}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
        {selectedType && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-11 w-11 flex-shrink-0 text-muted-foreground"
            onClick={() => onSelectType(null)}
            aria-label="Clear selected fitting type"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
};

export default FittingPalette;
