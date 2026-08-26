import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { FITTING_LABELS, FITTING_SYMBOLS, type FittingType } from "@/components/setout/symbols";
import { BEAM_ANGLE_OPTIONS, DEFAULT_BEAM_ANGLE, DEFAULT_MOUNTING_HEIGHT } from "@/lib/setoutGeometry";
import type { FittingSpecs, SetoutFitting } from "@/lib/setoutTypes";

const FITTING_TYPES = Object.keys(FITTING_SYMBOLS) as FittingType[];

interface FittingPaletteProps {
  selectedType: FittingType | null;
  onSelectType: (type: FittingType | null) => void;
  selectedFittingId: string | null;
  onDeleteSelected: () => void;
  selectedFitting?: SetoutFitting | null;
  onUpdateSpecs?: (specs: FittingSpecs) => void;
}

const FittingPalette = ({
  selectedType,
  onSelectType,
  selectedFittingId,
  onDeleteSelected,
  selectedFitting,
  onUpdateSpecs,
}: FittingPaletteProps) => {
  return (
    <div className="space-y-2">
      {selectedFittingId && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Fitting selected</span>
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-destructive hover:text-destructive" onClick={onDeleteSelected}>
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
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
                <Input
                  type="number"
                  inputMode="decimal"
                  min="1.8"
                  step="0.1"
                  className="h-8 text-xs"
                  value={selectedFitting.specs.mountingHeight ?? DEFAULT_MOUNTING_HEIGHT}
                  onChange={(e) => onUpdateSpecs({ ...selectedFitting.specs, mountingHeight: Number(e.target.value) || DEFAULT_MOUNTING_HEIGHT })}
                />
              </div>
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
