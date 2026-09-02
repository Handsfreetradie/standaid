import { Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { LAYER_LABELS, type LayerVisibility } from "@/lib/setoutTypes";

const LAYER_KEYS = Object.keys(LAYER_LABELS) as (keyof LayerVisibility)[];

interface LayerVisibilityToggleProps {
  value: LayerVisibility;
  onChange: (next: LayerVisibility) => void;
}

export default function LayerVisibilityToggle({ value, onChange }: LayerVisibilityToggleProps) {
  // A single button that flips between hiding and restoring every layer —
  // "all hidden" is the trigger for "Show all" rather than a separate piece
  // of state, so it can't drift out of sync with the individual toggles.
  const allHidden = LAYER_KEYS.every((key) => !value[key]);
  const setAllTo = (visible: boolean): LayerVisibility =>
    LAYER_KEYS.reduce((acc, key) => ({ ...acc, [key]: visible }), {} as LayerVisibility);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Layers className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
      <button
        type="button"
        onClick={() => onChange(setAllTo(allHidden))}
        className="rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold text-foreground hover:bg-muted transition-colors"
      >
        {allHidden ? "Show all" : "Hide all"}
      </button>
      {LAYER_KEYS.map((key) => {
        const active = value[key];
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange({ ...value, [key]: !active })}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
              active ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            {LAYER_LABELS[key]}
          </button>
        );
      })}
    </div>
  );
}
