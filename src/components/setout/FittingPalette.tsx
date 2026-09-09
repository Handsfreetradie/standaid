import { useState } from "react";
import { Trash2, Check, RotateCcw, RotateCw, Lock, Unlock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { FITTING_LABELS, FITTING_SYMBOLS, type FittingType } from "@/components/setout/symbols";
import { BEAM_ANGLE_OPTIONS, DEFAULT_BEAM_ANGLE, defaultHeightForType } from "@/lib/setoutGeometry";
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
} from "@/lib/setoutTypes";
import { pathLength } from "@/lib/setoutPathGeometry";
import { DEFAULT_EXTRUSION_STOCK_LENGTH_M, DEFAULT_LED_WATTS_PER_METRE } from "@/lib/setoutMaterials";

const FITTING_TYPES = Object.keys(FITTING_SYMBOLS) as FittingType[];
const TYPES_BY_CATEGORY = FITTING_CATEGORY_ORDER.map((category) => ({
  category,
  types: FITTING_TYPES.filter((type) => CATEGORY_FOR_TYPE[type] === category),
})).filter((group) => group.types.length > 0);

const DOWNLIGHT_SIZE_OPTIONS = [90, 70, 50] as const;
const GPO_VARIANT_OPTIONS: { value: NonNullable<FittingSpecs["gpoVariant"]>; label: string }[] = [
  { value: "standard", label: "Standard" },
  { value: "external", label: "External" },
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
}

const FittingPalette = ({
  selectedType,
  onSelectType,
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
}: FittingPaletteProps) => {
  const refLabel = (ref: MeasurementRef) => (ref.kind === "wall" ? "Wall" : "Another fitting");

  return (
    <div className="space-y-2">
      {selectedFittingId && (
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
                        {sizeMm}mm
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

          {selectedFitting && isSingleWallFitting(selectedFitting.type) && onUpdateSpecs && (
            <div className="border-t border-destructive/10 pt-2">
              <p className="text-[11px] font-medium text-muted-foreground mb-1">Mounting height (mm)</p>
              <DraftNumberInput
                key={`sw-height-${selectedFitting.id}-${selectedFitting.specs.mountingHeight ?? defaultHeightForType(selectedFitting.type) ?? 0}`}
                type="number"
                inputMode="decimal"
                min="0"
                step="0.05"
                className="h-8 text-xs"
                initialValue={toMm(selectedFitting.specs.mountingHeight ?? defaultHeightForType(selectedFitting.type) ?? 0)}
                onCommit={(value) => onUpdateSpecs({ ...selectedFitting.specs, mountingHeight: value ? fromMm(value) : 0 })}
              />
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

      <div className="flex items-center gap-1.5">
        <Select value={selectedType ?? undefined} onValueChange={(value) => onSelectType(value as FittingType)}>
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
