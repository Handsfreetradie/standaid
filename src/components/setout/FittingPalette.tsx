import { useState } from "react";
import { Trash2, Check, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { FITTING_LABELS, FITTING_SYMBOLS, type FittingType } from "@/components/setout/symbols";
import { BEAM_ANGLE_OPTIONS, DEFAULT_BEAM_ANGLE, DEFAULT_MOUNTING_HEIGHT, defaultHeightForType } from "@/lib/setoutGeometry";
import { isSingleWallFitting, type FittingSpecs, type FittingStatus, type MeasurementLock, type SetoutCircuit, type SetoutFitting, type WallSegment } from "@/lib/setoutTypes";

const FITTING_TYPES = Object.keys(FITTING_SYMBOLS) as FittingType[];

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
  walls?: WallSegment[];
  onUpdateMeasurementLock?: (lock: MeasurementLock) => void;
  circuits?: SetoutCircuit[];
  onAssignCircuit?: (circuitId: string | null) => void;
}

const FittingPalette = ({
  selectedType,
  onSelectType,
  selectedFittingId,
  onDeleteSelected,
  selectedFitting,
  onUpdateSpecs,
  onUpdateStatus,
  walls = [],
  onUpdateMeasurementLock,
  circuits = [],
  onAssignCircuit,
}: FittingPaletteProps) => {
  const wallLabel = (wallId: string) => {
    const index = walls.findIndex((w) => w.id === wallId);
    return index === -1 ? "Wall" : `Wall ${index + 1}`;
  };
  return (
    <div className="space-y-2">
      {selectedFittingId && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Fitting selected
              {selectedFitting?.status === "confirmed" && (
                <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] font-medium text-primary bg-primary/10 rounded px-1.5 py-0.5">
                  <Check className="h-2.5 w-2.5" /> Confirmed
                </span>
              )}
            </span>
            <div className="flex items-center gap-1">
              {onUpdateStatus && selectedFitting && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 text-muted-foreground"
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
              <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-destructive hover:text-destructive" onClick={onDeleteSelected}>
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
            </div>
          </div>

          {selectedFitting?.type === "downlight" && onUpdateSpecs && (
            <div className="space-y-2 border-t border-destructive/10 pt-2">
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
                <p className="text-[11px] font-medium text-muted-foreground mb-1">Mounting height (m)</p>
                <DraftNumberInput
                  key={`dl-height-${selectedFitting.id}-${selectedFitting.specs.mountingHeight ?? DEFAULT_MOUNTING_HEIGHT}`}
                  type="number"
                  inputMode="decimal"
                  min="1.8"
                  step="0.1"
                  className="h-8 text-xs"
                  initialValue={selectedFitting.specs.mountingHeight ?? DEFAULT_MOUNTING_HEIGHT}
                  onCommit={(value) => onUpdateSpecs({ ...selectedFitting.specs, mountingHeight: value || DEFAULT_MOUNTING_HEIGHT })}
                />
              </div>
            </div>
          )}

          {selectedFitting && isSingleWallFitting(selectedFitting.type) && onUpdateSpecs && (
            <div className="border-t border-destructive/10 pt-2">
              <p className="text-[11px] font-medium text-muted-foreground mb-1">Mounting height (m)</p>
              <DraftNumberInput
                key={`sw-height-${selectedFitting.id}-${selectedFitting.specs.mountingHeight ?? defaultHeightForType(selectedFitting.type) ?? 0}`}
                type="number"
                inputMode="decimal"
                min="0"
                step="0.05"
                className="h-8 text-xs"
                initialValue={selectedFitting.specs.mountingHeight ?? defaultHeightForType(selectedFitting.type) ?? 0}
                onCommit={(value) => onUpdateSpecs({ ...selectedFitting.specs, mountingHeight: value || 0 })}
              />
            </div>
          )}

          {selectedFitting?.measurement_lock && onUpdateMeasurementLock && (
            <div className="space-y-2 border-t border-destructive/10 pt-2">
              <p className="text-[11px] font-medium text-muted-foreground">Measurements (edit if the laser reads different)</p>
              <div className="flex gap-2">
                <div className="flex-1">
                  <p className="text-[10px] text-muted-foreground mb-1">{wallLabel(selectedFitting.measurement_lock.wallA.wallId)} (m)</p>
                  <DraftNumberInput
                    key={`wallA-${selectedFitting.id}-${selectedFitting.measurement_lock.wallA.distance.toFixed(2)}`}
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    className="h-8 text-xs"
                    initialValue={Number(selectedFitting.measurement_lock.wallA.distance.toFixed(2))}
                    onCommit={(value) =>
                      onUpdateMeasurementLock({
                        ...selectedFitting.measurement_lock!,
                        wallA: { ...selectedFitting.measurement_lock!.wallA, distance: value },
                      })
                    }
                  />
                </div>
                {selectedFitting.measurement_lock.wallB && (
                  <div className="flex-1">
                    <p className="text-[10px] text-muted-foreground mb-1">{wallLabel(selectedFitting.measurement_lock.wallB.wallId)} (m)</p>
                    <DraftNumberInput
                      key={`wallB-${selectedFitting.id}-${selectedFitting.measurement_lock.wallB.distance.toFixed(2)}`}
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      className="h-8 text-xs"
                      initialValue={Number(selectedFitting.measurement_lock.wallB.distance.toFixed(2))}
                      onCommit={(value) =>
                        onUpdateMeasurementLock({
                          ...selectedFitting.measurement_lock!,
                          wallB: { ...selectedFitting.measurement_lock!.wallB!, distance: value },
                        })
                      }
                    />
                  </div>
                )}
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

      <div className="flex gap-2 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible">
        {FITTING_TYPES.map((type) => {
          const Icon = FITTING_SYMBOLS[type];
          const isSelected = selectedType === type;
          return (
            <button
              key={type}
              type="button"
              onClick={() => onSelectType(isSelected ? null : type)}
              className={cn(
                "flex flex-shrink-0 flex-col items-center gap-1 rounded-xl border px-3 py-2.5 min-w-[72px] transition-colors",
                isSelected
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
            >
              <Icon size={22} className={isSelected ? "text-primary" : "text-foreground"} strokeWidth={isSelected ? 2 : 1.5} />
              <span className="text-[10px] font-medium leading-tight text-center">{FITTING_LABELS[type]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default FittingPalette;
