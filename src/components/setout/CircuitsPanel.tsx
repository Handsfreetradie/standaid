import { useState } from "react";
import { Loader2, Plus, Trash2, Pencil, Check, X, Zap, ChevronUp, ChevronDown, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { FITTING_LABELS, FITTING_SYMBOLS } from "@/components/setout/symbols";
import { useSetoutFittings } from "@/hooks/useSetoutPlans";
import {
  useSetoutCircuits,
  useCreateSetoutCircuit,
  useUpdateSetoutCircuit,
  useDeleteSetoutCircuit,
  useReorderSetoutCircuit,
  useAssignFittingCircuit,
} from "@/hooks/useSetoutCircuits";
import { colorForCircuit, type CircuitCableType, type CircuitDeviceType, type SetoutCircuit } from "@/lib/setoutTypes";
import {
  CIRCUIT_CABLE_TYPE_LABELS,
  CIRCUIT_DEVICE_TYPE_LABELS,
  CIRCUIT_PURPOSE_LABELS,
  circuitWarnings,
  defaultCircuitSpec,
  formatCircuitCable,
  formatCircuitDevice,
  type CircuitPurpose,
} from "@/lib/setoutCircuitSchedule";

// Common Australian domestic cable sizes offered in the cable-size select —
// covers everything defaultCircuitSpec ever prefills plus the next size up,
// rather than a free-text field the legend/warnings would then need to
// re-parse.
const CABLE_CSA_OPTIONS = [1.5, 2.5, 4, 6, 10, 16];
const DEVICE_TYPE_OPTIONS: CircuitDeviceType[] = ["mcb", "rcbo", "rcd_mcb", "main_switch", "other"];
const CABLE_TYPE_OPTIONS: CircuitCableType[] = ["tps", "xlpe", "orange_circular"];
const CIRCUIT_PURPOSE_OPTIONS: CircuitPurpose[] = ["lighting", "power", "oven", "cooktop", "hot_water", "ac", "ev_charger"];

// A device with its own built-in RCD — the RCD checkbox is auto-checked and
// locked for these, since unchecking it would misrepresent what the device
// actually is.
function deviceHasBuiltInRcd(deviceType: CircuitDeviceType | ""): boolean {
  return deviceType === "rcbo" || deviceType === "rcd_mcb";
}

// The compact device/poles/cable/RCD input group shared by the add form and
// both edit forms (Circuits list + Switchboard legend edit in place) — one
// definition so the three stay in sync rather than drifting apart.
interface ScheduleFieldsProps {
  deviceType: CircuitDeviceType | "";
  onDeviceTypeChange: (value: CircuitDeviceType) => void;
  poles: 1 | 3;
  onPolesChange: (value: 1 | 3) => void;
  cableCsa: string;
  onCableCsaChange: (value: string) => void;
  cableType: CircuitCableType | "";
  onCableTypeChange: (value: CircuitCableType) => void;
  rcd: boolean;
  onRcdChange: (value: boolean) => void;
  idPrefix: string;
}

function ScheduleFields({
  deviceType,
  onDeviceTypeChange,
  poles,
  onPolesChange,
  cableCsa,
  onCableCsaChange,
  cableType,
  onCableTypeChange,
  rcd,
  onRcdChange,
  idPrefix,
}: ScheduleFieldsProps) {
  const rcdLocked = deviceHasBuiltInRcd(deviceType);
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Select value={deviceType || undefined} onValueChange={(v) => onDeviceTypeChange(v as CircuitDeviceType)}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Device type" />
          </SelectTrigger>
          <SelectContent>
            {DEVICE_TYPE_OPTIONS.map((d) => (
              <SelectItem key={d} value={d}>
                {CIRCUIT_DEVICE_TYPE_LABELS[d]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={String(poles)} onValueChange={(v) => onPolesChange(Number(v) as 1 | 3)}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Poles" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">1 pole</SelectItem>
            <SelectItem value="3">3 pole</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Select value={cableCsa || undefined} onValueChange={onCableCsaChange}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Cable size" />
          </SelectTrigger>
          <SelectContent>
            {CABLE_CSA_OPTIONS.map((csa) => (
              <SelectItem key={csa} value={String(csa)}>
                {csa} mm²
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={cableType || undefined} onValueChange={(v) => onCableTypeChange(v as CircuitCableType)}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Cable type" />
          </SelectTrigger>
          <SelectContent>
            {CABLE_TYPE_OPTIONS.map((c) => (
              <SelectItem key={c} value={c}>
                {CIRCUIT_CABLE_TYPE_LABELS[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Label htmlFor={`${idPrefix}-rcd`} className="flex items-center gap-2 text-xs font-normal text-foreground">
        <Checkbox id={`${idPrefix}-rcd`} checked={rcd} disabled={rcdLocked} onCheckedChange={(v) => onRcdChange(v === true)} />
        RCD protected (30 mA){rcdLocked ? " — built into device" : ""}
      </Label>
    </div>
  );
}

interface CircuitsPanelProps {
  planId: string;
}

export default function CircuitsPanel({ planId }: CircuitsPanelProps) {
  const { data: circuits = [], isLoading: circuitsLoading } = useSetoutCircuits(planId);
  const { data: fittings = [], isLoading: fittingsLoading } = useSetoutFittings(planId);

  const createCircuit = useCreateSetoutCircuit(planId);
  const updateCircuit = useUpdateSetoutCircuit(planId);
  const deleteCircuit = useDeleteSetoutCircuit(planId);
  const reorderCircuit = useReorderSetoutCircuit(planId);
  const assignFitting = useAssignFittingCircuit(planId);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newBreaker, setNewBreaker] = useState("");
  const [newPurpose, setNewPurpose] = useState<CircuitPurpose | "">("");
  const [newDeviceType, setNewDeviceType] = useState<CircuitDeviceType | "">("");
  const [newPoles, setNewPoles] = useState<1 | 3>(1);
  const [newCableCsa, setNewCableCsa] = useState<string>("");
  const [newCableType, setNewCableType] = useState<CircuitCableType | "">("");
  const [newRcd, setNewRcd] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editBreaker, setEditBreaker] = useState("");
  const [editDeviceType, setEditDeviceType] = useState<CircuitDeviceType | "">("");
  const [editPoles, setEditPoles] = useState<1 | 3>(1);
  const [editCableCsa, setEditCableCsa] = useState<string>("");
  const [editCableType, setEditCableType] = useState<CircuitCableType | "">("");
  const [editRcd, setEditRcd] = useState(false);
  const [editNotes, setEditNotes] = useState("");

  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Applying a purpose prefill just seeds the fields the tradie is about to
  // see — it never overwrites anything they've already typed by hand, so
  // picking a purpose after tweaking other fields doesn't clobber them.
  const applyPurposePrefill = (purpose: CircuitPurpose | "") => {
    setNewPurpose(purpose);
    if (!purpose) return;
    const spec = defaultCircuitSpec(purpose);
    setNewBreaker(spec.breaker_rating);
    setNewDeviceType(spec.device_type);
    setNewPoles(spec.poles);
    setNewCableCsa(String(spec.cable_csa_mm2));
    setNewCableType(spec.cable_type);
    setNewRcd(spec.rcd_protected);
  };

  const handleNewDeviceTypeChange = (value: CircuitDeviceType) => {
    setNewDeviceType(value);
    if (deviceHasBuiltInRcd(value)) setNewRcd(true);
  };

  const handleEditDeviceTypeChange = (value: CircuitDeviceType) => {
    setEditDeviceType(value);
    if (deviceHasBuiltInRcd(value)) setEditRcd(true);
  };

  const resetNewScheduleFields = () => {
    setNewPurpose("");
    setNewDeviceType("");
    setNewPoles(1);
    setNewCableCsa("");
    setNewCableType("");
    setNewRcd(false);
  };

  const isLoading = circuitsLoading || fittingsLoading;

  const handleCreate = async () => {
    if (!newLabel.trim()) return;
    try {
      await createCircuit.mutateAsync({
        label: newLabel.trim(),
        description: newDescription.trim() || undefined,
        breaker_rating: newBreaker.trim() || undefined,
        device_type: newDeviceType || null,
        poles: newDeviceType ? newPoles : null,
        cable_csa_mm2: newCableCsa ? Number(newCableCsa) : null,
        cable_type: newCableType || null,
        rcd_protected: newDeviceType ? newRcd : null,
      });
      setNewLabel("");
      setNewDescription("");
      setNewBreaker("");
      resetNewScheduleFields();
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
    setEditDeviceType(circuit.device_type || "");
    setEditPoles(circuit.poles || 1);
    setEditCableCsa(circuit.cable_csa_mm2 != null ? String(circuit.cable_csa_mm2) : "");
    setEditCableType(circuit.cable_type || "");
    setEditRcd(circuit.rcd_protected ?? deviceHasBuiltInRcd(circuit.device_type || ""));
    setEditNotes(circuit.notes || "");
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
        device_type: editDeviceType || null,
        poles: editDeviceType ? editPoles : null,
        cable_csa_mm2: editCableCsa ? Number(editCableCsa) : null,
        cable_type: editCableType || null,
        rcd_protected: editDeviceType ? editRcd : null,
        notes: editNotes.trim() || null,
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

  // This order is what the switchboard legend prints in — moving a circuit
  // here is how a tradie matches the legend to the actual pole layout on
  // the board.
  const handleReorder = async (circuitId: string, direction: "up" | "down") => {
    try {
      await reorderCircuit.mutateAsync({ circuitId, direction });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not reorder the circuit");
    }
  };

  // Sanitary fixtures (bath/shower/basin) are a Cl 6.2 zone reference, not an
  // electrical point — never a real "unassigned circuit" gap.
  const unassignedFittings = fittings.filter((f) => !f.circuit_id && f.category !== "sanitary");
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
            <Select value={newPurpose || undefined} onValueChange={(v) => applyPurposePrefill(v as CircuitPurpose)}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Quick fill (optional) — prefills device/cable" />
              </SelectTrigger>
              <SelectContent>
                {CIRCUIT_PURPOSE_OPTIONS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {CIRCUIT_PURPOSE_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="Breaker rating (optional, e.g. 20 A)"
              value={newBreaker}
              onChange={(e) => setNewBreaker(e.target.value)}
            />
            <ScheduleFields
              idPrefix="new-circuit"
              deviceType={newDeviceType}
              onDeviceTypeChange={handleNewDeviceTypeChange}
              poles={newPoles}
              onPolesChange={setNewPoles}
              cableCsa={newCableCsa}
              onCableCsaChange={setNewCableCsa}
              cableType={newCableType}
              onCableTypeChange={setNewCableType}
              rcd={newRcd}
              onRcdChange={setNewRcd}
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
            {circuits.map((circuit, index) => {
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
                      <ScheduleFields
                        idPrefix={`edit-circuit-${circuit.id}`}
                        deviceType={editDeviceType}
                        onDeviceTypeChange={handleEditDeviceTypeChange}
                        poles={editPoles}
                        onPolesChange={setEditPoles}
                        cableCsa={editCableCsa}
                        onCableCsaChange={setEditCableCsa}
                        cableType={editCableType}
                        onCableTypeChange={setEditCableType}
                        rcd={editRcd}
                        onRcdChange={setEditRcd}
                      />
                      <Input value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="Notes (optional)" />
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
                          <span className="mt-1 flex flex-wrap gap-1">
                            <span className="inline-block text-[10px] font-medium text-primary bg-primary/10 rounded px-1.5 py-0.5">
                              {formatCircuitDevice(circuit)}
                            </span>
                            {(circuit.cable_csa_mm2 != null || circuit.cable_type) && (
                              <span className="inline-block text-[10px] font-medium text-muted-foreground bg-muted rounded px-1.5 py-0.5">
                                {formatCircuitCable(circuit)}
                              </span>
                            )}
                          </span>
                          {circuitWarnings(circuit, fittingsByCircuit(circuit.id)).map((warning, wi) => (
                            <span key={wi} className="mt-1 flex items-start gap-1 text-[10px] leading-tight text-amber-600 dark:text-amber-500">
                              <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" />
                              {warning}
                            </span>
                          ))}
                        </span>
                      </button>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          onClick={() => handleReorder(circuit.id, "up")}
                          disabled={index === 0 || reorderCircuit.isPending}
                          title="Move up"
                        >
                          <ChevronUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          onClick={() => handleReorder(circuit.id, "down")}
                          disabled={index === circuits.length - 1 || reorderCircuit.isPending}
                          title="Move down"
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </Button>
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
            {circuits.map((circuit, index) => {
              const assigned = fittingsByCircuit(circuit.id);
              const color = colorForCircuit(circuits, circuit.id);
              const isEditing = editingId === circuit.id;
              return (
                <Card key={circuit.id} className="p-3 rounded-xl">
                  {isEditing ? (
                    // Same edit state/handlers as the Circuits list above —
                    // editing from either place keeps them in sync, so a
                    // tradie checking the legend doesn't need to scroll back
                    // up to fix a label or breaker rating.
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
                      <ScheduleFields
                        idPrefix={`legend-circuit-${circuit.id}`}
                        deviceType={editDeviceType}
                        onDeviceTypeChange={handleEditDeviceTypeChange}
                        poles={editPoles}
                        onPolesChange={setEditPoles}
                        cableCsa={editCableCsa}
                        onCableCsaChange={setEditCableCsa}
                        cableType={editCableType}
                        onCableTypeChange={setEditCableType}
                        rcd={editRcd}
                        onRcdChange={setEditRcd}
                      />
                      <Input value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="Notes (optional)" />
                      <div className="flex items-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          onClick={() => handleReorder(circuit.id, "up")}
                          disabled={index === 0 || reorderCircuit.isPending}
                          title="Move up"
                        >
                          <ChevronUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          onClick={() => handleReorder(circuit.id, "down")}
                          disabled={index === circuits.length - 1 || reorderCircuit.isPending}
                          title="Move down"
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
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
                        <div className="flex-1" />
                        <Button variant="ghost" size="sm" className="gap-1.5" onClick={cancelEdit}>
                          <X className="h-3.5 w-3.5" /> Cancel
                        </Button>
                        <Button
                          size="sm"
                          className="gap-1.5"
                          disabled={!editLabel.trim() || updateCircuit.isPending}
                          onClick={saveEdit}
                        >
                          {updateCircuit.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          Save
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <button type="button" className="w-full text-left" onClick={() => startEdit(circuit)}>
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <p className="text-sm font-semibold text-foreground flex items-center gap-2 min-w-0">
                            <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color ?? undefined }} />
                            <span className="truncate">{circuit.label}</span>
                          </p>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-[10px] font-medium text-primary bg-primary/10 rounded px-1.5 py-0.5">
                              {formatCircuitDevice(circuit)}
                            </span>
                            {(circuit.cable_csa_mm2 != null || circuit.cable_type) && (
                              <span className="hidden sm:inline text-[10px] font-medium text-muted-foreground bg-muted rounded px-1.5 py-0.5">
                                {formatCircuitCable(circuit)}
                              </span>
                            )}
                            <span className="text-xs text-muted-foreground">
                              {assigned.length} point{assigned.length === 1 ? "" : "s"}
                            </span>
                            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                          </div>
                        </div>
                      </button>
                      {circuitWarnings(circuit, assigned).map((warning, wi) => (
                        <p key={wi} className="mb-1.5 flex items-start gap-1 text-[10px] leading-tight text-amber-600 dark:text-amber-500">
                          <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" />
                          {warning}
                        </p>
                      ))}
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
                    </>
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
