import { useState } from "react";
import { Loader2, Plus, Trash2, Pencil, Check, X, ChevronUp, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSetoutFittings } from "@/hooks/useSetoutPlans";
import { useProfile } from "@/hooks/useData";
import {
  useSetoutCircuits,
  useCreateSetoutCircuit,
  useUpdateSetoutCircuit,
  useDeleteSetoutCircuit,
  useReorderSetoutCircuit,
} from "@/hooks/useSetoutCircuits";
import { buildFittingCodes } from "@/lib/setoutReport";
import { colorForCircuit, type SetoutPlan } from "@/lib/setoutTypes";

interface SwitchboardLegendPreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: SetoutPlan;
}

// Matches the PDF export's own minimum — a real switchboard has a fixed
// number of pole positions, so the preview should look like the printed
// page, spare ways and all, not just a plain list of what's assigned.
const MIN_CIRCUIT_SPOTS = 18;

export default function SwitchboardLegendPreview({ open, onOpenChange, plan }: SwitchboardLegendPreviewProps) {
  const planId = plan.id;
  const { data: circuits = [] } = useSetoutCircuits(planId);
  const { data: fittings = [] } = useSetoutFittings(planId);
  const { data: profile } = useProfile();

  const createCircuit = useCreateSetoutCircuit(planId);
  const updateCircuit = useUpdateSetoutCircuit(planId);
  const deleteCircuit = useDeleteSetoutCircuit(planId);
  const reorderCircuit = useReorderSetoutCircuit(planId);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newBreaker, setNewBreaker] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editBreaker, setEditBreaker] = useState("");

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const codes = buildFittingCodes(fittings);
  const unassigned = fittings.filter((f) => !f.circuit_id);

  const p = (profile as any) || {};
  const businessLines = [
    p.business_name || p.display_name,
    p.licence_number ? `Licence No. ${p.licence_number}` : null,
    p.business_phone ? `Ph: ${p.business_phone}` : null,
    p.business_email || null,
  ].filter(Boolean) as string[];

  const resetAddForm = () => {
    setNewLabel("");
    setNewDescription("");
    setNewBreaker("");
    setShowAddForm(false);
  };

  const handleCreate = async () => {
    if (!newLabel.trim()) return;
    try {
      await createCircuit.mutateAsync({
        label: newLabel.trim(),
        description: newDescription.trim() || undefined,
        breaker_rating: newBreaker.trim() || undefined,
      });
      resetAddForm();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the circuit");
    }
  };

  const startEdit = (circuit: (typeof circuits)[number]) => {
    setEditingId(circuit.id);
    setEditLabel(circuit.label);
    setEditDescription(circuit.description || "");
    setEditBreaker(circuit.breaker_rating || "");
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = async () => {
    if (!editingId || !editLabel.trim()) return;
    try {
      await updateCircuit.mutateAsync({
        circuitId: editingId,
        label: editLabel.trim(),
        description: editDescription.trim(),
        breaker_rating: editBreaker.trim(),
      });
      setEditingId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the circuit");
    }
  };

  const handleDelete = async (circuitId: string) => {
    if (!window.confirm("Delete this circuit? Fittings assigned to it will become unassigned.")) return;
    setDeletingId(circuitId);
    try {
      await deleteCircuit.mutateAsync(circuitId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete the circuit");
    } finally {
      setDeletingId(null);
    }
  };

  const handleReorder = async (circuitId: string, direction: "up" | "down") => {
    try {
      await reorderCircuit.mutateAsync({ circuitId, direction });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not reorder the circuit");
    }
  };

  // One row per circuit, plus an "Unassigned" row if there's anything to
  // show there, plus blank padding rows up to MIN_CIRCUIT_SPOTS — same
  // shape as drawSwitchboardPage in setoutReport.ts.
  const filledRows = circuits.length + (unassigned.length > 0 ? 1 : 0);
  const blankRowCount = Math.max(0, MIN_CIRCUIT_SPOTS - filledRows);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle>Switchboard legend</DialogTitle>
        </DialogHeader>

        {/* A loose on-screen approximation of the printed A4 page — same
            header, same numbered table, same 18-spot minimum — so what you
            see here is what exports. Not pixel-for-pixel (font/paper size
            differ on screen), just close enough to arrange things by. */}
        <div className="rounded-lg border-2 border-foreground/80 bg-white p-5 text-black">
          <div className="flex items-start justify-between gap-4 border-b border-border pb-3 mb-3">
            <div>
              <p className="text-lg font-bold">{plan.name || "Rough-in setout plan"}</p>
              {plan.job_reference && <p className="text-xs text-muted-foreground">Job ref: {plan.job_reference}</p>}
            </div>
            {businessLines.length > 0 && (
              <div className="text-right text-xs text-muted-foreground flex-shrink-0">
                {businessLines.map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
              </div>
            )}
          </div>

          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted/60 text-xs text-muted-foreground">
                <th className="py-1.5 px-1 text-center font-medium w-10">No.</th>
                <th className="py-1.5 px-2 text-left font-medium w-8"></th>
                <th className="py-1.5 px-2 text-left font-medium">Circuit</th>
                <th className="py-1.5 px-2 text-left font-medium w-20">Breaker</th>
                <th className="py-1.5 px-2 text-left font-medium">Points served</th>
              </tr>
            </thead>
            <tbody>
              {circuits.map((circuit, index) => {
                const assigned = fittings.filter((f) => f.circuit_id === circuit.id);
                const color = colorForCircuit(circuits, circuit.id);
                const isEditing = editingId === circuit.id;
                const pointsText = assigned.length === 0 ? "None assigned" : assigned.map((f) => codes.get(f.id) ?? "?").join(", ");

                if (isEditing) {
                  return (
                    <tr key={circuit.id} className={index % 2 === 1 ? "bg-muted/20" : undefined}>
                      <td colSpan={5} className="p-2">
                        <div className="space-y-2 rounded-lg border border-border bg-background p-3">
                          <div className="grid grid-cols-3 gap-2">
                            <Input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} placeholder="Circuit label" className="col-span-2" />
                            <Input value={editBreaker} onChange={(e) => setEditBreaker(e.target.value)} placeholder="Breaker (e.g. 16A)" />
                          </div>
                          <Input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} placeholder="Description (optional)" />
                          <div className="flex items-center gap-1">
                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => handleReorder(circuit.id, "up")} disabled={index === 0 || reorderCircuit.isPending} title="Move up">
                              <ChevronUp className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => handleReorder(circuit.id, "down")} disabled={index === circuits.length - 1 || reorderCircuit.isPending} title="Move down">
                              <ChevronDown className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(circuit.id)} disabled={deletingId === circuit.id}>
                              {deletingId === circuit.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                            </Button>
                            <div className="flex-1" />
                            <Button variant="ghost" size="sm" className="gap-1.5" onClick={cancelEdit}>
                              <X className="h-3.5 w-3.5" /> Cancel
                            </Button>
                            <Button size="sm" className="gap-1.5" disabled={!editLabel.trim() || updateCircuit.isPending} onClick={saveEdit}>
                              {updateCircuit.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                              Save
                            </Button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                }

                return (
                  <tr
                    key={circuit.id}
                    className={`cursor-pointer hover:bg-muted/40 ${index % 2 === 1 ? "bg-muted/20" : ""}`}
                    onClick={() => startEdit(circuit)}
                  >
                    <td className="py-1.5 px-1 text-center text-muted-foreground border-b border-border/60">{String(index + 1).padStart(2, "0")}</td>
                    <td className="py-1.5 px-2 border-b border-border/60">
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color ?? undefined }} />
                    </td>
                    <td className="py-1.5 px-2 border-b border-border/60">
                      <p className="font-medium">{circuit.label}</p>
                      {circuit.description && <p className="text-xs text-muted-foreground">{circuit.description}</p>}
                    </td>
                    <td className="py-1.5 px-2 border-b border-border/60 text-muted-foreground">{circuit.breaker_rating || "—"}</td>
                    <td className="py-1.5 px-2 border-b border-border/60 text-muted-foreground">{pointsText}</td>
                  </tr>
                );
              })}

              {unassigned.length > 0 && (
                <tr className={circuits.length % 2 === 1 ? "bg-muted/20" : undefined}>
                  <td className="py-1.5 px-1 text-center text-muted-foreground border-b border-border/60">{String(circuits.length + 1).padStart(2, "0")}</td>
                  <td className="py-1.5 px-2 border-b border-border/60">
                    <span className="inline-block h-2.5 w-2.5 rounded-full bg-muted-foreground/40" />
                  </td>
                  <td className="py-1.5 px-2 border-b border-border/60 font-medium">Unassigned</td>
                  <td className="py-1.5 px-2 border-b border-border/60 text-muted-foreground">—</td>
                  <td className="py-1.5 px-2 border-b border-border/60 text-muted-foreground">
                    {unassigned.map((f) => codes.get(f.id) ?? "?").join(", ")}
                  </td>
                </tr>
              )}

              {Array.from({ length: blankRowCount }, (_, i) => (
                <tr key={`blank-${i}`} className={(filledRows + i) % 2 === 1 ? "bg-muted/20" : undefined}>
                  <td className="py-1.5 px-1 text-center text-muted-foreground/50 border-b border-border/60">
                    {String(filledRows + i + 1).padStart(2, "0")}
                  </td>
                  <td className="py-1.5 px-2 border-b border-border/60" colSpan={4} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {showAddForm ? (
          <div className="space-y-2 rounded-lg border border-border p-3">
            <Input placeholder="Circuit label (e.g. Circuit 1 — Kitchen lights)" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Description (optional)" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} />
              <Input placeholder="Breaker rating (optional, e.g. 16A)" value={newBreaker} onChange={(e) => setNewBreaker(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" className="flex-1" onClick={resetAddForm}>
                Cancel
              </Button>
              <Button size="sm" className="flex-1 gap-1.5" disabled={!newLabel.trim() || createCircuit.isPending} onClick={handleCreate}>
                {createCircuit.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" size="sm" className="gap-1.5 w-fit" onClick={() => setShowAddForm(true)}>
            <Plus className="h-3.5 w-3.5" /> Add circuit
          </Button>
        )}

        <p className="text-xs text-muted-foreground">
          Click a row to edit it, or use the arrows to reorder — the exported PDF prints in this same order.
        </p>
      </DialogContent>
    </Dialog>
  );
}
