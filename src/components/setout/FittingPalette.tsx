import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FITTING_LABELS, FITTING_SYMBOLS, type FittingType } from "@/components/setout/symbols";

const FITTING_TYPES = Object.keys(FITTING_SYMBOLS) as FittingType[];

interface FittingPaletteProps {
  selectedType: FittingType | null;
  onSelectType: (type: FittingType | null) => void;
  selectedFittingId: string | null;
  onDeleteSelected: () => void;
}

const FittingPalette = ({ selectedType, onSelectType, selectedFittingId, onDeleteSelected }: FittingPaletteProps) => {
  return (
    <div className="space-y-2">
      {selectedFittingId && (
        <div className="flex items-center justify-between rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground">Fitting selected</span>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-destructive hover:text-destructive" onClick={onDeleteSelected}>
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </Button>
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
