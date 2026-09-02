import { ArrowRight, Cable, Plus, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FITTING_LABELS, FITTING_SYMBOLS } from "@/components/setout/symbols";
import { gangsFor, wayCountForTarget, runGroupFittingIds, type SetoutFitting } from "@/lib/setoutTypes";

interface SwitchLinksPanelProps {
  fittings: SetoutFitting[];
  activeSwitchId: string | null;
  activeGangIndex: number;
  onSelectSwitch: (id: string | null) => void;
  onSelectGang: (gangIndex: number) => void;
  onAddGang: (switchFitting: SetoutFitting) => void;
  onRemoveGang: (switchFitting: SetoutFitting, gangIndex: number) => void;
}

export default function SwitchLinksPanel({
  fittings,
  activeSwitchId,
  activeGangIndex,
  onSelectSwitch,
  onSelectGang,
  onAddGang,
  onRemoveGang,
}: SwitchLinksPanelProps) {
  const switches = fittings.filter((f) => f.type === "switch");

  if (switches.length === 0) {
    return <p className="text-xs text-muted-foreground py-3">No switches placed yet — add one from the palette above, then link it to lights here.</p>;
  }

  return (
    <div className="space-y-2">
      {switches.map((sw, i) => {
        const isActiveSwitch = sw.id === activeSwitchId;
        const gangs = gangsFor(sw);
        return (
          <Card key={sw.id} className={cn("p-3 rounded-xl transition-colors", isActiveSwitch && "border-primary/40 bg-primary/5")}>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-sm font-semibold text-foreground">
                Switch {i + 1}
                {gangs.length > 1 && <span className="ml-1 text-xs font-normal text-muted-foreground">({gangs.length}-gang)</span>}
              </p>
              <Button variant="ghost" size="sm" className="h-6 gap-1 text-[11px] text-muted-foreground" onClick={() => onAddGang(sw)}>
                <Plus className="h-3 w-3" /> Add gang
              </Button>
            </div>
            <div className="space-y-1.5">
              {gangs.map((gang, gangIndex) => {
                const isActiveGang = isActiveSwitch && gangIndex === activeGangIndex;
                // A gang only ever targets lights now — an older model let a
                // gang chain on to another switch's id to mark a 2-way run;
                // any leftover switch ids from that (pre-automatic-detection)
                // data are just dropped here rather than shown as a target.
                const links = gang
                  .map((id) => fittings.find((f) => f.id === id))
                  .filter((f): f is SetoutFitting => !!f && f.type !== "switch");
                return (
                  <div
                    key={gangIndex}
                    className={cn(
                      "flex flex-wrap items-center gap-1.5 rounded-lg border px-2 py-1.5 cursor-pointer",
                      isActiveGang ? "border-primary/40 bg-primary/10" : "border-border"
                    )}
                    onClick={() => {
                      onSelectSwitch(sw.id);
                      onSelectGang(gangIndex);
                    }}
                  >
                    <span className="text-[10px] font-medium text-muted-foreground flex-shrink-0">
                      {gangs.length > 1 ? `Gang ${gangIndex + 1}` : "Switch"}
                    </span>
                    {links.length === 0 ? (
                      <span className="text-xs text-muted-foreground">{isActiveGang ? "Tap lights to link" : "Not linked yet"}</span>
                    ) : (
                      links.map((target) => {
                        const Icon = FITTING_SYMBOLS[target.type];
                        // Automatic: this light is N-way the moment N
                        // switches each independently link it — tap the same
                        // light from another switch's gang and it picks this
                        // up on its own, no separate switch-to-switch step.
                        const ways = wayCountForTarget(target.id, switches);
                        // Every other switch in this light's run — not just
                        // ones that directly share this exact light, but the
                        // whole connected chain (switch A - light1, switch B
                        // - light1 & light2, switch C - light2 is still one
                        // 3-way run) — so selecting a switch surfaces them
                        // all here rather than making the tradie hunt
                        // through every other card.
                        const runGroup = runGroupFittingIds(target.id, switches);
                        const siblingSwitches = switches.filter((other) => other.id !== sw.id && runGroup.has(other.id));
                        return (
                          <span key={target.id} className="contents">
                            <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                            <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-1.5 py-1 text-[11px] text-foreground">
                              <Icon size={14} className="text-primary" strokeWidth={1.5} />
                              {FITTING_LABELS[target.type]}
                              {ways > 1 && <span className="text-primary font-medium">· {ways}-way</span>}
                            </span>
                            {siblingSwitches.map((sib) => (
                              <span
                                key={sib.id}
                                className="inline-flex items-center gap-1 rounded-md border border-dashed border-primary/40 bg-primary/5 px-1.5 py-1 text-[11px] text-primary"
                              >
                                <Cable className="h-3 w-3" />
                                Switch {switches.indexOf(sib) + 1}
                              </span>
                            ))}
                          </span>
                        );
                      })
                    )}
                    {gangs.length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 ml-auto text-muted-foreground hover:text-destructive flex-shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveGang(sw, gangIndex);
                        }}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })}

      <div className="flex items-start gap-1.5 pt-1 text-[11px] text-muted-foreground">
        <Cable className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
        Each gang is its own cable run — tap a gang, then tap lights on the canvas to link them. Link the same light from a
        second switch's gang and it's automatically picked up as 2-way (a third switch makes it 3-way, and so on). Use
        "Add gang" for a plate that controls more than one thing (e.g. downlights on one gang, a fan on another).
      </div>
    </div>
  );
}
