import { ArrowRight, Cable } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { FITTING_LABELS, FITTING_SYMBOLS } from "@/components/setout/symbols";
import type { SetoutFitting } from "@/lib/setoutTypes";

interface SwitchLinksPanelProps {
  fittings: SetoutFitting[];
  activeSwitchId: string | null;
  onSelectSwitch: (id: string | null) => void;
}

// A light with 2+ switches pointing at it is a 2-way/3-way by definition —
// no separate "switch type" is stored, this is derived from linked_to.
function wayCountFor(targetId: string, switches: SetoutFitting[]): number {
  return switches.filter((sw) => sw.linked_to.includes(targetId)).length;
}

export default function SwitchLinksPanel({ fittings, activeSwitchId, onSelectSwitch }: SwitchLinksPanelProps) {
  const switches = fittings.filter((f) => f.type === "switch");

  if (switches.length === 0) {
    return <p className="text-xs text-muted-foreground py-3">No switches placed yet — add one from the palette above, then link it to lights here.</p>;
  }

  return (
    <div className="space-y-2">
      {switches.map((sw, i) => {
        const isActive = sw.id === activeSwitchId;
        const links = sw.linked_to.map((id) => fittings.find((f) => f.id === id)).filter((f): f is SetoutFitting => !!f);
        return (
          <Card
            key={sw.id}
            className={cn("p-3 rounded-xl cursor-pointer transition-colors", isActive && "border-primary/40 bg-primary/5")}
            onClick={() => onSelectSwitch(isActive ? null : sw.id)}
          >
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-sm font-semibold text-foreground">Switch {i + 1}</p>
              {isActive && <span className="text-[10px] font-medium text-primary bg-primary/10 rounded px-1.5 py-0.5">Tap lights to link</span>}
            </div>
            {links.length === 0 ? (
              <p className="text-xs text-muted-foreground">Not linked to anything yet</p>
            ) : (
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-[10px] font-medium text-muted-foreground">Switch</span>
                {links.map((target) => {
                  const Icon = FITTING_SYMBOLS[target.type];
                  const ways = wayCountFor(target.id, switches);
                  return (
                    <span key={target.id} className="contents">
                      <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                      <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-1.5 py-1 text-[11px] text-foreground">
                        <Icon size={14} className="text-primary" strokeWidth={1.5} />
                        {FITTING_LABELS[target.type]}
                        {ways > 1 && <span className="text-primary font-medium">· {ways}-way</span>}
                      </span>
                    </span>
                  );
                })}
              </div>
            )}
          </Card>
        );
      })}

      <div className="flex items-start gap-1.5 pt-1 text-[11px] text-muted-foreground">
        <Cable className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
        This list is the cable-run order — each switch's linked points are what it runs to.
      </div>
    </div>
  );
}
