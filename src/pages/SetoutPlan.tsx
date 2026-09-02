import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, MousePointerClick, Cable, CheckSquare, Download, Undo2, PencilRuler, Ruler, Image as ImageIcon, EyeOff, Camera, Plus, Minus, Trash2, Network } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { compressImageToBlob } from "@/lib/image";
import SetoutCanvas, { type SetoutCanvasMode } from "@/components/setout/SetoutCanvas";
import FittingPalette from "@/components/setout/FittingPalette";
import LayerVisibilityToggle from "@/components/setout/LayerVisibilityToggle";
import SwitchLinksPanel from "@/components/setout/SwitchLinksPanel";
import DataCabinetLinksPanel from "@/components/setout/DataCabinetLinksPanel";
import PhotoPointDialog from "@/components/setout/PhotoPointDialog";
import type { FittingType } from "@/components/setout/symbols";
import { DEFAULT_LAYER_VISIBILITY, distance, gangsFor, isSingleWallFitting, type FittingSpecs, type FittingStatus, type LayerVisibility, type MeasurementLock, type MeasurementRef, type Point, type SetoutFitting } from "@/lib/setoutTypes";
import { autoRotationForWallMount, computeMeasurementLock, defaultHeightForType } from "@/lib/setoutGeometry";
import { generateSetoutReportPdf } from "@/lib/setoutReport";
import CircuitsPanel from "@/components/setout/CircuitsPanel";
import EditWallsFlow from "@/components/setout/EditWallsFlow";
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
  useUpdateSetoutPlanWallThickness,
  useToggleGangLink,
  useAddSwitchGang,
  useRemoveSwitchGang,
  useDeleteSetoutFitting,
  useRestoreSetoutFitting,
  useSetoutPhotoPoints,
  useCreateSetoutPhotoPoint,
  useUpdateSetoutPhotoPointDirection,
  useDeleteSetoutPhotoPoint,
} from "@/hooks/useSetoutPlans";
import { useSetoutCircuits, useAssignFittingCircuit } from "@/hooks/useSetoutCircuits";

type WorkspaceMode = Extract<
  SetoutCanvasMode,
  "place-fittings" | "link-switches" | "select-multiple" | "place-photo-points" | "link-data-cabinet"
>;

// A small in-memory undo history for the most common accidental actions —
// placing, deleting, or dragging a fitting. Not persisted across reload,
// and doesn't cover circuit/gang edits or wall changes; scoped to what a
// tradie is most likely to want to walk back mid-session.
type UndoEntry =
  | { type: "create"; fittingId: string }
  | { type: "delete"; fitting: SetoutFitting }
  | { type: "bulk-delete"; fittings: SetoutFitting[] }
  | { type: "move"; fittingId: string; prevPosition: Point; prevMeasurementLock: MeasurementLock | null; prevSpecs: FittingSpecs };

const SetoutPlan = () => {
  const { planId } = useParams();
  const navigate = useNavigate();

  const { user } = useAuth();
  const { data: plan, isLoading: planLoading } = useSetoutPlan(planId);
  const { data: fittings = [], isLoading: fittingsLoading } = useSetoutFittings(planId);
  const { data: circuits = [] } = useSetoutCircuits(planId);
  const { data: photoPoints = [] } = useSetoutPhotoPoints(planId);
  const [exporting, setExporting] = useState(false);

  const createFitting = useCreateSetoutFitting(planId || "");
  const updateFittingPosition = useUpdateSetoutFittingPosition(planId || "");
  const updateFittingSpecs = useUpdateSetoutFittingSpecs(planId || "");
  const updateFittingMeasurementLock = useUpdateSetoutFittingMeasurementLock(planId || "");
  const updateLayerVisibility = useUpdateSetoutPlanLayerVisibility(planId || "");
  const updateWallThickness = useUpdateSetoutPlanWallThickness(planId || "");
  const toggleGangLink = useToggleGangLink(planId || "");
  const addSwitchGang = useAddSwitchGang(planId || "");
  const removeSwitchGang = useRemoveSwitchGang(planId || "");
  const updateFittingStatus = useUpdateSetoutFittingStatus(planId || "");
  const deleteFitting = useDeleteSetoutFitting(planId || "");
  const restoreFitting = useRestoreSetoutFitting(planId || "");
  const assignFittingCircuit = useAssignFittingCircuit(planId || "");
  const createPhotoPoint = useCreateSetoutPhotoPoint(planId || "");
  const updatePhotoPointDirection = useUpdateSetoutPhotoPointDirection(planId || "");
  const deletePhotoPoint = useDeleteSetoutPhotoPoint(planId || "");

  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("place-fittings");
  const [selectedType, setSelectedType] = useState<FittingType | null>(null);
  const [selectedFittingId, setSelectedFittingId] = useState<string | null>(null);
  const [activeSwitchId, setActiveSwitchId] = useState<string | null>(null);
  const [activeGangIndex, setActiveGangIndex] = useState(0);
  const [activeCabinetId, setActiveCabinetId] = useState<string | null>(null);
  const [multiSelectIds, setMultiSelectIds] = useState<Set<string>>(new Set());
  const [bulkCircuitId, setBulkCircuitId] = useState<string>("unassigned");
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const pushUndo = (entry: UndoEntry) => setUndoStack((prev) => [...prev.slice(-19), entry]);
  const [editingWalls, setEditingWalls] = useState(false);
  const [pickingMeasurementSlot, setPickingMeasurementSlot] = useState<"refA" | "refB" | null>(null);
  const [layerVisibility, setLayerVisibility] = useState<LayerVisibility>(DEFAULT_LAYER_VISIBILITY);
  const layerSyncedRef = useRef(false);

  useEffect(() => {
    if (plan && !layerSyncedRef.current) {
      // Merge over the defaults rather than using the saved value outright —
      // a plan saved before a new layer (e.g. photoPoints) existed won't
      // have that key yet, and a missing key should mean "default", not
      // "hidden".
      setLayerVisibility({ ...DEFAULT_LAYER_VISIBILITY, ...plan.layer_visibility });
      layerSyncedRef.current = true;
    }
  }, [plan]);

  // Kept in millimetres locally (the unit a tradie actually thinks in) and
  // converted to/from the plan's metre-based wall_thickness only at the
  // edges — synced once on load same as layerVisibility above, so it
  // doesn't get clobbered by a refetch while mid-edit.
  const [wallThicknessMm, setWallThicknessMm] = useState({ exterior: 230, interior: 110 });
  const wallThicknessSyncedRef = useRef(false);

  useEffect(() => {
    if (plan && !wallThicknessSyncedRef.current) {
      setWallThicknessMm({
        exterior: Math.round(plan.wall_thickness.exterior * 1000),
        interior: Math.round(plan.wall_thickness.interior * 1000),
      });
      wallThicknessSyncedRef.current = true;
    }
  }, [plan]);

  const commitWallThickness = (next: { exterior: number; interior: number }) => {
    updateWallThickness.mutate({ exterior: next.exterior / 1000, interior: next.interior / 1000 });
  };

  // Reference image behind the traced walls/fittings — the original
  // uploaded plan, kept around in storage since import (CalibrationImportFlow.tsx)
  // specifically so the tradie can always cross-check against the real
  // drawing even where the AI's own tracing is imperfect. Signed URL +
  // natural pixel dimensions are both fetched client-side rather than
  // stored, re-deriving pixelsPerMetre from the already-stored
  // scale_calibration — same formula used when this image was first traced.
  const [backgroundImage, setBackgroundImage] = useState<{ href: string; width: number; height: number } | null>(null);
  const [showBackgroundReference, setShowBackgroundReference] = useState(true);

  useEffect(() => {
    if (!plan?.background_image_path || !plan.scale_calibration) {
      setBackgroundImage(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data: signed } = await supabase.storage.from("setout-plan-uploads").createSignedUrl(plan.background_image_path!, 3600);
      if (!signed?.signedUrl || cancelled) return;
      const img = new Image();
      img.onload = () => {
        if (cancelled) return;
        const { pointA, pointB, realDistanceMetres } = plan.scale_calibration!;
        const pixelsPerMetre = distance(pointA, pointB) / realDistanceMetres;
        setBackgroundImage({ href: signed.signedUrl, width: img.naturalWidth / pixelsPerMetre, height: img.naturalHeight / pixelsPerMetre });
      };
      img.src = signed.signedUrl;
    })();
    return () => {
      cancelled = true;
    };
  }, [plan?.background_image_path, plan?.scale_calibration]);

  // Photo points: tap a spot in "place-photo-points" mode → stash that
  // position here → immediately click the hidden camera input. The row
  // only gets created once a photo actually comes back (onPhotoFilePicked),
  // so cancelling the camera just discards the pending position — nothing
  // to clean up.
  const photoInputRef = useRef<HTMLInputElement>(null);
  const pendingPhotoPointPosition = useRef<Point | null>(null);
  const [uploadingPhotoPoint, setUploadingPhotoPoint] = useState(false);
  const [activePhotoPointId, setActivePhotoPointId] = useState<string | null>(null);
  const [activePhotoUrl, setActivePhotoUrl] = useState<string | null>(null);
  const [loadingActivePhoto, setLoadingActivePhoto] = useState(false);

  const activePhotoPoint = photoPoints.find((p) => p.id === activePhotoPointId) ?? null;

  const handlePhotoPointPlace = (point: Point) => {
    pendingPhotoPointPosition.current = point;
    photoInputRef.current?.click();
  };

  const loadPhotoPointUrl = async (storagePath: string) => {
    setLoadingActivePhoto(true);
    const { data: signed } = await supabase.storage.from("setout-photo-points").createSignedUrl(storagePath, 3600);
    setActivePhotoUrl(signed?.signedUrl ?? null);
    setLoadingActivePhoto(false);
  };

  const handlePhotoPointTap = (photoPointId: string) => {
    const point = photoPoints.find((p) => p.id === photoPointId);
    if (!point) return;
    setActivePhotoPointId(photoPointId);
    setActivePhotoUrl(null);
    loadPhotoPointUrl(point.storage_path);
  };

  const handlePhotoFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    const position = pendingPhotoPointPosition.current;
    pendingPhotoPointPosition.current = null;
    if (!file || !user || !planId || !position) return;
    setUploadingPhotoPoint(true);
    try {
      const blob = await compressImageToBlob(file);
      const path = `${user.id}/${planId}/${crypto.randomUUID()}.jpg`;
      const { error: upErr } = await supabase.storage.from("setout-photo-points").upload(path, blob, { contentType: "image/jpeg" });
      if (upErr) throw upErr;
      const created = await createPhotoPoint.mutateAsync({ position, storage_path: path });
      setActivePhotoPointId(created.id);
      loadPhotoPointUrl(path);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save that photo.");
    } finally {
      setUploadingPhotoPoint(false);
    }
  };

  const handlePhotoPointDirectionChange = (degrees: number) => {
    if (!activePhotoPointId) return;
    updatePhotoPointDirection.mutate({ photoPointId: activePhotoPointId, direction_degrees: degrees });
  };

  const handleDeletePhotoPoint = () => {
    if (!activePhotoPoint) return;
    deletePhotoPoint.mutate(activePhotoPoint);
    setActivePhotoPointId(null);
  };

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

  const handlePickMeasurementRef = (slot: "refA" | "refB") => {
    setPickingMeasurementSlot((prev) => (prev === slot ? null : slot));
  };

  const handleMeasurementRefPick = (ref: MeasurementRef) => {
    if (!selectedFittingId || !selectedFitting?.measurement_lock || !pickingMeasurementSlot) return;
    updateFittingMeasurementLock.mutate({
      fittingId: selectedFittingId,
      measurement_lock: { ...selectedFitting.measurement_lock, [pickingMeasurementSlot]: ref },
    });
    setPickingMeasurementSlot(null);
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
    createFitting.mutate(
      {
        type: selectedType,
        position: point,
        measurement_lock: computeMeasurementLock(point, plan.walls, selectedType),
        specs: Object.keys(specs).length > 0 ? specs : undefined,
      },
      { onSuccess: (created) => pushUndo({ type: "create", fittingId: created.id }) }
    );
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
    pushUndo({ type: "move", fittingId, prevPosition: fitting.position, prevMeasurementLock: fitting.measurement_lock, prevSpecs: fitting.specs });
    updateFittingPosition.mutate({ fittingId, position, measurement_lock: computeMeasurementLock(position, plan.walls, fitting.type), specs });
  };

  const handleDeleteSelected = () => {
    if (!selectedFittingId || !selectedFitting) return;
    pushUndo({ type: "delete", fitting: selectedFitting });
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

  // Data cabling is always a home run (see FittingSpecs.dataCabinetId) — no
  // gangs, so this is a plain toggle on the data point's own specs rather
  // than a mutation on the cabinet like toggleGangLink above.
  const handleDataLinkTargetTap = (targetId: string) => {
    const target = fittings.find((f) => f.id === targetId);
    if (!target || !activeCabinetId) return;
    const nextCabinetId = target.specs.dataCabinetId === activeCabinetId ? null : activeCabinetId;
    updateFittingSpecs.mutate({ fittingId: targetId, specs: { ...target.specs, dataCabinetId: nextCabinetId } });
  };

  const handleSelectCabinet = (cabinetId: string | null) => {
    setActiveCabinetId(cabinetId);
  };

  const handleSelectSwitch = (switchId: string | null) => {
    setActiveSwitchId(switchId);
    setActiveGangIndex(0);
  };

  const handleAddGang = (switchFitting: SetoutFitting) => {
    addSwitchGang.mutate(switchFitting);
  };

  // Double-tapping a switch on the canvas (see SetoutCanvas's
  // onSwitchDoubleTap) opens a small menu right where it was tapped, rather
  // than making the tradie scroll to that switch's card in the side panel
  // just to add a gang.
  const [switchMenu, setSwitchMenu] = useState<{ switchId: string; x: number; y: number } | null>(null);
  const switchMenuFitting = fittings.find((f) => f.id === switchMenu?.switchId) ?? null;

  const handleSwitchDoubleTap = (switchFitting: SetoutFitting, clientPos: { x: number; y: number }) => {
    setSwitchMenu({ switchId: switchFitting.id, x: clientPos.x, y: clientPos.y });
  };

  const handleRemoveLastGangFromMenu = () => {
    if (!switchMenuFitting) return;
    const gangs = gangsFor(switchMenuFitting);
    handleRemoveGang(switchMenuFitting, gangs.length - 1);
    setSwitchMenu(null);
  };

  const handleDeleteSwitchFromMenu = () => {
    if (!switchMenuFitting) return;
    pushUndo({ type: "delete", fitting: switchMenuFitting });
    deleteFitting.mutate(switchMenuFitting.id);
    if (selectedFittingId === switchMenuFitting.id) setSelectedFittingId(null);
    if (activeSwitchId === switchMenuFitting.id) setActiveSwitchId(null);
    setSwitchMenu(null);
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
    setActiveCabinetId(null);
    setMultiSelectIds(new Set());
    setPickingMeasurementSlot(null);
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
    const toDelete = fittings.filter((f) => multiSelectIds.has(f.id));
    if (toDelete.length > 0) pushUndo({ type: "bulk-delete", fittings: toDelete });
    multiSelectIds.forEach((fittingId) => deleteFitting.mutate(fittingId));
    setMultiSelectIds(new Set());
  };

  const handleUndo = () => {
    const entry = undoStack[undoStack.length - 1];
    if (!entry) return;
    setUndoStack((prev) => prev.slice(0, -1));
    if (entry.type === "create") {
      deleteFitting.mutate(entry.fittingId);
    } else if (entry.type === "delete") {
      restoreFitting.mutate(entry.fitting);
    } else if (entry.type === "bulk-delete") {
      entry.fittings.forEach((f) => restoreFitting.mutate(f));
    } else if (entry.type === "move") {
      updateFittingPosition.mutate({
        fittingId: entry.fittingId,
        position: entry.prevPosition,
        measurement_lock: entry.prevMeasurementLock,
        specs: entry.prevSpecs,
      });
    }
  };

  // Rendered in two different spots depending on breakpoint (above the
  // canvas on mobile, in the sidebar on desktop/iPad) — defined once here
  // so the markup isn't duplicated.
  const layerToggleUI = <LayerVisibilityToggle value={layerVisibility} onChange={handleLayerVisibilityChange} />;
  const modeToggleUI = (
    <div className="flex flex-wrap gap-1.5">
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
        onClick={() => handleWorkspaceModeChange("link-data-cabinet")}
        className={cn(
          "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
          workspaceMode === "link-data-cabinet" ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground"
        )}
      >
        <Network className="h-3.5 w-3.5" /> Link data cabinet
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
      <button
        type="button"
        onClick={() => handleWorkspaceModeChange("place-photo-points")}
        className={cn(
          "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
          workspaceMode === "place-photo-points" ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground"
        )}
      >
        <Camera className="h-3.5 w-3.5" /> Photo points
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

  if (editingWalls) {
    return <EditWallsFlow plan={plan} onClose={() => setEditingWalls(false)} />;
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
          <div className="flex items-center gap-1.5">
            {plan.background_image_path && (
              <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setShowBackgroundReference((v) => !v)}>
                {showBackgroundReference ? <EyeOff className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}
                {showBackgroundReference ? "Hide plan" : "Show plan"}
              </Button>
            )}
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setEditingWalls(true)}>
              <PencilRuler className="h-3.5 w-3.5" />
              Edit walls
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1.5">
                  <Ruler className="h-3.5 w-3.5" />
                  Wall thickness
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64" align="end">
                <p className="text-xs font-semibold text-foreground mb-1">Wall line thickness</p>
                <p className="text-[11px] text-muted-foreground mb-3">
                  How thick each wall draws on the plan and PDF export — set it to match the real construction.
                </p>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="ext-wall-thickness" className="text-xs">Exterior walls (mm)</Label>
                    <Input
                      id="ext-wall-thickness"
                      type="number"
                      inputMode="numeric"
                      min="10"
                      step="5"
                      value={wallThicknessMm.exterior}
                      onChange={(e) => setWallThicknessMm((prev) => ({ ...prev, exterior: Number(e.target.value) || prev.exterior }))}
                      onBlur={() => commitWallThickness(wallThicknessMm)}
                      className="h-9"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="int-wall-thickness" className="text-xs">Interior walls (mm)</Label>
                    <Input
                      id="int-wall-thickness"
                      type="number"
                      inputMode="numeric"
                      min="10"
                      step="5"
                      value={wallThicknessMm.interior}
                      onChange={(e) => setWallThicknessMm((prev) => ({ ...prev, interior: Number(e.target.value) || prev.interior }))}
                      onBlur={() => commitWallThickness(wallThicknessMm)}
                      className="h-9"
                    />
                  </div>
                </div>
              </PopoverContent>
            </Popover>
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={handleUndo} disabled={undoStack.length === 0}>
              <Undo2 className="h-3.5 w-3.5" />
              Undo
            </Button>
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={handleExport} disabled={exporting}>
              {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Export PDF
            </Button>
          </div>
        </div>
        <h2 className="font-sans text-lg font-extrabold text-foreground mb-3">{plan.name}</h2>

        {/* Layer toggle sits above the canvas on every breakpoint — on
            desktop/iPad it stays above the grid plan rather than the
            sidebar so it's visible without scrolling. Mode toggle stays
            mobile-only here; desktop keeps it in the sidebar instead. */}
        <div className="mb-3">{layerToggleUI}</div>
        <div className="md:hidden mb-3">{modeToggleUI}</div>

        {/* Canvas dominates the left column on desktop/iPad, with the
            mode toggle moved into the sidebar there instead of stacked
            above it — frees up real vertical space for a full house plan
            rather than just one room. */}
        <div className="md:flex md:gap-4 md:items-start">
          <div className="md:flex-1 md:min-w-0">
            <div className="h-[65vh] md:h-[85vh] mb-4 md:mb-0">
              <SetoutCanvas
                backgroundImage={showBackgroundReference ? (backgroundImage ?? undefined) : undefined}
                walls={plan.walls}
                wallThickness={{ exterior: wallThicknessMm.exterior / 1000, interior: wallThicknessMm.interior / 1000 }}
                openings={plan.openings}
                fittings={fittings}
                mode={pickingMeasurementSlot ? "pick-measurement-ref" : workspaceMode}
                onMeasurementRefPick={handleMeasurementRefPick}
                selectedFittingType={selectedType}
                onPlaceFitting={handlePlaceFitting}
                onFittingDrag={handleFittingDrag}
                selectedFittingId={selectedFittingId}
                onFittingSelect={setSelectedFittingId}
                onFittingRotate={handleRotate}
                layerVisibility={layerVisibility}
                linkActiveSwitchId={activeSwitchId}
                linkActiveGangIndex={activeGangIndex}
                onSwitchTap={handleSelectSwitch}
                onLinkTargetTap={handleLinkTargetTap}
                onSwitchDoubleTap={handleSwitchDoubleTap}
                linkActiveCabinetId={activeCabinetId}
                onCabinetTap={handleSelectCabinet}
                onDataLinkTargetTap={handleDataLinkTargetTap}
                multiSelectIds={multiSelectIds}
                onMultiSelectToggle={handleMultiSelectToggle}
                circuits={circuits}
                photoPoints={photoPoints}
                onPhotoPointPlace={handlePhotoPointPlace}
                onPhotoPointTap={handlePhotoPointTap}
                className="h-full"
              />
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handlePhotoFilePicked}
              />
            </div>
          </div>

          <div className="md:w-80 md:flex-shrink-0 space-y-4">
            <div className="hidden md:block space-y-3">{modeToggleUI}</div>

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
                onUpdateMeasurementLock={handleUpdateMeasurementLock}
                onPickMeasurementRef={handlePickMeasurementRef}
                pickingMeasurementSlot={pickingMeasurementSlot}
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
            ) : workspaceMode === "link-data-cabinet" ? (
              <DataCabinetLinksPanel fittings={fittings} activeCabinetId={activeCabinetId} onSelectCabinet={handleSelectCabinet} />
            ) : workspaceMode === "place-photo-points" ? (
              <div className="rounded-xl border border-border p-3 space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  Tap anywhere on the plan to drop a pin and take a photo from there — the camera opens straight away.
                </p>
                <p className="text-xs font-medium text-muted-foreground">
                  Tap an existing camera pin to view its photo or set which way it was facing.
                </p>
                {uploadingPhotoPoint && (
                  <p className="text-xs font-medium text-primary flex items-center gap-1.5 pt-1">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving photo…
                  </p>
                )}
              </div>
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

      <PhotoPointDialog
        open={!!activePhotoPointId}
        onOpenChange={(open) => { if (!open) setActivePhotoPointId(null); }}
        photoUrl={activePhotoUrl}
        loadingPhoto={loadingActivePhoto}
        directionDegrees={activePhotoPoint?.direction_degrees ?? null}
        onDirectionChange={handlePhotoPointDirectionChange}
        onDelete={handleDeletePhotoPoint}
        deleting={deletePhotoPoint.isPending}
      />

      <DropdownMenu open={!!switchMenu} onOpenChange={(open) => { if (!open) setSwitchMenu(null); }}>
        <DropdownMenuTrigger asChild>
          {/* Invisible 0x0 trigger positioned at the exact double-tap point
              — Radix anchors the menu to this element and keeps it clear of
              the screen edge on its own, same as every other menu in the
              app, just anchored by coordinates instead of a visible button. */}
          <div style={{ position: "fixed", left: switchMenu?.x ?? 0, top: switchMenu?.y ?? 0, width: 1, height: 1 }} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            onClick={() => {
              if (switchMenuFitting) handleAddGang(switchMenuFitting);
              setSwitchMenu(null);
            }}
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add gang
          </DropdownMenuItem>
          {switchMenuFitting && gangsFor(switchMenuFitting).length > 1 && (
            <DropdownMenuItem onClick={handleRemoveLastGangFromMenu}>
              <Minus className="h-3.5 w-3.5 mr-1.5" />
              Remove last gang
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={handleDeleteSwitchFromMenu}>
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Delete switch
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

export default SetoutPlan;
