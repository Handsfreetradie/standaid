import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, MousePointerClick, Cable, Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { cn } from "@/lib/utils";
import SetoutCanvas, { type SetoutCanvasMode } from "@/components/setout/SetoutCanvas";
import FittingPalette from "@/components/setout/FittingPalette";
import LayerVisibilityToggle from "@/components/setout/LayerVisibilityToggle";
import SwitchLinksPanel from "@/components/setout/SwitchLinksPanel";
import type { FittingType } from "@/components/setout/symbols";
import { DEFAULT_LAYER_VISIBILITY, isSingleWallFitting, type FittingSpecs, type FittingStatus, type LayerVisibility, type MeasurementLock, type Point } from "@/lib/setoutTypes";
import { computeMeasurementLock, defaultHeightForType } from "@/lib/setoutGeometry";
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
  useToggleSwitchLink,
  useDeleteSetoutFitting,
} from "@/hooks/useSetoutPlans";
import { useSetoutCircuits, useAssignFittingCircuit } from "@/hooks/useSetoutCircuits";

type WorkspaceMode = Extract<SetoutCanvasMode, "place-fittings" | "link-switches">;

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
  const toggleSwitchLink = useToggleSwitchLink(planId || "");
  const updateFittingStatus = useUpdateSetoutFittingStatus(planId || "");
  const deleteFitting = useDeleteSetoutFitting(planId || "");
  const assignFittingCircuit = useAssignFittingCircuit(planId || "");

  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("place-fittings");
  const [selectedType, setSelectedType] = useState<FittingType | null>(null);
  const [selectedFittingId, setSelectedFittingId] = useState<string | null>(null);
  const [activeSwitchId, setActiveSwitchId] = useState<string | null>(null);
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

  const handlePlaceFitting = (point: Point) => {
    if (!selectedType || !plan) return;
    const defaultHeight = defaultHeightForType(selectedType);
    createFitting.mutate({
      type: selectedType,
      position: point,
      measurement_lock: computeMeasurementLock(point, plan.walls, selectedType),
      specs: defaultHeight != null ? { mountingHeight: defaultHeight } : undefined,
    });
    // Deliberately kept selected rather than cleared — tradies place several
    // of the same fitting (e.g. a run of downlights) in a row, so forcing a
    // re-tap of the palette after every single placement would be worse UX.
    // Tap the already-selected type again (or select a different one) to
    // switch/deselect.
  };

  const handleFittingDrag = (fittingId: string, position: Point) => {
    if (!plan) return;
    const fittingType = fittings.find((f) => f.id === fittingId)?.type;
    // Re-lock on every manual adjustment — the whole point of the lock is
    // that it always reflects where the fitting actually is right now.
    updateFittingPosition.mutate({ fittingId, position, measurement_lock: computeMeasurementLock(position, plan.walls, fittingType) });
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
    toggleSwitchLink.mutate({ switchFitting: activeSwitch, targetId });
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
  };

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
      <div className="px-5 py-6 pb-24 md:pb-8 max-w-2xl mx-auto flex flex-col h-full">
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

        <div className="mb-3">
          <LayerVisibilityToggle value={layerVisibility} onChange={handleLayerVisibilityChange} />
        </div>

        <div className="mb-3 flex gap-1.5">
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
        </div>

        <div className="flex-1 min-h-[420px] mb-4">
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
            onSwitchTap={setActiveSwitchId}
            onLinkTargetTap={handleLinkTargetTap}
            className="h-full min-h-[420px]"
          />
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
            walls={plan.walls}
            onUpdateMeasurementLock={handleUpdateMeasurementLock}
            circuits={circuits}
            onAssignCircuit={handleAssignCircuit}
          />
        ) : (
          <SwitchLinksPanel fittings={fittings} activeSwitchId={activeSwitchId} onSelectSwitch={setActiveSwitchId} />
        )}

        <div className="mt-6 pt-6 border-t border-border">
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

        <div className="mt-6 pt-6 border-t border-border">
          <h3 className="font-sans text-base font-extrabold text-foreground mb-3">Circuits &amp; switchboard legend</h3>
          {planId && <CircuitsPanel planId={planId} />}
        </div>
      </div>
    </div>
  );
};

export default SetoutPlan;
