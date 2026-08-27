import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, MousePointerClick, Cable, CheckSquare, Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import SetoutCanvas, { type SetoutCanvasMode } from "@/components/setout/SetoutCanvas";
import FittingPalette from "@/components/setout/FittingPalette";
import LayerVisibilityToggle from "@/components/setout/LayerVisibilityToggle";
import SwitchLinksPanel from "@/components/setout/SwitchLinksPanel";
import type { FittingType } from "@/components/setout/symbols";
import { DEFAULT_LAYER_VISIBILITY, isSingleWallFitting, type FittingSpecs, type FittingStatus, type LayerVisibility, type MeasurementLock, type Point, type SetoutFitting } from "@/lib/setoutTypes";
import { autoRotationForWallMount, computeMeasurementLock, defaultHeightForType } from "@/lib/setoutGeometry";
import { generateSetoutReportPdf } from "@/lib/setoutReport";
import CircuitsPanel from "@/components/setout/CircuitsPanel";
import MeasurementListPanel from "@/components/setout/MeasurementListPanel";
import {
  useSetoutPlan,
  useSetoutFittings,
  useCreateSetoutFitting,
  useUpdateSetoutFittingPosition,
  useUpdateSetoutFittingSpecs,
  useUpdateSetoutFittingStatus,
  useUpdateSetoutFittingMeasurementLock,
  useUpdateSetoutPlanLayerVisibility,
  useToggleGangLink,
  useAddSwitchGang,
  useRemoveSwitchGang,
  useDeleteSetoutFitting,
} from "@/hooks/useSetoutPlans";
import { useSetoutCircuits, useAssignFittingCircuit } from "@/hooks/useSetoutCircuits";

type WorkspaceMode = Extract<SetoutCanvasMode, "place-fittings" | "link-switches" | "select-multiple">;

const SetoutPlan = () => {
  const { planId } = useParams();
  const navigate = useNavigate();

  const { data: plan, isLoading: planLoading } = useSetoutPlan(planId);
  const { data: fittings = [], isLoading: fittingsLoading } = useSetoutFittings(planId);
  const { data: circuits = [] } = useSetoutCircuits(planId);
  const [exporting, setExporting] = useState(false);

  const createFitting = useCreateSetoutFitting(planId || "");
  const updateFittingPosition = useUpdateSetoutFittingPosition(planId || "");
  const updateFittingSpecs = useUpdateSetoutFittingSpecs(planId || "");
  const updateFittingMeasurementLock = useUpdateSetoutFittingMeasurementLock(planId || "");
  const updateLayerVisibility = useUpdateSetoutPlanLayerVisibility(planId || "");
  const toggleGangLink = useToggleGangLink(planId || "");
  const addSwitchGang = useAddSwitchGang(planId || "");
  const removeSwitchGang = useRemoveSwitchGang(planId || "");
  const updateFittingStatus = useUpdateSetoutFittingStatus(planId || "");
  const deleteFitting = useDeleteSetoutFitting(planId || "");
  const assignFittingCircuit = useAssignFittingCircuit(planId || "");

  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("place-fittings");
  const [selectedType, setSelectedType] = useState<FittingType | null>(null);
  const [selectedFittingId, setSelectedFittingId] = useState<string | null>(null);
  const [activeSwitchId, setActiveSwitchId] = useState<string | null>(null);
  const [activeGangIndex, setActiveGangIndex] = useState(0);
  const [multiSelectIds, setMultiSelectIds] = useState<Set<string>>(new Set());
  const [bulkCircuitId, setBulkCircuitId] = useState<string>("unassigned");
  const [layerVisibility, setLayerVisibility] = useState<LayerVisibility>(DEFAULT_LAYER_VISIBILITY);
  const layerSyncedRef = useRef(false);

  useEffect(() => {
    if (plan && !layerSyncedRef.current) {
      setLayerVisibility(plan.layer_visibility);
      layerSyncedRef.current = true;
    }
  }, [plan]);

  const handleLayerVisibilityChange = (next: LayerVisibility) => {
    setLayerVisibility(next);
    updateLayerVisibility.mutate(next);
  };

  const selectedFitting = fittings.find((f) => f.id === selectedFittingId) ?? null;
  const lockedCount = fittings.filter((f) => f.measurement_lock).length;

  const handleUpdateSpecs = (specs: FittingSpecs) => {
    if (!selectedFittingId) return;
    updateFittingSpecs.mutate({ fittingId: selectedFittingId, specs });
  };

  const handleUpdateMeasurementLock = (lock: MeasurementLock) => {
    if (!selectedFittingId) return;
    updateFittingMeasurementLock.mutate({ fittingId: selectedFittingId, measurement_lock: lock });
  };

  const handleAssignCircuit = (circuitId: string | null) => {
    if (!selectedFittingId) return;
    assignFittingCircuit.mutate({ fittingId: selectedFittingId, circuitId });
  };

  const handleRotate = () => {
    if (!selectedFitting) return;
    const current = selectedFitting.specs.rotation ?? 0;
    updateFittingSpecs.mutate({
      fittingId: selectedFitting.id,
      specs: { ...selectedFitting.specs, rotation: (current + 90) % 360, rotationLocked: true },
    });
  };

  const handlePlaceFitting = (point: Point) => {
    if (!selectedType || !plan) return;
    const defaultHeight = defaultHeightForType(selectedType);
    const isWallMounted = isSingleWallFitting(selectedType);
    const specs: FittingSpecs = {};
    if (defaultHeight != null) specs.mountingHeight = defaultHeight;
    if (isWallMounted) specs.rotation = autoRotationForWallMount(point, plan.walls);
    createFitting.mutate({
      type: selectedType,
      position: point,
      measurement_lock: computeMeasurementLock(point, plan.walls, selectedType),
      specs: Object.keys(specs).length > 0 ? specs : undefined,
    });
    // Deliberately kept selected rather than cleared — tradies place several
    // of the same fitting (e.g. a run of downlights) in a row, so forcing a
    // re-tap of the palette after every single placement would be worse UX.
    // Tap the already-selected type again (or select a different one) to
    // switch/deselect.
  };

  const handleFittingDrag = (fittingId: string, position: Point) => {
    if (!plan) return;
    const fitting = fittings.find((f) => f.id === fittingId);
    if (!fitting) return;
    // Re-lock on every manual adjustment — the whole point of the lock is
    // that it always reflects where the fitting actually is right now.
    // Wall-mounted types also re-orient in case the drag moved them to a
    // different wall, unless the tradie has manually overridden the facing
    // (rotationLocked) — see handleRotate.
    const specs =
      isSingleWallFitting(fitting.type) && !fitting.specs.rotationLocked
        ? { ...fitting.specs, rotation: autoRotationForWallMount(position, plan.walls) }
        : undefined;
    updateFittingPosition.mutate({ fittingId, position, measurement_lock: computeMeasurementLock(position, plan.walls, fitting.type), specs });
  };

  const handleDeleteSelected = () => {
    if (!selectedFittingId) return;
    deleteFitting.mutate(selectedFittingId);
    setSelectedFittingId(null);
  };

  const handleUpdateStatus = (status: FittingStatus) => {
    if (!selectedFittingId) return;
    updateFittingStatus.mutate({ fittingId: selectedFittingId, status });
  };

  const handleLinkTargetTap = (targetId: string) => {
    const activeSwitch = fittings.find((f) => f.id === activeSwitchId);
    if (!activeSwitch) return;
    toggleGangLink.mutate({ switchFitting: activeSwitch, gangIndex: activeGangIndex, targetId });
  };

  const handleSelectSwitch = (switchId: string | null) => {
    setActiveSwitchId(switchId);
    setActiveGangIndex(0);
  };

  const handleAddGang = (switchFitting: SetoutFitting) => {
    addSwitchGang.mutate(switchFitting);
  };

  const handleRemoveGang = (switchFitting: SetoutFitting, gangIndex: number) => {
    removeSwitchGang.mutate({ switchFitting, gangIndex });
    if (switchFitting.id === activeSwitchId && gangIndex === activeGangIndex) setActiveGangIndex(0);
  };

  const handleExport = async () => {
    if (!plan || exporting) return;
    setExporting(true);
    try {
      const doc = await generateSetoutReportPdf({ plan, fittings, circuits });
      const filename = `${(plan.name || "setout-plan").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf`;
      doc.save(filename);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not generate the export");
    } finally {
      setExporting(false);
    }
  };

  const handleWorkspaceModeChange = (next: WorkspaceMode) => {
    setWorkspaceMode(next);
    setSelectedFittingId(null);
    setSelectedType(null);
    setActiveSwitchId(null);
    setActiveGangIndex(0);
    setMultiSelectIds(new Set());
  };

  const handleMultiSelectToggle = (fittingId: string) => {
    setMultiSelectIds((prev) => {
      const next = new Set(prev);
      if (next.has(fittingId)) next.delete(fittingId);
      else next.add(fittingId);
      return next;
    });
  };

  const handleBulkAssignCircuit = () => {
    const circuitId = bulkCircuitId === "unassigned" ? null : bulkCircuitId;
    multiSelectIds.forEach((fittingId) => assignFittingCircuit.mutate({ fittingId, circuitId }));
    setMultiSelectIds(new Set());
  };

  const handleBulkDelete = () => {
    multiSelectIds.forEach((fittingId) => deleteFitting.mutate(fittingId));
    setMultiSelectIds(new Set());
  };

  // Rendered in two different spots depending on breakpoint (above the
  // canvas on mobile, in the sidebar on desktop/iPad) — defined once here
  // so the markup isn't duplicated.
  const layerToggleUI = <LayerVisibilityToggle value={layerVisibility} onChange={handleLayerVisibilityChange} />;
  const modeToggleUI = (
    <div className="flex gap-1.5">
      <button
        type="button"
        onClick={() => handleWorkspaceModeChange("place-fittings")}
        className={cn(
          "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
          workspaceMode === "place-fittings" ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground"
        )}
      >
        <MousePointerClick className="h-3.5 w-3.5" /> Place fittings
      </button>
      <button
        type="button"
        onClick={() => handleWorkspaceModeChange("link-switches")}
        className={cn(
          "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
          workspaceMode === "link-switches" ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground"
        )}
      >
        <Cable className="h-3.5 w-3.5" /> Link switches
      </button>
      <button
        type="button"
        onClick={() => handleWorkspaceModeChange("select-multiple")}
        className={cn(
          "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
          workspaceMode === "select-multiple" ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground"
        )}
      >
        <CheckSquare className="h-3.5 w-3.5" /> Select multiple
      </button>
    </div>
  );

  if (planLoading || fittingsLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="h-full overflow-y-auto px-5 py-6 pb-24 md:pb-8">
        <div className="max-w-2xl mx-auto">
          <button
            onClick={() => navigate("/setout")}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <p className="text-sm text-muted-foreground">Plan not found.</p>
        </div>
      </div>
    );
  }

  if (!plan.walls || plan.walls.length === 0) {
    return (
      <div className="h-full overflow-y-auto px-5 py-6 pb-24 md:pb-8">
        <div className="max-w-2xl mx-auto">
          <button
            onClick={() => navigate("/setout")}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <h2 className="font-sans text-lg font-extrabold text-foreground mb-1">{plan.name}</h2>
          <p className="text-xs text-muted-foreground mb-5">
            This plan doesn't have any walls set up yet. Set out the walls first, then come back here to place fittings.
          </p>
          <Button className="w-full h-12 font-bold rounded-xl text-base" onClick={() => navigate("/setout")}>
            Set up walls
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-5 py-6 pb-24 md:pb-8 max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => navigate("/setout")}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={handleExport} disabled={exporting}>
            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Export PDF
          </Button>
        </div>
        <h2 className="font-sans text-lg font-extrabold text-foreground mb-3">{plan.name}</h2>

        {/* Mobile only: layer/mode controls stay in their original compact
            spot above the canvas — there's no sidebar to move them into on
            a phone screen. */}
        <div className="md:hidden mb-3">{layerToggleUI}</div>
        <div className="md:hidden mb-3">{modeToggleUI}</div>

        {/* Canvas dominates the left column on desktop/iPad, with the
            layer/mode controls moved into the sidebar there instead of
            stacked above it — frees up real vertical space for a full
            house plan rather than just one room. */}
        <div className="md:flex md:gap-4 md:items-start">
          <div className="md:flex-1 md:min-w-0">
            <div className="h-[65vh] md:h-[85vh] mb-4 md:mb-0">
              <SetoutCanvas
                walls={plan.walls}
                fittings={fittings}
                mode={workspaceMode}
                selectedFittingType={selectedType}
                onPlaceFitting={handlePlaceFitting}
                onFittingDrag={handleFittingDrag}
                selectedFittingId={selectedFittingId}
                onFittingSelect={setSelectedFittingId}
                layerVisibility={layerVisibility}
                linkActiveSwitchId={activeSwitchId}
                linkActiveGangIndex={activeGangIndex}
                onSwitchTap={handleSelectSwitch}
                onLinkTargetTap={handleLinkTargetTap}
                multiSelectIds={multiSelectIds}
                onMultiSelectToggle={handleMultiSelectToggle}
                className="h-full"
              />
            </div>
          </div>

          <div className="md:w-80 md:flex-shrink-0 space-y-4">
            <div className="hidden md:block space-y-3">
              {layerToggleUI}
              {modeToggleUI}
            </div>

            {workspaceMode === "place-fittings" ? (
              <FittingPalette
                selectedType={selectedType}
                onSelectType={setSelectedType}
                selectedFittingId={selectedFittingId}
                onDeleteSelected={handleDeleteSelected}
                selectedFitting={selectedFitting}
                onUpdateSpecs={handleUpdateSpecs}
                onUpdateStatus={handleUpdateStatus}
                onRotate={handleRotate}
                walls={plan.walls}
                onUpdateMeasurementLock={handleUpdateMeasurementLock}
                circuits={circuits}
                onAssignCircuit={handleAssignCircuit}
              />
            ) : workspaceMode === "link-switches" ? (
              <SwitchLinksPanel
                fittings={fittings}
                activeSwitchId={activeSwitchId}
                activeGangIndex={activeGangIndex}
                onSelectSwitch={handleSelectSwitch}
                onSelectGang={setActiveGangIndex}
                onAddGang={handleAddGang}
                onRemoveGang={handleRemoveGang}
              />
            ) : (
              <div className="rounded-xl border border-border p-3 space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Tap fittings on the canvas to select them, then assign them all to one circuit at once.
                  {multiSelectIds.size > 0 && ` ${multiSelectIds.size} selected.`}
                </p>
                {multiSelectIds.size > 0 && (
                  <>
                    <Select value={bulkCircuitId} onValueChange={setBulkCircuitId}>
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Assign to circuit" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unassigned">Unassigned</SelectItem>
                        {circuits.map((circuit) => (
                          <SelectItem key={circuit.id} value={circuit.id}>
                            {circuit.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex gap-2">
                      <Button size="sm" className="flex-1" onClick={handleBulkAssignCircuit}>
                        Assign {multiSelectIds.size} fitting{multiSelectIds.size === 1 ? "" : "s"}
                      </Button>
                      <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={handleBulkDelete}>
                        Delete
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="pt-4 border-t border-border">
              <Accordion type="single" collapsible>
                <AccordionItem value="measurements" className="border-b-0">
                  <AccordionTrigger className="py-0 font-sans text-base font-extrabold text-foreground hover:no-underline">
                    Measurement list
                    {lockedCount > 0 && <span className="ml-1.5 text-xs font-medium text-muted-foreground">({lockedCount})</span>}
                  </AccordionTrigger>
                  <AccordionContent className="pt-3">
                    <MeasurementListPanel fittings={fittings} walls={plan.walls} />
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>

            <div className="pt-4 border-t border-border">
              <h3 className="font-sans text-base font-extrabold text-foreground mb-3">Circuits &amp; switchboard legend</h3>
              {planId && <CircuitsPanel planId={planId} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SetoutPlan;
