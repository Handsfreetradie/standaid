import { useState } from "react";
import { Loader2, Plus, Trash2, Pencil, Check, X, Gauge, Sun } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useSetoutFittings, useSetoutPlan, useUpdateSetoutPlanDefaults } from "@/hooks/useSetoutPlans";
import {
  useSetoutLoadItems,
  useCreateSetoutLoadItem,
  useUpdateSetoutLoadItem,
  useDeleteSetoutLoadItem,
} from "@/hooks/useSetoutLoadItems";
import { useSetoutCircuits, useUpdateSetoutCircuit } from "@/hooks/useSetoutCircuits";
import { calculateMaximumDemand, LOAD_GROUPS, type LoadGroupDef, type SupplyPhase } from "@/lib/setoutMaximumDemand";
import { calculateSolarVoltageRise } from "@/lib/setoutSolarVoltageRise";
import { recommendPhaseSplit, PHASES, type Phase } from "@/lib/setoutPhaseBalance";
import { distance, type SetoutFitting, type SetoutLoadItem } from "@/lib/setoutTypes";

interface MaximumDemandPanelProps {
  planId: string;
}

// The nearest switchboard on the plan is the best available stand-in for
// "where this inverter's AC output circuit actually terminates" — there's no
// explicit inverter-to-board link drawn on a rough-in plan. Straight-line
// distance, not a routed path (there's no conduit/cable-route geometry in
// this app) — always shown as an estimate the tradie should verify.
function nearestSwitchboard(inverter: Pick<SetoutFitting, "position">, fittings: SetoutFitting[]): SetoutFitting | null {
  let nearest: SetoutFitting | null = null;
  let nearestDistance = Infinity;
  for (const f of fittings) {
    if (f.type !== "switchboard") continue;
    const d = distance(inverter.position, f.position);
    if (d < nearestDistance) {
      nearestDistance = d;
      nearest = f;
    }
  }
  return nearest;
}

// Only the groups a tradie actually adds by hand — the two point-based
// groups (lighting/socket points) are tallied live from what's on the plan,
// not offered here.
const MANUAL_LOAD_GROUPS = LOAD_GROUPS.filter((g): g is Exclude<LoadGroupDef, { kind: "points" }> => g.kind !== "points");

function labelForGroup(key: string): string {
  return LOAD_GROUPS.find((g) => g.key === key)?.label ?? key;
}

function isFlagGroup(key: string): boolean {
  return LOAD_GROUPS.find((g) => g.key === key)?.kind === "flag";
}

export default function MaximumDemandPanel({ planId }: MaximumDemandPanelProps) {
  const { data: plan } = useSetoutPlan(planId);
  const { data: fittings = [], isLoading: fittingsLoading } = useSetoutFittings(planId);
  const { data: loadItems = [], isLoading: loadItemsLoading } = useSetoutLoadItems(planId);

  const createLoadItem = useCreateSetoutLoadItem(planId);
  const updateLoadItem = useUpdateSetoutLoadItem(planId);
  const deleteLoadItem = useDeleteSetoutLoadItem(planId);
  const updatePlanDefaults = useUpdateSetoutPlanDefaults(planId);

  const supplyPhase: SupplyPhase = plan?.plan_defaults?.supplyPhase ?? "single";
  const handlePhaseChange = (phase: SupplyPhase) => {
    if (phase === supplyPhase) return;
    updatePlanDefaults.mutate({ ...plan?.plan_defaults, supplyPhase: phase });
  };

  const { data: circuits = [] } = useSetoutCircuits(planId);
  const updateCircuit = useUpdateSetoutCircuit(planId);
  const [applyingPhaseBalance, setApplyingPhaseBalance] = useState(false);
  const phaseBalance = supplyPhase === "three" ? recommendPhaseSplit(circuits, fittings) : null;

  const handleApplyPhaseBalance = async () => {
    if (!phaseBalance) return;
    setApplyingPhaseBalance(true);
    try {
      await Promise.all(
        phaseBalance.recommendations.map((r) => {
          const circuit = circuits.find((c) => c.id === r.circuitId);
          return updateCircuit.mutateAsync({ circuitId: r.circuitId, specs: { ...circuit?.specs, boardPhase: r.phase } });
        }),
      );
      toast.success("Phase split applied to every circuit");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not apply the phase split");
    } finally {
      setApplyingPhaseBalance(false);
    }
  };

  const handleSetCircuitPhase = (circuitId: string, phase: Phase) => {
    const circuit = circuits.find((c) => c.id === circuitId);
    updateCircuit.mutate({ circuitId, specs: { ...circuit?.specs, boardPhase: phase } });
  };

  const [showAddForm, setShowAddForm] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newGroup, setNewGroup] = useState<string>(MANUAL_LOAD_GROUPS[0]?.key ?? "");
  const [newRatingW, setNewRatingW] = useState("");
  const [newQuantity, setNewQuantity] = useState("1");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editGroup, setEditGroup] = useState("");
  const [editRatingW, setEditRatingW] = useState("");
  const [editQuantity, setEditQuantity] = useState("1");

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const isLoading = fittingsLoading || loadItemsLoading;

  const resetAddForm = () => {
    setNewLabel("");
    setNewGroup(MANUAL_LOAD_GROUPS[0]?.key ?? "");
    setNewRatingW("");
    setNewQuantity("1");
    setShowAddForm(false);
  };

  const handleCreate = async () => {
    if (!newLabel.trim() || !newGroup) return;
    const flag = isFlagGroup(newGroup);
    try {
      await createLoadItem.mutateAsync({
        label: newLabel.trim(),
        load_group: newGroup,
        rating_w: flag ? 0 : Number(newRatingW) || 0,
        quantity: flag ? 1 : Number(newQuantity) || 1,
      });
      resetAddForm();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add the load");
    }
  };

  const startEdit = (item: SetoutLoadItem) => {
    setEditingId(item.id);
    setEditLabel(item.label);
    setEditGroup(item.load_group);
    setEditRatingW(String(item.rating_w));
    setEditQuantity(String(item.quantity));
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = async () => {
    if (!editingId || !editLabel.trim() || !editGroup) return;
    const flag = isFlagGroup(editGroup);
    try {
      await updateLoadItem.mutateAsync({
        loadItemId: editingId,
        label: editLabel.trim(),
        load_group: editGroup,
        rating_w: flag ? 0 : Number(editRatingW) || 0,
        quantity: flag ? 1 : Number(editQuantity) || 1,
      });
      setEditingId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the load");
    }
  };

  const handleDelete = async (loadItemId: string) => {
    setDeletingId(loadItemId);
    try {
      await deleteLoadItem.mutateAsync(loadItemId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete the load");
    } finally {
      setDeletingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const result = calculateMaximumDemand(fittings, loadItems, supplyPhase);
  const contributingGroups = result.groups.filter((g) => g.amps > 0);
  const solarInverters = fittings.filter((f) => f.type === "solar_inverter");

  return (
    <div className="space-y-6 min-w-0">
      {/* Auto-counted from the plan */}
      <div>
        <h3 className="text-sm font-bold text-foreground mb-2">Counted from the plan</h3>
        <div className="grid grid-cols-2 gap-2">
          {result.groups
            .filter((g) => g.points !== undefined)
            .map((g) => (
              <Card key={g.key} className="p-3 rounded-xl">
                <p className="text-xs text-muted-foreground truncate">{g.label}</p>
                {/* A run of LED strip contributes fractional points (length x
                    2/m), so this is rounded for display — the raw value still
                    feeds the actual amps calc below. */}
                <p className="text-sm font-semibold text-foreground">
                  {(g.points ?? 0).toFixed(1)} points → {g.amps.toFixed(1)} A
                </p>
              </Card>
            ))}
        </div>
      </div>

      {/* Manual loads not placed as symbols — hot water, oven, hotplate, etc. */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-bold text-foreground">Other loads</h3>
          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setShowAddForm((v) => !v)}>
            <Plus className="h-3.5 w-3.5" /> Add load
          </Button>
        </div>

        {showAddForm && (
          <Card className="p-3 mb-2 space-y-2 rounded-xl">
            <Input placeholder="Label (e.g. Oven, Hot water system)" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
            <Select value={newGroup} onValueChange={setNewGroup}>
              <SelectTrigger>
                <SelectValue placeholder="AS3000 load group" />
              </SelectTrigger>
              <SelectContent>
                {MANUAL_LOAD_GROUPS.map((g) => (
                  <SelectItem key={g.key} value={g.key}>
                    {g.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!isFlagGroup(newGroup) && (
              <div className="flex gap-2">
                <Input
                  type="number"
                  placeholder="Rating (W)"
                  value={newRatingW}
                  onChange={(e) => setNewRatingW(e.target.value)}
                  className="flex-1"
                />
                <Input
                  type="number"
                  placeholder="Qty"
                  value={newQuantity}
                  onChange={(e) => setNewQuantity(e.target.value)}
                  className="w-20"
                />
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" className="flex-1" onClick={resetAddForm}>
                Cancel
              </Button>
              <Button size="sm" className="flex-1 gap-1.5" disabled={!newLabel.trim() || createLoadItem.isPending} onClick={handleCreate}>
                {createLoadItem.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
              </Button>
            </div>
          </Card>
        )}

        {loadItems.length === 0 ? (
          <p className="text-xs text-muted-foreground py-3">
            A cooktop, oven, hot water system, towel rail, underfloor heating, aircon/heating unit or spa/pool heater already
            on the plan is counted automatically once you set its rating on the symbol itself — only add something here if
            it isn't placed as a symbol at all.
          </p>
        ) : (
          <div className="space-y-2">
            {loadItems.map((item) => {
              const isEditing = editingId === item.id;
              const flag = isFlagGroup(item.load_group);
              return (
                <Card key={item.id} className="p-3 rounded-xl">
                  {isEditing ? (
                    <div className="space-y-2">
                      <Input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} placeholder="Label" />
                      <Select value={editGroup} onValueChange={setEditGroup}>
                        <SelectTrigger>
                          <SelectValue placeholder="AS3000 load group" />
                        </SelectTrigger>
                        <SelectContent>
                          {MANUAL_LOAD_GROUPS.map((g) => (
                            <SelectItem key={g.key} value={g.key}>
                              {g.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {!isFlagGroup(editGroup) && (
                        <div className="flex gap-2">
                          <Input type="number" placeholder="Rating (W)" value={editRatingW} onChange={(e) => setEditRatingW(e.target.value)} className="flex-1" />
                          <Input type="number" placeholder="Qty" value={editQuantity} onChange={(e) => setEditQuantity(e.target.value)} className="w-20" />
                        </div>
                      )}
                      <div className="flex gap-2">
                        <Button variant="ghost" size="sm" className="flex-1 gap-1.5" onClick={cancelEdit}>
                          <X className="h-3.5 w-3.5" /> Cancel
                        </Button>
                        <Button size="sm" className="flex-1 gap-1.5" disabled={!editLabel.trim() || updateLoadItem.isPending} onClick={saveEdit}>
                          {updateLoadItem.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          Save
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-2">
                      <button type="button" className="flex-1 min-w-0 text-left" onClick={() => startEdit(item)}>
                        <p className="text-sm font-semibold text-foreground truncate">{item.label}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {labelForGroup(item.load_group)}
                          {!flag && ` · ${item.rating_w} W${item.quantity > 1 ? ` × ${item.quantity}` : ""}`}
                        </p>
                      </button>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => startEdit(item)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDelete(item.id)}
                          disabled={deletingId === item.id}
                        >
                          {deletingId === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Phase balance — three-phase jobs only. Recommends which of the
          three incoming lines (A/B/C) each circuit should land on, worked
          out from each circuit's own breaker rating (the figure actually
          available at rough-in, before real measured loads exist) via a
          greedy balance calculation — see setoutPhaseBalance.ts for why
          that's a plain calculation rather than an AI call. */}
      {supplyPhase === "three" && phaseBalance && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold text-foreground">Phase balance</h3>
            <Button size="sm" variant="outline" className="h-8" disabled={applyingPhaseBalance || circuits.length === 0} onClick={handleApplyPhaseBalance}>
              {applyingPhaseBalance ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Apply recommendation"}
            </Button>
          </div>
          {circuits.length === 0 ? (
            <p className="text-xs text-muted-foreground py-3">Add circuits first to get a phase-split recommendation.</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 mb-2">
                {PHASES.map((phase) => (
                  <Card key={phase} className="p-2 rounded-xl text-center">
                    <p className="text-[11px] text-muted-foreground">Phase {phase}</p>
                    <p className="text-sm font-semibold text-foreground">{phaseBalance.totalsByPhase[phase].toFixed(0)} A</p>
                  </Card>
                ))}
              </div>
              <div className="space-y-1.5">
                {circuits.map((c) => {
                  const isThreePhase = phaseBalance.threePhaseCircuitIds.includes(c.id);
                  const rec = phaseBalance.recommendations.find((r) => r.circuitId === c.id);
                  const currentPhase = c.specs.boardPhase;
                  return (
                    <div key={c.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate min-w-0 flex-1 text-muted-foreground">
                        {c.label}
                        {rec?.weightAmps == null && !isThreePhase && " (no breaker rating set)"}
                      </span>
                      {isThreePhase ? (
                        <span className="text-[11px] text-muted-foreground flex-shrink-0">3-phase (all lines)</span>
                      ) : (
                        <div className="flex gap-1 flex-shrink-0">
                          {PHASES.map((phase) => {
                            const active = (currentPhase ?? rec?.phase) === phase;
                            return (
                              <button
                                key={phase}
                                type="button"
                                onClick={() => handleSetCircuitPhase(c.id, phase)}
                                className={cn(
                                  "h-6 w-6 rounded text-[11px] font-medium border",
                                  active ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground"
                                )}
                              >
                                {phase}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
          <p className="text-[10px] text-muted-foreground mt-2">
            Recommended from each circuit's breaker rating, balanced to keep the three lines as even as possible — a
            calculation, not a measured load. Highlighted phase is whatever's already saved on the circuit, defaulting to the
            recommendation until you apply or change it.
          </p>
        </div>
      )}

      {/* Solar — driven entirely by "Solar inverter" symbols placed on the
          plan (set their output/cable specs there, in the palette panel),
          not a separate manual entry here. Separate from the consumption-
          only Max Demand calc above (AS/NZS 3000 Appendix C has no concept
          of generation/export) — this just checks each inverter's AC output
          voltage rise against AS/NZS 4777.1's 2% limit. */}
      <div>
        <h3 className="text-sm font-bold text-foreground mb-2">Solar</h3>
        {solarInverters.length === 0 ? (
          <p className="text-xs text-muted-foreground py-3">
            Place a "Solar inverter" symbol from the palette and set its output/cable details there to check voltage rise.
          </p>
        ) : (
          <div className="space-y-2">
            {solarInverters.map((inverter) => {
              const specs = inverter.specs;
              const board = nearestSwitchboard(inverter, fittings);
              const runLengthM = board ? distance(inverter.position, board.position) : null;
              const isAc = (specs.inverterSystemType ?? "ac") === "ac";
              const rise =
                isAc && specs.inverterCableMaterial && specs.inverterCableCsaMm2 && runLengthM && specs.inverterOutputAmps
                  ? calculateSolarVoltageRise({
                      material: specs.inverterCableMaterial,
                      cableCsaMm2: specs.inverterCableCsaMm2,
                      systemType: "ac",
                      phase: specs.inverterPhase,
                      runLengthM,
                      currentAmps: specs.inverterOutputAmps,
                      supplyVoltage: specs.inverterPhase === "three" ? 400 : 230,
                    })
                  : null;
              return (
                <Card key={inverter.id} className="p-3 rounded-xl">
                  <p className="text-sm font-semibold text-foreground truncate flex items-center gap-1.5">
                    <Sun className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" /> Solar inverter
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {specs.inverterCableMaterial ?? "—"} {specs.inverterCableCsaMm2 ? `${specs.inverterCableCsaMm2}mm²` : "—"} ·{" "}
                    {runLengthM != null ? `${runLengthM.toFixed(1)}m to nearest switchboard` : "no switchboard placed"} ·{" "}
                    {specs.inverterOutputAmps ?? "—"}A
                    {!isAc && " (DC string — not voltage-rise checked)"}
                  </p>
                  {rise ? (
                    <p className={`text-xs font-semibold mt-1 ${rise.pass ? "text-emerald-600" : "text-destructive"}`}>
                      {rise.pass ? "PASS" : "FAIL"} — {rise.voltageRisePercent.toFixed(2)}% voltage rise
                      {!rise.pass && " — try a larger CSA or shorter run"}
                    </p>
                  ) : isAc ? (
                    <p className="text-xs text-muted-foreground mt-1">
                      Select this symbol on the plan and set its output current, cable material and CSA to check voltage rise.
                    </p>
                  ) : null}
                </Card>
              );
            })}
          </div>
        )}
        <p className="text-[10px] text-muted-foreground mt-2">
          Run length is the straight-line distance to the nearest switchboard on the plan, not a routed cable path — verify the
          actual run on site. Voltage rise estimated to AS/NZS 4777.1's 2% inverter-output limit using AS/NZS 3008.1.1 cable
          figures — advisory only, verify against the datasheet and DNSP requirements before final cable selection.
        </p>
      </div>

      {/* Live total */}
      <Card className="p-3 rounded-xl bg-primary/5 border-primary/20">
        <div className="flex items-center justify-between mb-2 gap-2">
          <p className="text-sm font-bold text-foreground flex items-center gap-1.5">
            <Gauge className="h-4 w-4 text-primary" /> Maximum demand
          </p>
          <div className="flex rounded-lg border border-border overflow-hidden flex-shrink-0">
            {(["single", "three"] as const).map((phase) => (
              <button
                key={phase}
                type="button"
                onClick={() => handlePhaseChange(phase)}
                className={cn(
                  "px-2 py-1 text-[11px] font-medium capitalize",
                  supplyPhase === phase ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/50"
                )}
              >
                {phase}-phase
              </button>
            ))}
          </div>
        </div>
        {contributingGroups.length > 0 && (
          <div className="space-y-1 mb-2">
            {contributingGroups.map((g) => (
              <div key={g.key} className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                {/* min-w-0 is required for truncate to work inside a flex
                    item — without it a long label (e.g. the cooking/laundry
                    group's name) refuses to shrink and stretches the whole
                    dialog wider than the screen instead of ellipsizing. */}
                <span className="truncate min-w-0 flex-1">{g.label}</span>
                <span className="flex-shrink-0">{g.amps.toFixed(1)} A</span>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-baseline justify-between pt-2 border-t border-border">
          <span className="text-sm font-semibold text-foreground">
            Total demand{supplyPhase === "three" && <span className="font-normal text-muted-foreground"> (per line)</span>}
          </span>
          <span className="text-lg font-extrabold text-foreground">
            {result.totalAmps.toFixed(1)} A <span className="text-xs font-medium text-muted-foreground">({result.totalKva.toFixed(1)} kVA)</span>
          </span>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">
          Assessed to AS/NZS 3000:2018 Appendix C, domestic installation (Table C1), {supplyPhase}-phase supply — verify
          before sizing consumer mains.
          {supplyPhase === "three" &&
            " Three-phase total assumes the load is evenly balanced across all three phases — check your actual circuit-to-phase allocation."}
        </p>
      </Card>
    </div>
  );
}
