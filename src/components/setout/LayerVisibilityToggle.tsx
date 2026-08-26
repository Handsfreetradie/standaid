import { Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { LAYER_LABELS, type LayerVisibility } from "@/lib/setoutTypes";

const LAYER_KEYS = Object.keys(LAYER_LABELS) as (keyof LayerVisibility)[];

interface LayerVisibilityToggleProps {
  value: LayerVisibility;
  onChange: (next: LayerVisibility) => void;
}

export default function LayerVisibilityToggle({ value, onChange }: LayerVisibilityToggleProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Layers className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
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
