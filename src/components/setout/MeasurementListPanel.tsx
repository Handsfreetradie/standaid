import { Ruler } from "lucide-react";
import { Card } from "@/components/ui/card";
import { FITTING_LABELS, FITTING_SYMBOLS } from "@/components/setout/symbols";
import type { MeasurementRef, SetoutFitting, WallSegment } from "@/lib/setoutTypes";

interface MeasurementListPanelProps {
  fittings: SetoutFitting[];
  walls: WallSegment[];
}

export default function MeasurementListPanel({ fittings, walls }: MeasurementListPanelProps) {
  const wallLabel = (wallId: string) => {
    const index = walls.findIndex((w) => w.id === wallId);
    return index === -1 ? "Wall" : `Wall ${index + 1}`;
  };

  const refLabel = (ref: MeasurementRef) => {
    if (ref.kind === "wall") return wallLabel(ref.wallId);
    const target = fittings.find((f) => f.id === ref.fittingId);
    return target ? FITTING_LABELS[target.type] : "another fitting";
  };

  const locked = fittings.filter((f) => f.measurement_lock);

  if (locked.length === 0) {
    return <p className="text-xs text-muted-foreground py-3">No fittings placed yet — measurements lock automatically as you place them.</p>;
  }

  return (
    <div className="space-y-2">
      {locked.map((f) => {
        const Icon = FITTING_SYMBOLS[f.type];
        const lock = f.measurement_lock!;
        return (
          <Card key={f.id} className="p-3 rounded-xl flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 flex-shrink-0">
              <Icon size={16} className="text-primary" strokeWidth={1.5} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">{FITTING_LABELS[f.type]}</p>
              <p className="text-xs text-muted-foreground">
                {refLabel(lock.refA)}: {lock.refA.distance.toFixed(2)}m
                {lock.refB && ` · ${refLabel(lock.refB)}: ${lock.refB.distance.toFixed(2)}m`}
                {!lock.refB && f.specs.mountingHeight != null && ` · Height: ${f.specs.mountingHeight.toFixed(2)}m`}
              </p>
            </div>
            {f.status === "confirmed" && (
              <span className="text-[10px] font-medium text-primary bg-primary/10 rounded px-1.5 py-0.5 flex-shrink-0">Confirmed</span>
            )}
          </Card>
        );
      })}
      <div className="flex items-start gap-1.5 pt-1 text-[11px] text-muted-foreground">
        <Ruler className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
        Distances lock to the two nearest walls automatically, read straight off a laser — re-locks whenever a fitting moves. Either
        reference can be changed to a different wall or another fitting from the fitting's own measurement fields.
      </div>
    </div>
  );
}
