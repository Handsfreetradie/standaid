import { ArrowRight, Network } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { FITTING_LABELS, FITTING_SYMBOLS } from "@/components/setout/symbols";
import type { SetoutFitting } from "@/lib/setoutTypes";

interface DataCabinetLinksPanelProps {
  fittings: SetoutFitting[];
  activeCabinetId: string | null;
  onSelectCabinet: (cabinetId: string | null) => void;
}

// Data cabling is always a home run, never a loop-in chain — so unlike
// SwitchLinksPanel there's no gang concept here, just "select a cabinet,
// then tap data points on the canvas to link/unlink them to it."
export default function DataCabinetLinksPanel({ fittings, activeCabinetId, onSelectCabinet }: DataCabinetLinksPanelProps) {
  const cabinets = fittings.filter((f) => f.type === "data_cabinet");

  if (cabinets.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-3">
        No data cabinets placed yet — add one from the palette above, then link data points to it here.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {cabinets.map((cabinet, i) => {
        const isActive = cabinet.id === activeCabinetId;
        const links = fittings.filter((f) => f.type === "data" && f.specs.dataCabinetId === cabinet.id);
        return (
          <Card
            key={cabinet.id}
            className={cn("p-3 rounded-xl transition-colors cursor-pointer", isActive && "border-primary/40 bg-primary/5")}
            onClick={() => onSelectCabinet(isActive ? null : cabinet.id)}
          >
            <p className="text-sm font-semibold text-foreground mb-1.5">Data cabinet {i + 1}</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {links.length === 0 ? (
                <span className="text-xs text-muted-foreground">{isActive ? "Tap data points to link" : "Not linked yet"}</span>
              ) : (
                links.map((target) => {
                  const Icon = FITTING_SYMBOLS[target.type];
                  return (
                    <span key={target.id} className="contents">
                      <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                      <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-1.5 py-1 text-[11px] text-foreground">
                        <Icon size={14} className="text-primary" strokeWidth={1.5} />
                        {FITTING_LABELS[target.type]}
                      </span>
                    </span>
                  );
                })
              )}
            </div>
          </Card>
        );
      })}

      <div className="flex items-start gap-1.5 pt-1 text-[11px] text-muted-foreground">
        <Network className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
        Tap a cabinet, then tap data points on the canvas to link or unlink them — each point home-runs to one cabinet, no
        loop-in.
      </div>
    </div>
  );
}
