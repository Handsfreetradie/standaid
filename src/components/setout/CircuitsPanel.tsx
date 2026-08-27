import { useState } from "react";
import { Loader2, Plus, Trash2, Pencil, Check, X, Zap } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { FITTING_LABELS, FITTING_SYMBOLS } from "@/components/setout/symbols";
import { useSetoutFittings } from "@/hooks/useSetoutPlans";
import {
  useSetoutCircuits,
  useCreateSetoutCircuit,
  useUpdateSetoutCircuit,
  useDeleteSetoutCircuit,
  useAssignFittingCircuit,
} from "@/hooks/useSetoutCircuits";
import { colorForCircuit, type SetoutCircuit } from "@/lib/setoutTypes";

interface CircuitsPanelProps {
  planId: string;
}

export default function CircuitsPanel({ planId }: CircuitsPanelProps) {
  const { data: circuits = [], isLoading: circuitsLoading } = useSetoutCircuits(planId);
  const { data: fittings = [], isLoading: fittingsLoading } = useSetoutFittings(planId);

  const createCircuit = useCreateSetoutCircuit(planId);
  const updateCircuit = useUpdateSetoutCircuit(planId);
  const deleteCircuit = useDeleteSetoutCircuit(planId);
  const assignFitting = useAssignFittingCircuit(planId);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newBreaker, setNewBreaker] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editBreaker, setEditBreaker] = useState("");

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const isLoading = circuitsLoading || fittingsLoading;

  const handleCreate = async () => {
    if (!newLabel.trim()) return;
    try {
      await createCircuit.mutateAsync({
        label: newLabel.trim(),
        description: newDescription.trim() || undefined,
        breaker_rating: newBreaker.trim() || undefined,
      });
      setNewLabel("");
      setNewDescription("");
      setNewBreaker("");
      setShowAddForm(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the circuit");
    }
  };

  const startEdit = (circuit: SetoutCircuit) => {
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

  const handleAssign = async (fittingId: string, circuitId: string) => {
    try {
      await assignFitting.mutateAsync({ fittingId, circuitId: circuitId === "unassigned" ? null : circuitId });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not assign the fitting");
    }
  };

  const unassignedFittings = fittings.filter((f) => !f.circuit_id);
  const fittingsByCircuit = (circuitId: string) => fittings.filter((f) => f.circuit_id === circuitId);

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Circuits */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-bold text-foreground">Circuits</h3>
          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setShowAddForm((v) => !v)}>
            <Plus className="h-3.5 w-3.5" /> Add circuit
          </Button>
        </div>

        {showAddForm && (
          <Card className="p-3 mb-2 space-y-2 rounded-xl">
            <Input
              placeholder="Circuit label (e.g. Circuit 1 — Kitchen lights)"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
            />
            <Input placeholder="Description (optional)" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} />
            <Input
              placeholder="Breaker rating (optional, e.g. 16A)"
              value={newBreaker}
              onChange={(e) => setNewBreaker(e.target.value)}
            />
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" className="flex-1" onClick={() => setShowAddForm(false)}>
                Cancel
              </Button>
              <Button size="sm" className="flex-1 gap-1.5" disabled={!newLabel.trim() || createCircuit.isPending} onClick={handleCreate}>
                {createCircuit.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
              </Button>
            </div>
          </Card>
        )}

        {circuits.length === 0 ? (
          <p className="text-xs text-muted-foreground py-3">No circuits yet. Add one to start building the switchboard legend.</p>
        ) : (
          <div className="space-y-2">
            {circuits.map((circuit) => {
              const isEditing = editingId === circuit.id;
              return (
                <Card key={circuit.id} className="p-3 rounded-xl">
                  {isEditing ? (
                    <div className="space-y-2">
                      <Input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} placeholder="Circuit label" />
                      <Input
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        placeholder="Description (optional)"
                      />
                      <Input
                        value={editBreaker}
                        onChange={(e) => setEditBreaker(e.target.value)}
                        placeholder="Breaker rating (optional)"
                      />
                      <div className="flex gap-2">
                        <Button variant="ghost" size="sm" className="flex-1 gap-1.5" onClick={cancelEdit}>
                          <X className="h-3.5 w-3.5" /> Cancel
                        </Button>
                        <Button
                          size="sm"
                          className="flex-1 gap-1.5"
                          disabled={!editLabel.trim() || updateCircuit.isPending}
                          onClick={saveEdit}
                        >
                          {updateCircuit.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          Save
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-2">
                      <button type="button" className="flex-1 min-w-0 text-left flex items-start gap-2" onClick={() => startEdit(circuit)}>
                        <span
                          className="mt-1.5 h-2.5 w-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: colorForCircuit(circuits, circuit.id) ?? undefined }}
                        />
                        <span className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">{circuit.label}</p>
                          {circuit.description && <p className="text-xs text-muted-foreground truncate">{circuit.description}</p>}
                          {circuit.breaker_rating && (
                            <span className="inline-block mt-1 text-[10px] font-medium text-primary bg-primary/10 rounded px-1.5 py-0.5">
                              {circuit.breaker_rating}
                            </span>
                          )}
                        </span>
                      </button>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          onClick={() => startEdit(circuit)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDelete(circuit.id)}
                          disabled={deletingId === circuit.id}
                        >
                          {deletingId === circuit.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
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

      {/* Switchboard legend — auto-generated from circuits + assigned fittings, not stored separately */}
      <div>
        <h3 className="text-sm font-bold text-foreground mb-2 flex items-center gap-1.5">
          <Zap className="h-4 w-4 text-primary" /> Switchboard legend
        </h3>
        {circuits.length === 0 ? (
          <p className="text-xs text-muted-foreground py-3">Add a circuit above to start generating the legend.</p>
        ) : (
          <div className="space-y-2">
            {circuits.map((circuit) => {
              const assigned = fittingsByCircuit(circuit.id);
              const color = colorForCircuit(circuits, circuit.id);
              return (
                <Card key={circuit.id} className="p-3 rounded-xl">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color ?? undefined }} />
                      {circuit.label}
                    </p>
                    <div className="flex items-center gap-2">
                      {circuit.breaker_rating && (
                        <span className="text-[10px] font-medium text-primary bg-primary/10 rounded px-1.5 py-0.5">
                          {circuit.breaker_rating}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {assigned.length} point{assigned.length === 1 ? "" : "s"}
                      </span>
                    </div>
                  </div>
                  {assigned.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No points assigned</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {assigned.map((fitting) => {
                        const Icon = FITTING_SYMBOLS[fitting.type];
                        return (
                          <span
                            key={fitting.id}
                            className="inline-flex items-center gap-1 rounded-md border px-1.5 py-1 text-[11px] text-foreground"
                            style={color ? { borderColor: `${color}66`, backgroundColor: `${color}14` } : undefined}
                          >
                            <Icon size={14} strokeWidth={1.5} style={color ? { color } : undefined} className={color ? undefined : "text-primary"} />
                            {FITTING_LABELS[fitting.type]}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Unassigned fittings */}
      <Accordion type="single" collapsible>
        <AccordionItem value="unassigned" className="border-b-0">
          <AccordionTrigger className="py-0 text-sm font-bold text-foreground hover:no-underline">
            Unassigned fittings
            {unassignedFittings.length > 0 && <span className="ml-1.5 text-xs font-medium text-muted-foreground">({unassignedFittings.length})</span>}
          </AccordionTrigger>
          <AccordionContent className="pt-2">
            {unassignedFittings.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3">All placed fittings are assigned to a circuit.</p>
            ) : circuits.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3">Create a circuit above first, then assign these fittings to it.</p>
            ) : (
              <div className="space-y-2">
                {unassignedFittings.map((fitting) => {
                  const Icon = FITTING_SYMBOLS[fitting.type];
                  return (
                    <Card key={fitting.id} className="p-2.5 flex items-center gap-2.5 rounded-xl">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 flex-shrink-0">
                        <Icon size={16} className="text-primary" strokeWidth={1.5} />
                      </div>
                      <p className="flex-1 text-sm font-medium text-foreground truncate">{FITTING_LABELS[fitting.type]}</p>
                      <Select onValueChange={(value) => handleAssign(fitting.id, value)}>
                        <SelectTrigger className="w-40 h-9">
                          <SelectValue placeholder="Assign to circuit" />
                        </SelectTrigger>
                        <SelectContent>
                          {circuits.map((circuit) => (
                            <SelectItem key={circuit.id} value={circuit.id}>
                              {circuit.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Card>
                  );
                })}
              </div>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
