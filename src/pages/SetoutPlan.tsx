import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, MousePointerClick, Cable, CheckSquare, Download, Undo2, PencilRuler, Pencil, Ruler, Image as ImageIcon, EyeOff, Camera, Plus, Minus, Trash2, Network, GripHorizontal, ChevronLeft, ChevronRight, Layers, Columns3, Rows3, Gauge, Zap, Sun, Mic } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useData";
import { compressImageToBlob } from "@/lib/image";
import { formatMm } from "@/lib/units";
import SetoutCanvas, { type SetoutCanvasMode } from "@/components/setout/SetoutCanvas";
import FittingPalette from "@/components/setout/FittingPalette";
import LayerVisibilityToggle from "@/components/setout/LayerVisibilityToggle";
import SwitchLinksPanel from "@/components/setout/SwitchLinksPanel";
import DataCabinetLinksPanel from "@/components/setout/DataCabinetLinksPanel";
import PhotoPointDialog from "@/components/setout/PhotoPointDialog";
import CameraCapture from "@/components/setout/CameraCapture";
import type { FittingType } from "@/components/setout/symbols";
import { pathLength } from "@/lib/setoutPathGeometry";
import {
  DEFAULT_EXTRUSION_STOCK_LENGTH_M,
  DEFAULT_LED_WATTS_PER_METRE,
  DEFAULT_DRIVER_HEADROOM_PCT,
  DEFAULT_DRIVER_SIZES_W,
} from "@/lib/setoutMaterials";
import { DEFAULT_LAYER_VISIBILITY, DEFAULT_TWIN_SPACING_MM, distance, gangsFor, isSingleWallFitting, type FittingSpecs, type FittingStatus, type LayerVisibility, type MeasurementLock, type MeasurementRef, type PathPoint, type Point, type SetoutFitting, type SetoutCanvas as SetoutCanvasRow } from "@/lib/setoutTypes";
import { autoRotationForWallMount, computeMeasurementLock, defaultHeightForType, remeasureLock, DEFAULT_MOUNTING_HEIGHT } from "@/lib/setoutGeometry";
import { generateSetoutReportPdf, type PlanImage } from "@/lib/setoutReport";
import { urlToBase64 } from "@/lib/auditReport";
import { BASE_PDF_SCALE, renderPdfTile, type PdfPage } from "@/lib/planRender";
import { extractPlanLines, measureToFaces, PlanVectorIndex } from "@/lib/planVector";
import type { BackgroundTile } from "@/components/setout/SetoutCanvas";
import CircuitsPanel from "@/components/setout/CircuitsPanel";
import MaximumDemandPanel from "@/components/setout/MaximumDemandPanel";
import VoiceNotesPanel from "@/components/setout/VoiceNotesPanel";
import SwitchboardLegendPreview from "@/components/setout/SwitchboardLegendPreview";
import { calculateMaximumDemand } from "@/lib/setoutMaximumDemand";
import EditWallsFlow from "@/components/setout/EditWallsFlow";
import DrawWallsFlow from "@/components/setout/DrawWallsFlow";
import CalibrationImportFlow from "@/components/setout/CalibrationImportFlow";
import MeasurementListPanel from "@/components/setout/MeasurementListPanel";
import { groupPhotosByPosition } from "@/lib/setoutGeometry";
import {
  useSetoutPlan,
  useSetoutFittings,
  useCreateSetoutFitting,
  useUpdateSetoutFittingPosition,
  useUpdateSetoutFittingSpecs,
  useUpdateSetoutFittingStatus,
  useUpdateSetoutFittingMeasurementLock,
  useUpdateSetoutPlanDefaults,
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
import {
  useSetoutCanvases,
  useCreateSetoutCanvas,
  useRenameSetoutCanvas,
  useDeleteSetoutCanvas,
  useUpdateSetoutCanvasLayerVisibility,
  useUpdateSetoutCanvasWallThickness,
} from "@/hooks/useSetoutCanvases";
import { useSetoutCircuits, useAssignFittingCircuit } from "@/hooks/useSetoutCircuits";
import { useSetoutLoadItems } from "@/hooks/useSetoutLoadItems";

type WorkspaceMode = Extract<
  SetoutCanvasMode,
  "place-fittings" | "link-switches" | "select-multiple" | "place-photo-points" | "link-data-cabinet" | "draw-led-strip" | "measure"
>;

const SIDEBAR_WIDTH_DEFAULT = 320; // 20rem, matches the old fixed w-80
const SIDEBAR_WIDTH_MIN = 260;
const SIDEBAR_WIDTH_MAX = 480;

// A small in-memory undo history for the most common accidental actions —
// placing, deleting, or dragging a fitting. Not persisted across reload,
// and doesn't cover circuit/gang edits or wall changes; scoped to what a
// tradie is most likely to want to walk back mid-session.
type UndoEntry =
  | { type: "create"; fittingId: string }
  | { type: "delete"; fitting: SetoutFitting }
  | { type: "bulk-delete"; fittings: SetoutFitting[] }
  | { type: "move"; fittingId: string; prevPosition: Point; prevMeasurementLock: MeasurementLock | null; prevSpecs: FittingSpecs };

// Fetches one canvas's own background image for the PDF export, mirroring
// the on-screen background-image effect (signed URL -> natural pixel size ->
// scene units via that canvas's own scale) but as an on-demand call so every
// canvas's image can be embedded, not just whichever tab happens to be
// active while exporting.
async function loadPlanImageForCanvas(canvas: SetoutCanvasRow): Promise<PlanImage | undefined> {
  if (!canvas.background_image_path) return undefined;
  try {
    const { data: signed } = await supabase.storage.from("setout-plan-uploads").createSignedUrl(canvas.background_image_path, 3600);
    if (!signed?.signedUrl) return undefined;
    const blob = await (await fetch(signed.signedUrl)).blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    const naturalSize = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error("Could not read the plan image's dimensions"));
      img.src = dataUrl;
    });
    const cal = canvas.scale_calibration;
    const pixelsPerMetre = cal ? distance(cal.pointA, cal.pointB) / cal.realDistanceMetres : 1;
    return { dataUrl, width: naturalSize.width / pixelsPerMetre, height: naturalSize.height / pixelsPerMetre };
  } catch (err) {
    console.error(`[SetoutPlan] Could not embed the plan image for canvas ${canvas.id} in the export:`, err);
    return undefined;
  }
}

// "30, 60, 100" -> [30, 60, 100]. Anything that isn't a positive number is
// dropped rather than rejected, so a stray comma or a trailing space doesn't
// stop the tradie saving the rest of the list.
function parseDriverSizes(text: string): number[] {
  const sizes = text
    .split(/[,\s]+/)
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  return Array.from(new Set(sizes)).sort((a, b) => a - b);
}

const SetoutPlan = () => {
  const { planId } = useParams();
  const navigate = useNavigate();

  const { user } = useAuth();
  const { data: profile } = useProfile();
  const { data: plan, isLoading: planLoading } = useSetoutPlan(planId);

  // Feature gate: photo points only for electricians and HVAC
  const allowedTrades = profile?.trade_type ? profile.trade_type.split(",").filter(Boolean) : [];
  const hasPhotoPointsAccess = allowedTrades.includes("electrical") || allowedTrades.includes("hvac");
  const { data: fittings = [], isLoading: fittingsLoading } = useSetoutFittings(planId);
  const { data: circuits = [] } = useSetoutCircuits(planId);
  const { data: loadItems = [] } = useSetoutLoadItems(planId);
  const { data: photoPoints = [] } = useSetoutPhotoPoints(planId);
  const { data: canvases = [], isLoading: canvasesLoading } = useSetoutCanvases(planId);
  const createCanvas = useCreateSetoutCanvas(planId || "");
  const renameCanvas = useRenameSetoutCanvas(planId || "");
  const deleteCanvas = useDeleteSetoutCanvas(planId || "");
  // Which floor/area tab is showing. Set to the first canvas once loaded.
  // Deliberately only fills in a NULL selection — never overrides an
  // already-set id, even one the (possibly stale, not-yet-refetched)
  // `canvases` list doesn't contain yet. A blind "snap back to canvases[0]
  // if the active id isn't in the list" effect would race a freshly-created
  // canvas: creating one sets activeCanvasId to its id immediately, but the
  // query invalidation that adds it to `canvases` lands a render later —
  // in that gap this effect would see "not in the list" and snap straight
  // back to the first tab. Deleting the active canvas is instead handled
  // explicitly at the delete call site, picking the next tab itself.
  const [activeCanvasId, setActiveCanvasId] = useState<string | null>(null);
  useEffect(() => {
    if (!activeCanvasId && canvases.length > 0) setActiveCanvasId(canvases[0].id);
  }, [canvases, activeCanvasId]);
  const activeCanvas: SetoutCanvasRow | null = canvases.find((c) => c.id === activeCanvasId) ?? canvases[0] ?? null;
  const canvasFittings = useMemo(() => fittings.filter((f) => f.canvas_id === activeCanvas?.id), [fittings, activeCanvas?.id]);
  const canvasPhotoPoints = useMemo(() => photoPoints.filter((p) => p.canvas_id === activeCanvas?.id), [photoPoints, activeCanvas?.id]);
  // "add" creates a new floor/area tab; "rename" renames the active one.
  const [canvasNameDialog, setCanvasNameDialog] = useState<{ mode: "add" | "rename"; name: string } | null>(null);
  const handleSaveCanvasName = () => {
    if (!canvasNameDialog) return;
    const name = canvasNameDialog.name.trim();
    if (!name) return;
    if (canvasNameDialog.mode === "add") {
      createCanvas.mutate(
        { name, source_type: "draw", sort_order: canvases.length },
        { onSuccess: (created) => setActiveCanvasId(created.id) }
      );
    } else if (activeCanvas) {
      renameCanvas.mutate({ canvasId: activeCanvas.id, name });
    }
    setCanvasNameDialog(null);
  };
  const [exporting, setExporting] = useState(false);
  // Maximum demand lives behind a dialog rather than taking up permanent
  // sidebar space — it's a "check once you're done" total, not something
  // edited constantly like circuits, so a glanceable total in the toolbar
  // plus click-to-expand suits it better than an always-scrolled-past
  // accordion at the bottom of the sidebar.
  const [showMaxDemandDialog, setShowMaxDemandDialog] = useState(false);
  const maxDemandTotalAmps = calculateMaximumDemand(fittings, loadItems, plan?.plan_defaults?.supplyPhase).totalAmps;
  // Lets the tradie arrange and edit circuits against an on-screen mockup of
  // the printed A4 legend before exporting, rather than only via the plain
  // list in the sidebar.
  const [showLegendPreview, setShowLegendPreview] = useState(false);
  // General narration recorded during a customer walkthrough — not tied to
  // a canvas mode/tap like a photo point, just a dialog reachable from the
  // toolbar the same way Max demand/Switchboard legend are.
  const [showVoiceNotesDialog, setShowVoiceNotesDialog] = useState(false);

  const createFitting = useCreateSetoutFitting(planId || "");
  const updateFittingPosition = useUpdateSetoutFittingPosition(planId || "");
  const updateFittingSpecs = useUpdateSetoutFittingSpecs(planId || "");
  const updateFittingMeasurementLock = useUpdateSetoutFittingMeasurementLock(planId || "");
  const updateLayerVisibility = useUpdateSetoutCanvasLayerVisibility(activeCanvas?.id || "", planId || "");
  const updateWallThickness = useUpdateSetoutCanvasWallThickness(activeCanvas?.id || "", planId || "");
  const updatePlanDefaults = useUpdateSetoutPlanDefaults(planId || "");
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
  // Specs a quick-pick preset (e.g. "GPO — double") set alongside
  // selectedType — applied on top of the placement defaults in
  // handlePlaceFitting. Reset wherever selectedType is cleared, and
  // overwritten (with {}) by a bare pick from FittingPalette's own dropdown.
  const [selectedPresetSpecs, setSelectedPresetSpecs] = useState<FittingSpecs>({});
  const handleSelectPreset = (type: FittingType, specs: FittingSpecs) => {
    setSelectedType(type);
    setSelectedPresetSpecs(specs);
  };
  const [selectedFittingId, setSelectedFittingId] = useState<string | null>(null);
  const [activeSwitchId, setActiveSwitchId] = useState<string | null>(null);
  const [activeGangIndex, setActiveGangIndex] = useState(0);
  const [activeCabinetId, setActiveCabinetId] = useState<string | null>(null);
  const [multiSelectIds, setMultiSelectIds] = useState<Set<string>>(new Set());
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  // Collapsing the desktop sidebar hands its width back to the canvas —
  // useful mid-job when the tradie just wants to see more of the plan.
  // Remembered locally the same way the global app nav's collapse is.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("standaid-setout-sidebar-collapsed") === "true";
    } catch {
      return false;
    }
  });
  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("standaid-setout-sidebar-collapsed", String(next));
      } catch {
        // Private browsing or storage disabled — still works this session.
      }
      return next;
    });
  };

  // Drag-to-resize the sidebar's width, clamped to a sane range and
  // remembered the same way its collapsed state is.
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const stored = Number(localStorage.getItem("standaid-setout-sidebar-width"));
      return stored >= SIDEBAR_WIDTH_MIN && stored <= SIDEBAR_WIDTH_MAX ? stored : SIDEBAR_WIDTH_DEFAULT;
    } catch {
      return SIDEBAR_WIDTH_DEFAULT;
    }
  });
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const sidebarResizeDrag = useRef<{ pointerId: number; startClientX: number; startWidth: number } | null>(null);
  const handleSidebarResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    sidebarResizeDrag.current = { pointerId: e.pointerId, startClientX: e.clientX, startWidth: sidebarWidth };
    setIsResizingSidebar(true);
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const handleSidebarResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = sidebarResizeDrag.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    // The sidebar sits on the right, so dragging left (negative delta)
    // widens it — the opposite sign from the left nav's own resize handle.
    const next = Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, drag.startWidth - (e.clientX - drag.startClientX)));
    setSidebarWidth(next);
  };
  const handleSidebarResizeEnd = () => {
    if (!sidebarResizeDrag.current) return;
    sidebarResizeDrag.current = null;
    setIsResizingSidebar(false);
    try {
      localStorage.setItem("standaid-setout-sidebar-width", String(sidebarWidth));
    } catch {
      // Private browsing or storage disabled — still works this session.
    }
  };

  // The floating toolbar that replaces the sidebar's content while it's
  // collapsed. null means "default corner" (CSS-positioned); once dragged
  // it switches to explicit pixel coordinates relative to the workspace
  // area, same drag-to-reposition pattern as everything else on this page.
  const [floatingToolbarPos, setFloatingToolbarPos] = useState<{ x: number; y: number } | null>(null);
  // Which way the floating toolbar's mode buttons lay out — remembered the
  // same way its collapsed/expanded state is.
  const [floatingToolbarVertical, setFloatingToolbarVertical] = useState(() => {
    try {
      return localStorage.getItem("standaid-setout-floating-toolbar-vertical") !== "false";
    } catch {
      return true;
    }
  });
  const toggleFloatingToolbarOrientation = () => {
    setFloatingToolbarVertical((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("standaid-setout-floating-toolbar-vertical", String(next));
      } catch {
        // Private browsing or storage disabled — still works this session.
      }
      return next;
    });
  };
  const floatingToolbarDrag = useRef<{ pointerId: number; startClientX: number; startClientY: number; startX: number; startY: number } | null>(
    null
  );
  const handleFloatingToolbarDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    const toolbarEl = e.currentTarget.closest("[data-floating-toolbar]") as HTMLElement | null;
    const workspaceEl = toolbarEl?.offsetParent as HTMLElement | null;
    if (!toolbarEl || !workspaceEl) return;
    const workspaceRect = workspaceEl.getBoundingClientRect();
    const toolbarRect = toolbarEl.getBoundingClientRect();
    floatingToolbarDrag.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: toolbarRect.left - workspaceRect.left,
      startY: toolbarRect.top - workspaceRect.top,
    };
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const handleFloatingToolbarDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = floatingToolbarDrag.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    setFloatingToolbarPos({ x: drag.startX + (e.clientX - drag.startClientX), y: drag.startY + (e.clientY - drag.startClientY) });
  };
  const handleFloatingToolbarDragEnd = () => {
    floatingToolbarDrag.current = null;
  };
  const [bulkCircuitId, setBulkCircuitId] = useState<string>("unassigned");
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const pushUndo = (entry: UndoEntry) => setUndoStack((prev) => [...prev.slice(-19), entry]);
  const [editingWalls, setEditingWalls] = useState(false);
  const [pickingMeasurementSlot, setPickingMeasurementSlot] = useState<"refA" | "refB" | null>(null);
  // Points of the LED strip run being traced, kept here (not in the canvas)
  // so undo and "finish run" can act on it — same split as sketchPoints.
  const [stripDraft, setStripDraft] = useState<PathPoint[]>([]);
  // One-shot: the next tap while drawing a strip is a curve control point
  // instead of another corner. Reset whenever the tool/mode changes.
  const [stripCurveMode, setStripCurveMode] = useState(false);
  // The tape-measure chain currently being walked — never saved. Left alone
  // on a mode switch (same as stripDraft) so flicking to another tool and
  // back doesn't lose progress; only Clear or Undo touch it.
  const [measureDraft, setMeasureDraft] = useState<Point[]>([]);
  const [planDefaultsDraft, setPlanDefaultsDraft] = useState({
    ceilingHeightM: DEFAULT_MOUNTING_HEIGHT,
    twinDownlightSpacingMm: DEFAULT_TWIN_SPACING_MM,
    ledWattsPerMetre: DEFAULT_LED_WATTS_PER_METRE,
    ledExtrusionStockLengthM: DEFAULT_EXTRUSION_STOCK_LENGTH_M,
    ledDriverHeadroomPct: DEFAULT_DRIVER_HEADROOM_PCT,
  });
  // The driver sizes are typed as a list ("30, 60, 100"), so the field keeps
  // raw text while it's being edited and only parses on blur — otherwise the
  // comma the tradie just typed gets eaten mid-keystroke.
  const [driverSizesDraft, setDriverSizesDraft] = useState(DEFAULT_DRIVER_SIZES_W.join(", "));
  const [layerVisibility, setLayerVisibility] = useState<LayerVisibility>(DEFAULT_LAYER_VISIBILITY);
  // Keyed by canvas id (not a plain boolean) so switching tabs re-syncs from
  // the newly-active canvas's own saved layer visibility, rather than
  // carrying over whatever the previous tab had showing.
  const layerSyncedRef = useRef<string | null>(null);

  useEffect(() => {
    if (activeCanvas && layerSyncedRef.current !== activeCanvas.id) {
      // Merge over the defaults rather than using the saved value outright —
      // a canvas saved before a new layer (e.g. photoPoints) existed won't
      // have that key yet, and a missing key should mean "default", not
      // "hidden".
      setLayerVisibility({ ...DEFAULT_LAYER_VISIBILITY, ...activeCanvas.layer_visibility });
      layerSyncedRef.current = activeCanvas.id;
    }
  }, [activeCanvas]);

  // Kept in millimetres locally (the unit a tradie actually thinks in) and
  // converted to/from the canvas's metre-based wall_thickness only at the
  // edges — synced once per canvas, keyed the same way as layerVisibility
  // above, so it doesn't get clobbered by a refetch while mid-edit, but does
  // refresh when switching to a different floor/area.
  const [wallThicknessMm, setWallThicknessMm] = useState({ exterior: 230, interior: 110 });
  const wallThicknessSyncedRef = useRef<string | null>(null);

  useEffect(() => {
    if (activeCanvas && wallThicknessSyncedRef.current !== activeCanvas.id) {
      setWallThicknessMm({
        exterior: Math.round(activeCanvas.wall_thickness.exterior * 1000),
        interior: Math.round(activeCanvas.wall_thickness.interior * 1000),
      });
      wallThicknessSyncedRef.current = activeCanvas.id;
    }
  }, [activeCanvas]);

  // Job-wide defaults — synced once on load (not per canvas, these aren't
  // canvas-scoped), same guarded pattern so a refetch can't snap the fields
  // back to a stale value while the tradie is mid-edit.
  const planDefaultsSyncedRef = useRef(false);
  useEffect(() => {
    if (plan && !planDefaultsSyncedRef.current) {
      setPlanDefaultsDraft({
        ceilingHeightM: plan.plan_defaults?.ceilingHeightM ?? DEFAULT_MOUNTING_HEIGHT,
        twinDownlightSpacingMm: plan.plan_defaults?.twinDownlightSpacingMm ?? DEFAULT_TWIN_SPACING_MM,
        ledWattsPerMetre: plan.plan_defaults?.ledWattsPerMetre ?? DEFAULT_LED_WATTS_PER_METRE,
        ledExtrusionStockLengthM:
          plan.plan_defaults?.ledExtrusionStockLengthM ?? DEFAULT_EXTRUSION_STOCK_LENGTH_M,
        ledDriverHeadroomPct: plan.plan_defaults?.ledDriverHeadroomPct ?? DEFAULT_DRIVER_HEADROOM_PCT,
      });
      setDriverSizesDraft((plan.plan_defaults?.ledDriverSizesW ?? DEFAULT_DRIVER_SIZES_W).join(", "));
      planDefaultsSyncedRef.current = true;
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
  // "Check the wiring" toggle — shows every switch-to-light run in red, not
  // just the one gang currently being edited. Situational (turn it on to
  // review, off to keep working), so plain state rather than persisted.
  const [highlightSwitchLinks, setHighlightSwitchLinks] = useState(false);
  // The plan as it was uploaded. Only present for plans imported since the
  // source file started being kept, and only useful when it's a PDF — that's
  // what carries the exact line geometry and can be rasterised again at
  // whatever zoom the tradie is on.
  const [pdfPage, setPdfPage] = useState<PdfPage | null>(null);
  const [vectorIndex, setVectorIndex] = useState<PlanVectorIndex | null>(null);
  const [tile, setTile] = useState<BackgroundTile | null>(null);
  const tileCleanupRef = useRef<(() => void) | null>(null);
  const tileRequestRef = useRef(0);
  useEffect(() => () => tileCleanupRef.current?.(), []);

  // Scene units per metre for this plan. One when calibration was skipped, in
  // which case scene units are image pixels and no distance means anything.
  const planPixelsPerMetre = useMemo(() => {
    const cal = activeCanvas?.scale_calibration;
    return cal ? distance(cal.pointA, cal.pointB) / cal.realDistanceMetres : 1;
  }, [activeCanvas?.scale_calibration]);

  // Read the uploaded PDF, for exact snapping and for sharp re-rendering.
  useEffect(() => {
    const path = activeCanvas?.source_file_path;
    const type = activeCanvas?.source_file_content_type;
    if (!path || (type && !type.includes("pdf"))) {
      setPdfPage(null);
      setVectorIndex(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data: signed } = await supabase.storage.from("setout-plan-uploads").createSignedUrl(path, 3600);
        if (!signed?.signedUrl || cancelled) return;
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
        const buffer = await (await fetch(signed.signedUrl)).arrayBuffer();
        if (cancelled) return;
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
        const page = (await pdf.getPage(1)) as unknown as PdfPage;
        if (cancelled) return;
        setPdfPage(page);
        const lines = await extractPlanLines(page, planPixelsPerMetre, BASE_PDF_SCALE);
        if (!cancelled && lines.length >= 20) setVectorIndex(new PlanVectorIndex(lines));
      } catch (err) {
        // Not fatal: the plan still shows as a flat image, it just can't be
        // snapped to exactly or re-rendered sharply.
        console.error("[SetoutPlan] Could not read the plan's source PDF:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeCanvas?.source_file_path, activeCanvas?.source_file_content_type, planPixelsPerMetre]);

  // Re-rasterise the visible region whenever the view settles, so zooming in
  // shows the plan's real detail rather than magnified pixels.
  const handleViewSettled = useCallback(
    async (view: { x: number; y: number; w: number; h: number; screenWidth: number }) => {
      if (!pdfPage || !backgroundImage) return;
      const token = ++tileRequestRef.current;
      try {
        const planExtent = { w: backgroundImage.width, h: backgroundImage.height };
        const next = await renderPdfTile(pdfPage, view, planExtent, planPixelsPerMetre);
        if (!next) return;
        if (token !== tileRequestRef.current) {
          next.revoke();
          return;
        }
        tileCleanupRef.current?.();
        tileCleanupRef.current = next.revoke;
        setTile({ href: next.href, x: next.x, y: next.y, width: next.coveredW, height: next.coveredH });
      } catch {
        // Leaves the flat image showing.
      }
    },
    [pdfPage, backgroundImage, planPixelsPerMetre]
  );

  /**
   * Turns a tap on the plan into a measurement reference.
   *
   * The tap only chooses WHICH line is meant; the measurement itself is taken
   * square to that line from the fitting, not along the diagonal the tap
   * happened to land on. A tradie measuring a wall holds the tape at right
   * angles to it, and a diagonal here would quietly record a longer distance
   * than the one they'd read on site.
   */
  const handlePickPlanMeasurementRef = useCallback(
    (tap: Point, from: Point, tolerance: number): MeasurementRef | null => {
      const hit = vectorIndex?.nearestEdge(tap.x, tap.y, tolerance);
      if (!hit) return null;
      // The face runs parallel to the line it belongs to, through the snapped
      // point. Drop a perpendicular from the fitting onto it.
      const dx = hit.line.x2 - hit.line.x1;
      const dy = hit.line.y2 - hit.line.y1;
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) return null;
      const ux = dx / len;
      const uy = dy / len;
      const along = (from.x - hit.point.x) * ux + (from.y - hit.point.y) * uy;
      const foot = { x: hit.point.x + ux * along, y: hit.point.y + uy * along };
      return { kind: "stroke", point: foot, dirX: ux, dirY: uy, distance: Math.hypot(from.x - foot.x, from.y - foot.y) };
    },
    [vectorIndex]
  );

  // Fittings are set out from the FACE of a wall — what a tape measures to —
  // not its centreline, which is what tracing follows.
  //
  // The tolerance arrives in screen pixels, which is right for tracing — you
  // are following a line, and it should feel the same at any zoom — but wrong
  // for placing, at both ends of the range.
  //
  // Zoomed out to a whole sheet, twenty screen pixels is the better part of a
  // metre of building, and a fitting jumps onto a wall it was nowhere near.
  // Zoomed right in it is the opposite problem: twenty pixels becomes a few
  // millimetres, so the snap stops helping exactly when the tradie has zoomed
  // in to place something precisely.
  //
  // So placing is bounded in real terms at both ends: never grab from further
  // than a hand's width, never demand better than a few millimetres.
  const MIN_PLACE_SNAP_M = 0.025;
  const MAX_PLACE_SNAP_M = 0.15;
  const snapToPlan = useCallback((point: Point, tolerance: number): Point | null => {
    const bounded = Math.min(Math.max(tolerance, MIN_PLACE_SNAP_M), MAX_PLACE_SNAP_M);
    return vectorIndex?.nearestEdge(point.x, point.y, bounded)?.point ?? null;
  }, [vectorIndex]);

  useEffect(() => {
    if (!activeCanvas?.background_image_path) {
      setBackgroundImage(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data: signed } = await supabase.storage.from("setout-plan-uploads").createSignedUrl(activeCanvas.background_image_path!, 3600);
      if (!signed?.signedUrl || cancelled) return;
      const img = new Image();
      img.onload = () => {
        if (cancelled) return;
        // With calibration skipped there is no real-world scale, so the
        // image is placed at one scene unit per pixel. Nothing may report a
        // distance in that state — see hasScale below.
        setBackgroundImage({
          href: signed.signedUrl,
          width: img.naturalWidth / planPixelsPerMetre,
          height: img.naturalHeight / planPixelsPerMetre,
        });
      };
      img.src = signed.signedUrl;
    })();
    return () => {
      cancelled = true;
    };
  }, [activeCanvas?.background_image_path, activeCanvas?.scale_calibration]);

  // Photo points: tap a spot in "place-photo-points" mode → stash that
  // position here → immediately click the hidden camera input. The row
  // only gets created once a photo actually comes back (onPhotoFilePicked),
  // so cancelling the camera just discards the pending position — nothing
  // to clean up.
  const photoInputRef = useRef<HTMLInputElement>(null);
  // No capture attribute — this one opens the phone's photo library, not the
  // live camera, since a true 360° photo always already exists as a file
  // (shot in the phone's own Panorama/Photo Sphere camera mode — a website
  // can't trigger that capture mode itself, only the OS camera app can).
  const photo360InputRef = useRef<HTMLInputElement>(null);
  const pendingPhotoPointPosition = useRef<Point | null>(null);
  const [uploadingPhotoPoint, setUploadingPhotoPoint] = useState(false);
  const [activePhotoPointId, setActivePhotoPointId] = useState<string | null>(null);
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [activePhotoUrl, setActivePhotoUrl] = useState<string | null>(null);
  const [loadingActivePhoto, setLoadingActivePhoto] = useState(false);
  // Tap a spot in "place-photo-points" mode → this small menu (anchored at
  // the tap, same convention as the switch double-tap menu) offers "Take
  // photo" (live camera) or "Upload 360°" (existing panorama file) rather
  // than assuming which one's wanted.
  const [photoPointChoiceMenu, setPhotoPointChoiceMenu] = useState<{ x: number; y: number } | null>(null);

  // Find the current photo and its gallery. Grouped from the active canvas's
  // own photo points only — positions are local to each canvas, so two
  // points on different floors could otherwise coincidentally share
  // coordinates and get grouped as if they were the same physical spot.
  const activePhotoPoint = photoPoints.find((p) => p.id === activePhotoPointId) ?? null;
  const photoGalleries = groupPhotosByPosition(canvasPhotoPoints);
  const activeGallery = activePhotoPoint ? photoGalleries.find((g) => g.photos.some((p) => p.id === activePhotoPointId)) : null;
  const currentPhotoInGallery = activeGallery?.photos[activePhotoIndex] ?? activePhotoPoint;

  const handlePhotoPointPlace = (point: Point, clientX: number, clientY: number) => {
    pendingPhotoPointPosition.current = point;
    setPhotoPointChoiceMenu({ x: clientX, y: clientY });
  };

  const handleChooseTakePhoto = () => {
    setPhotoPointChoiceMenu(null);
    setCameraOpen(true);
  };

  const handleChooseUpload360 = () => {
    setPhotoPointChoiceMenu(null);
    photo360InputRef.current?.click();
  };

  const handleCameraCapture = async (blob: Blob) => {
    if (!user || !planId || !activeCanvas) return;
    setUploadingPhotoPoint(true);
    try {
      const path = `${user.id}/${planId}/${crypto.randomUUID()}.jpg`;
      const { error: upErr } = await supabase.storage.from("setout-photo-points").upload(path, blob, { contentType: "image/jpeg" });
      if (upErr) throw upErr;
      const position = pendingPhotoPointPosition.current;
      pendingPhotoPointPosition.current = null;
      if (!position) throw new Error("Photo point position lost");
      const created = await createPhotoPoint.mutateAsync({ canvas_id: activeCanvas.id, position, storage_path: path });
      setActivePhotoPointId(created.id);
      loadPhotoPointUrl(path);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save that photo.");
    } finally {
      setUploadingPhotoPoint(false);
    }
  };

  const handleNextPhoto = () => {
    if (activeGallery && activePhotoIndex < activeGallery.photos.length - 1) {
      setActivePhotoIndex((prev) => prev + 1);
      const nextPhoto = activeGallery.photos[activePhotoIndex + 1];
      setActivePhotoPointId(nextPhoto.id);
      loadPhotoPointUrl(nextPhoto.storage_path);
    }
  };

  const handlePrevPhoto = () => {
    if (activePhotoIndex > 0) {
      setActivePhotoIndex((prev) => prev - 1);
      const prevPhoto = activeGallery!.photos[activePhotoIndex - 1];
      setActivePhotoPointId(prevPhoto.id);
      loadPhotoPointUrl(prevPhoto.storage_path);
    }
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
    // Find which index this photo is in its gallery
    const gallery = photoGalleries.find((g) => g.photos.some((p) => p.id === photoPointId));
    const index = gallery?.photos.findIndex((p) => p.id === photoPointId) ?? 0;
    setActivePhotoIndex(index);
    loadPhotoPointUrl(point.storage_path);
  };

  const handlePhotoFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    const position = pendingPhotoPointPosition.current;
    pendingPhotoPointPosition.current = null;
    if (!file || !user || !planId || !position || !activeCanvas) return;
    setUploadingPhotoPoint(true);
    try {
      const blob = await compressImageToBlob(file);
      const path = `${user.id}/${planId}/${crypto.randomUUID()}.jpg`;
      const { error: upErr } = await supabase.storage.from("setout-photo-points").upload(path, blob, { contentType: "image/jpeg" });
      if (upErr) throw upErr;
      const created = await createPhotoPoint.mutateAsync({ canvas_id: activeCanvas.id, position, storage_path: path });
      setActivePhotoPointId(created.id);
      loadPhotoPointUrl(path);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save that photo.");
    } finally {
      setUploadingPhotoPoint(false);
    }
  };

  const handlePhoto360FilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    const position = pendingPhotoPointPosition.current;
    pendingPhotoPointPosition.current = null;
    if (!file || !user || !planId || !position || !activeCanvas) return;
    setUploadingPhotoPoint(true);
    try {
      // A higher cap than the flat-photo path — an equirectangular panorama
      // needs real resolution to look like anything once you're inside it,
      // not just viewed as a thumbnail.
      const blob = await compressImageToBlob(file, 4096);
      const path = `${user.id}/${planId}/${crypto.randomUUID()}.jpg`;
      const { error: upErr } = await supabase.storage.from("setout-photo-points").upload(path, blob, { contentType: "image/jpeg" });
      if (upErr) throw upErr;
      const created = await createPhotoPoint.mutateAsync({ canvas_id: activeCanvas.id, position, storage_path: path, photo_type: "360" });
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

  // Double-tapping a measurement on the plan starts re-pointing it there and
  // then, rather than selecting the fitting, finding the measurement in the
  // panel and pressing Change. The next tap sets it.
  const handleMeasurementDoubleTap = (fittingId: string, slot: "refA" | "refB") => {
    setSelectedFittingId(fittingId);
    setPickingMeasurementSlot(slot);
    toast.info("Tap the plan to set where this measurement comes from");
  };

  const handleMeasurementRefPick = (ref: MeasurementRef) => {
    if (!selectedFittingId || !selectedFitting?.measurement_lock || !pickingMeasurementSlot) return;
    updateFittingMeasurementLock.mutate({
      fittingId: selectedFittingId,
      // Marks the whole lock as the tradie's choice, so moving the fitting
      // re-measures against what they picked instead of reverting to whatever
      // wall is nearest.
      measurement_lock: { ...selectedFitting.measurement_lock, [pickingMeasurementSlot]: ref, userSet: true },
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

  // How this fitting gets dimensioned. Traced walls win when they exist —
  // they're what the tradie chose as the reference, and a measurement against
  // them survives editing them. With tracing skipped the imported drawing is
  // the only reference there is, so the two nearest faces at right angles are
  // measured to directly, which is how a fitting is dimensioned on site
  // anyway: so much off one wall, so much off the one square to it.
  const measurementLockFor = (point: Point, type?: FittingType): MeasurementLock | null => {
    if (!activeCanvas) return null;
    if (activeCanvas.walls.length > 0) return computeMeasurementLock(point, activeCanvas.walls, type);
    if (!vectorIndex) return null;
    const { alongX, alongY } = measureToFaces(vectorIndex, point.x, point.y);
    // alongX was measured to a line running vertically, and vice versa.
    const across: MeasurementRef | null = alongX
      ? { kind: "stroke", point: alongX.point, dirX: 0, dirY: 1, distance: alongX.distance }
      : null;
    const down: MeasurementRef | null = alongY
      ? { kind: "stroke", point: alongY.point, dirX: 1, dirY: 0, distance: alongY.distance }
      : null;

    if (type && isSingleWallFitting(type)) {
      // A switch or GPO is already fixed to its wall, so its distance off that
      // wall is not a measurement anyone takes — the one reading that places it
      // is how far ALONG the wall it sits. Measuring along the wall also means
      // measuring to something square to it, so the mounting wall can't be
      // picked as its own reference.
      const mount = vectorIndex.nearestEdge(point.x, point.y, MAX_PLACE_SNAP_M);
      if (!mount) return null;
      const runsHorizontal = Math.abs(mount.line.x2 - mount.line.x1) >= Math.abs(mount.line.y2 - mount.line.y1);
      const alongWall = runsHorizontal ? across : down;
      return alongWall ? { refA: alongWall } : null;
    }

    if (across && down) return { refA: across, refB: down };
    const only = across ?? down;
    return only ? { refA: only } : null;
  };

  /**
   * What this fitting's measurement should be if it sat here.
   *
   * Shared by the drag preview and the drop, deliberately: a number that
   * changes the instant the fitting lands is worse than no number at all,
   * because the tradie positions against what they can see.
   */
  // Referentially stable: the canvas holds this in the dependencies of the
  // memo that lays out measurement labels, and that does a collision pass over
  // every label — recreating this each render would redo all of it on any
  // unrelated state change.
  /**
   * Which way a wall-mounted fitting faces.
   *
   * With walls traced, that comes from the traced geometry. Without them it is
   * read off the plan's own line work: the side the tap came from is the room
   * the tradie is standing in, so the fitting faces that way. That is actually
   * the sounder of the two — working it out from the shape of the building
   * assumes the inside is in one direction, which is untrue of any L-shaped
   * plan, where a switch in a wing can end up facing the wrong way.
   */
  const wallMountRotation = (point: Point, rawPoint: Point): number | null => {
    if (activeCanvas && activeCanvas.walls.length > 0) return autoRotationForWallMount(point, activeCanvas.walls);
    const hit = vectorIndex?.nearestEdge(rawPoint.x, rawPoint.y, MAX_PLACE_SNAP_M);
    if (!hit) return null;
    // Same convention as rotationFacingRoom in setoutGeometry.
    return Math.round(((Math.atan2(hit.normal.x, -hit.normal.y) * 180) / Math.PI + 360) % 360);
  };

  const lockForFittingAt = useCallback((fitting: SetoutFitting, position: Point): MeasurementLock | null => {
    if (!activeCanvas) return null;
    const existing = fitting.measurement_lock;
    return existing?.userSet
      ? remeasureLock(existing, position, {
          walls: activeCanvas.walls,
          openings: activeCanvas.openings ?? [],
          fittings,
          wallThickness: activeCanvas.wall_thickness,
        })
      : measurementLockFor(position, fitting.type);
    // measurementLockFor reads activeCanvas and vectorIndex, both listed here.
  }, [activeCanvas, fittings, vectorIndex]);

  const handlePlaceFitting = (point: Point, rawPoint: Point) => {
    if (!selectedType || !plan || !activeCanvas) return;
    // A downlight sits flush in the ceiling, so its "mounting height" is the
    // room's ceiling height — seeded from this job's ceiling-height default
    // (see PlanDefaults) rather than left blank, because lightPoolRadius's
    // coverage-circle maths needs a real height to be accurate. Falling
    // through to the hardcoded 2.4m default here (via the plan_defaults
    // fallback) would silently mis-size every circle on a job with a
    // different ceiling height.
    const defaultHeight =
      selectedType === "downlight"
        ? plan.plan_defaults?.ceilingHeightM ?? DEFAULT_MOUNTING_HEIGHT
        : defaultHeightForType(selectedType);
    const isWallMounted = isSingleWallFitting(selectedType);
    // A quick-pick preset's specs (e.g. { count: 2 } for "GPO — double") go
    // in first — the placement-computed fields below (height, rotation)
    // never collide with what a preset sets, so this is a plain overlay,
    // not a field-by-field merge decision.
    const specs: FittingSpecs = { ...selectedPresetSpecs };
    if (defaultHeight != null) specs.mountingHeight = defaultHeight;
    if (isWallMounted) {
      const rotation = wallMountRotation(point, rawPoint);
      if (rotation != null) specs.rotation = rotation;
    }
    createFitting.mutate(
      {
        canvas_id: activeCanvas.id,
        type: selectedType,
        position: point,
        measurement_lock: measurementLockFor(point, selectedType),
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

  const commitPlanDefaults = () => {
    updatePlanDefaults.mutate({
      ceilingHeightM: planDefaultsDraft.ceilingHeightM,
      twinDownlightSpacingMm: planDefaultsDraft.twinDownlightSpacingMm,
      ledWattsPerMetre: planDefaultsDraft.ledWattsPerMetre,
      ledExtrusionStockLengthM: planDefaultsDraft.ledExtrusionStockLengthM,
      ledDriverHeadroomPct: planDefaultsDraft.ledDriverHeadroomPct,
      ledDriverSizesW: parseDriverSizes(driverSizesDraft),
      ledProfile: plan?.plan_defaults?.ledProfile,
    });
  };

  const handleStripPointAdd = (point: Point, curveControl?: Point) =>
    setStripDraft((prev) => [...prev, curveControl ? { ...point, curveControl } : point]);
  const handleStripUndo = () => setStripDraft((prev) => prev.slice(0, -1));
  const handleStripCancel = () => setStripDraft([]);

  const handleMeasurePointAdd = (point: Point) => setMeasureDraft((prev) => [...prev, point]);
  const handleMeasureUndo = () => setMeasureDraft((prev) => prev.slice(0, -1));
  const handleMeasureClear = () => setMeasureDraft([]);

  // A run needs at least two points to be a run. The fitting's position is
  // path[0] so that measurements, circuits and selection — all of which work
  // off position — keep working on a strip with no special-casing.
  const handleStripFinish = () => {
    if (stripDraft.length < 2) {
      toast.error("A strip needs at least two points — tap along the run, then finish.");
      return;
    }
    if (!activeCanvas) return;
    const path = stripDraft;
    createFitting.mutate(
      {
        canvas_id: activeCanvas.id,
        type: "led_strip",
        position: path[0],
        measurement_lock: measurementLockFor(path[0], "led_strip"),
        specs: {
          path,
          ledWattsPerMetre: plan?.plan_defaults?.ledWattsPerMetre ?? DEFAULT_LED_WATTS_PER_METRE,
          ledProfile: plan?.plan_defaults?.ledProfile ?? "surface",
          ledExtrusionStockLengthM:
            plan?.plan_defaults?.ledExtrusionStockLengthM ?? DEFAULT_EXTRUSION_STOCK_LENGTH_M,
        },
      },
      {
        onSuccess: (created) => {
          pushUndo({ type: "create", fittingId: created.id });
          setStripDraft([]);
          toast.success(`LED strip added — ${Math.round(pathLength(path) * 1000)}mm`);
        },
      }
    );
  };

  const handleFittingDrag = (fittingId: string, position: Point) => {
    if (!activeCanvas) return;
    const fitting = fittings.find((f) => f.id === fittingId);
    if (!fitting) return;
    // Re-lock on every manual adjustment — the whole point of the lock is
    // that it always reflects where the fitting actually is right now.
    // Wall-mounted types also re-orient in case the drag moved them to a
    // different wall, unless the tradie has manually overridden the facing
    // (rotationLocked) — see handleRotate.
    const specs =
      isSingleWallFitting(fitting.type) && !fitting.specs.rotationLocked
        ? { ...fitting.specs, rotation: autoRotationForWallMount(position, activeCanvas.walls) }
        : undefined;
    pushUndo({ type: "move", fittingId, prevPosition: fitting.position, prevMeasurementLock: fitting.measurement_lock, prevSpecs: fitting.specs });
    updateFittingPosition.mutate({ fittingId, position, measurement_lock: lockForFittingAt(fitting, position), specs });
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

  // Double-tapping a switch and picking a gang starts linking from that gang
  // straight away, rather than switching to link mode, tapping the switch, and
  // then choosing the gang in the side panel.
  const handleLinkFromGang = (switchFitting: SetoutFitting, gangIndex: number) => {
    setWorkspaceMode("link-switches");
    setActiveSwitchId(switchFitting.id);
    setActiveGangIndex(gangIndex);
    setSwitchMenu(null);
    toast.info(`Linking switch ${gangIndex + 1} — tap the lights it operates`);
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

  // Cycles a gang: plain switch -> dimmer -> push-button dimmer -> back to
  // plain switch. Only the plain (standard/rotary) dimmer is physically
  // wider than an ordinary switch mech — see switchMaterials in
  // setoutMaterials.ts for how that turns into an extra plate position on
  // the order list (a push-button dimmer doesn't need one).
  const handleCycleDimmer = (switchFitting: SetoutFitting, gangIndex: number) => {
    const dimmerGangs = switchFitting.specs.dimmerGangs ?? [];
    const pushButtonDimmerGangs = switchFitting.specs.pushButtonDimmerGangs ?? [];
    const isDimmer = dimmerGangs.includes(gangIndex);
    const isPushButton = pushButtonDimmerGangs.includes(gangIndex);

    let nextDimmerGangs = dimmerGangs;
    let nextPushButtonDimmerGangs = pushButtonDimmerGangs;
    if (!isDimmer) {
      // plain switch -> standard dimmer
      nextDimmerGangs = [...dimmerGangs, gangIndex];
    } else if (!isPushButton) {
      // standard dimmer -> push-button dimmer
      nextPushButtonDimmerGangs = [...pushButtonDimmerGangs, gangIndex];
    } else {
      // push-button dimmer -> plain switch
      nextDimmerGangs = dimmerGangs.filter((i) => i !== gangIndex);
      nextPushButtonDimmerGangs = pushButtonDimmerGangs.filter((i) => i !== gangIndex);
    }

    updateFittingSpecs.mutate({
      fittingId: switchFitting.id,
      specs: { ...switchFitting.specs, dimmerGangs: nextDimmerGangs, pushButtonDimmerGangs: nextPushButtonDimmerGangs },
    });
  };

  const handleExport = async () => {
    if (!plan || exporting || !user || canvases.length === 0) return;
    setExporting(true);
    try {
      // The marked-up pages need the drawing that was marked up on each —
      // one plan page per floor/area, so every canvas's own background image
      // (not just whichever tab is currently active) needs fetching. jsPDF
      // embeds data, not a remote URL, so each signed image is fetched and
      // inlined — failing that, that canvas's page still renders with just
      // its walls and fittings.
      const planImages = new Map<string, PlanImage>();
      for (const canvas of canvases) {
        const image = await loadPlanImageForCanvas(canvas);
        if (image) planImages.set(canvas.id, image);
      }

      const baseFilename = (plan.name || "setout-plan").replace(/[^a-z0-9]+/gi, "-").toLowerCase();

      // The storage path is deterministic (one file per plan, overwritten
      // every export), so the switchboard legend's QR code can be baked in
      // pointing at it before the file itself is actually uploaded below.
      const reportPath = `${user.id}/${plan.id}.pdf`;
      const reportUrl = supabase.storage.from("setout-plan-exports").getPublicUrl(reportPath).data.publicUrl;

      // Same business-branding source as the Site Audit report — the
      // switchboard legend gets stuck in the switchboard, so it needs to
      // identify who wired the job just as much as an audit report does.
      const p = (profile as any) || {};
      let logoBase64: string | null = null;
      if (p.logo_storage_path) {
        const { data: signed } = await supabase.storage.from("business-logos").createSignedUrl(p.logo_storage_path, 3600);
        if (signed?.signedUrl) logoBase64 = await urlToBase64(signed.signedUrl);
      }

      // One PDF — marked-up plan, materials, maximum demand, switchboard
      // legend — downloaded and also published to public storage so the
      // legend's own QR code opens the whole thing, circuits included, not
      // just a bare plan.
      const doc = await generateSetoutReportPdf({
        plan,
        canvases,
        fittings,
        circuits,
        loadItems,
        planImages,
        reportUrl,
        business: {
          name: p.business_name || p.display_name || null,
          licenceNumber: p.licence_number || null,
          phone: p.business_phone || null,
          email: p.business_email || user?.email || null,
          logoBase64,
        },
      });
      doc.save(`${baseFilename}.pdf`);

      try {
        const reportBlob = doc.output("blob") as Blob;
        const { error: uploadError } = await supabase.storage
          .from("setout-plan-exports")
          .upload(reportPath, reportBlob, { contentType: "application/pdf", upsert: true });
        if (uploadError) throw uploadError;
      } catch (err) {
        console.error("[SetoutPlan] Could not publish the report for the QR code:", err);
      }
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
    setSelectedPresetSpecs({});
    setActiveSwitchId(null);
    setActiveGangIndex(0);
    setActiveCabinetId(null);
    setMultiSelectIds(new Set());
    setPickingMeasurementSlot(null);
    setStripCurveMode(false);
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
  // Desktop mode toggle (horizontal flex wrap)
  // One config feeding two layouts: the full sidebar wraps these
  // horizontally, the floating toolbar (shown when the sidebar's collapsed)
  // stacks them in a single vertical column instead — see modeToggleUI vs
  // floatingModeToggleUI below. Kept as one list so the two can't drift out
  // of sync with each other.
  const MODE_TOGGLE_ITEMS: { mode: WorkspaceMode; label: string; Icon: typeof MousePointerClick }[] = [
    { mode: "place-fittings", label: "Place fittings", Icon: MousePointerClick },
    { mode: "link-switches", label: "Link switches", Icon: Cable },
    { mode: "link-data-cabinet", label: "Link data cabinet", Icon: Network },
    { mode: "select-multiple", label: "Select multiple", Icon: CheckSquare },
    { mode: "draw-led-strip", label: "Draw LED strip", Icon: Minus },
    { mode: "measure", label: "Measure", Icon: Ruler },
    ...(hasPhotoPointsAccess ? [{ mode: "place-photo-points" as WorkspaceMode, label: "Photo points", Icon: Camera }] : []),
  ];
  const modeToggleUI = (
    <div className="flex flex-wrap gap-1.5">
      {MODE_TOGGLE_ITEMS.map(({ mode, label, Icon }) => (
        <button
          key={mode}
          type="button"
          onClick={() => handleWorkspaceModeChange(mode)}
          className={cn(
            "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
            workspaceMode === mode ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground"
          )}
        >
          <Icon className="h-3.5 w-3.5" /> {label}
        </button>
      ))}
    </div>
  );
  const floatingModeToggleUI = (
    <div className="flex flex-col gap-1.5">
      {MODE_TOGGLE_ITEMS.map(({ mode, label, Icon }) => (
        <button
          key={mode}
          type="button"
          onClick={() => handleWorkspaceModeChange(mode)}
          className={cn(
            "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors text-left",
            workspaceMode === mode ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground"
          )}
        >
          <Icon className="h-3.5 w-3.5 flex-shrink-0" /> {label}
        </button>
      ))}
    </div>
  );

  // Tap along the run on the plan, then finish it. Kept as a panel rather
  // than a double-tap-to-finish gesture because a strip is usually only two
  // or three points — a mis-read double tap would cost the whole run.
  const stripPanelUI = (
    <div className="rounded-xl border border-border bg-card p-3 space-y-3">
      <div>
        <p className="text-sm font-medium">Draw an LED strip</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Tap along the run on the plan — corners and all — then finish it. It snaps to the plan's lines and squares up as you go.
          {stripCurveMode && " Tap where the strip should bulge to, then the point it ends at."}
        </p>
      </div>
      <div className="rounded-lg bg-muted/50 px-3 py-2">
        <p className="text-xs text-muted-foreground">
          {stripDraft.length === 0
            ? "No points yet"
            : stripDraft.length === 1
              ? "1 point — tap again to make a run"
              : `${stripDraft.length} points · ${Math.round(pathLength(stripDraft) * 1000)}mm`}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={handleStripFinish} disabled={stripDraft.length < 2 || createFitting.isPending}>
          {createFitting.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
          Finish run
        </Button>
        <Button size="sm" variant="outline" onClick={handleStripUndo} disabled={stripDraft.length === 0}>
          <Undo2 className="h-3.5 w-3.5 mr-1.5" /> Undo point
        </Button>
        <Button size="sm" variant="ghost" onClick={handleStripCancel} disabled={stripDraft.length === 0}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant={stripCurveMode ? "default" : "outline"}
          disabled={stripDraft.length === 0}
          onClick={() => setStripCurveMode((v) => !v)}
        >
          Curve
        </Button>
      </div>
    </div>
  );

  // An ad-hoc tape measure — walk out a run of points (a hallway, say) and
  // read the leg lengths and total straight off the plan. Never saved as a
  // fitting; Clear just drops the points and starts fresh.
  const measurePanelUI = (
    <div className="rounded-xl border border-border bg-card p-3 space-y-3">
      <div>
        <p className="text-sm font-medium">Measure</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Tap along the run on the plan — a hallway, a wall run, whatever you need a distance for. It snaps to the plan's
          lines and squares up as you go, same as the LED strip tool. Not saved to the plan.
        </p>
      </div>
      <div className="rounded-lg bg-muted/50 px-3 py-2 space-y-1">
        {measureDraft.length < 2 ? (
          <p className="text-xs text-muted-foreground">
            {measureDraft.length === 0 ? "No points yet" : "1 point — tap again to measure to it"}
          </p>
        ) : (
          <>
            {measureDraft.slice(1).map((pt, i) => (
              <p key={i} className="text-xs text-muted-foreground">
                Leg {i + 1}: <span className="font-medium text-foreground">{formatMm(distance(measureDraft[i], pt))}</span>
              </p>
            ))}
            <p className="text-xs font-semibold text-foreground pt-1 border-t border-border">
              Total: {formatMm(pathLength(measureDraft))}
            </p>
          </>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={handleMeasureUndo} disabled={measureDraft.length === 0}>
          <Undo2 className="h-3.5 w-3.5 mr-1.5" /> Undo point
        </Button>
        <Button size="sm" variant="ghost" onClick={handleMeasureClear} disabled={measureDraft.length === 0}>
          Clear
        </Button>
      </div>
    </div>
  );

  // Mobile bottom toolbar (large glove-friendly buttons)
  const mobileToolbarUI = (
    <div className="fixed bottom-0 left-0 right-0 md:hidden bg-card border-t border-border p-2 flex gap-2 overflow-x-auto">
      <button
        onClick={() => setSelectedType(null)}
        className="flex flex-col items-center justify-center h-14 w-14 rounded-lg border border-border text-muted-foreground transition-colors flex-shrink-0 hover:bg-muted"
        title="Pan map (drag to move)"
      >
        <GripHorizontal className="h-5 w-5" />
      </button>
      <button
        onClick={() => { handleWorkspaceModeChange("place-fittings"); setMobileDrawerOpen(true); }}
        className={cn(
          "flex flex-col items-center justify-center h-14 w-14 rounded-lg border transition-colors flex-shrink-0",
          workspaceMode === "place-fittings" ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground"
        )}
        title="Place fittings"
      >
        <MousePointerClick className="h-5 w-5" />
      </button>
      <button
        onClick={() => { handleWorkspaceModeChange("link-switches"); setMobileDrawerOpen(true); }}
        className={cn(
          "flex flex-col items-center justify-center h-14 w-14 rounded-lg border transition-colors flex-shrink-0",
          workspaceMode === "link-switches" ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground"
        )}
        title="Link switches"
      >
        <Cable className="h-5 w-5" />
      </button>
      <button
        onClick={() => { handleWorkspaceModeChange("link-data-cabinet"); setMobileDrawerOpen(true); }}
        className={cn(
          "flex flex-col items-center justify-center h-14 w-14 rounded-lg border transition-colors flex-shrink-0",
          workspaceMode === "link-data-cabinet" ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground"
        )}
        title="Link data cabinet"
      >
        <Network className="h-5 w-5" />
      </button>
      <button
        onClick={() => { handleWorkspaceModeChange("draw-led-strip"); setMobileDrawerOpen(true); }}
        className={cn(
          "flex flex-col items-center justify-center h-14 w-14 rounded-lg border transition-colors flex-shrink-0",
          workspaceMode === "draw-led-strip" ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground"
        )}
        title="Draw LED strip"
      >
        <Minus className="h-5 w-5" />
      </button>
      {hasPhotoPointsAccess && (
        <button
          onClick={() => { handleWorkspaceModeChange("place-photo-points"); setMobileDrawerOpen(true); }}
          className={cn(
            "flex flex-col items-center justify-center h-14 w-14 rounded-lg border transition-colors flex-shrink-0",
            workspaceMode === "place-photo-points" ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground"
          )}
          title="Photo points"
        >
          <Camera className="h-5 w-5" />
        </button>
      )}
    </div>
  );

  if (planLoading || fittingsLoading || canvasesLoading) {
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

  // Every job should have at least one canvas (created alongside the plan,
  // or backfilled by the canvases migration) — this only shows if that
  // somehow failed, so the tradie isn't stuck looking at a blank screen.
  if (!activeCanvas) {
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
          <p className="text-xs text-muted-foreground mb-5">This job has no floor or area set up yet.</p>
          <Button
            className="w-full h-12 font-bold rounded-xl text-base"
            disabled={createCanvas.isPending}
            onClick={() => createCanvas.mutate({ name: "Ground Floor", source_type: "draw", sort_order: 0 })}
          >
            {createCanvas.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add a floor or area"}
          </Button>
        </div>
      </div>
    );
  }

  if (editingWalls) {
    return <EditWallsFlow canvas={activeCanvas} onClose={() => setEditingWalls(false)} />;
  }

  // No walls is a valid state on the active canvas: tracing them is
  // optional, and a plan image is enough to place things on and measure
  // from. Only a canvas with neither is shown the trace/import prompt below
  // instead of the drawing workspace.
  const activeCanvasNeedsSetup = activeCanvas.walls.length === 0 && !activeCanvas.background_image_path;

  // Calibration was skipped, so scene units are image pixels and any distance
  // shown would be a number with no relation to the building. Things can still
  // be placed — the tradie just has to know not to read dimensions off it.
  const hasScale = !!activeCanvas.scale_calibration;

  // Whichever tool's own panel is active — just that, no measurement list or
  // circuits legend. This is what the floating toolbar shows (it's meant to
  // be a compact stand-in for switching tools and placing things, not the
  // full sidebar); workspacePanelUI below adds the rest back for the
  // expanded sidebar. Takes `compact` rather than being a plain const so the
  // horizontal floating toolbar (which needs FittingPalette trimmed to just
  // its dropdown — see FittingPalette's own compact prop) and the vertical
  // one/full sidebar (which don't) can both use this without duplicating it.
  const renderActiveToolPanel = (compact: boolean) => (
    <>
      {workspaceMode === "place-fittings" ? (
        <FittingPalette
          compact={compact}
          twinSpacingDefaultMm={plan?.plan_defaults?.twinDownlightSpacingMm}
          ceilingHeightDefaultM={plan?.plan_defaults?.ceilingHeightM}
          selectedType={selectedType}
          onSelectType={setSelectedType}
          onSelectPreset={handleSelectPreset}
          selectedPresetSpecs={selectedPresetSpecs}
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
      ) : workspaceMode === "draw-led-strip" ? (
        stripPanelUI
      ) : workspaceMode === "measure" ? (
        measurePanelUI
      ) : workspaceMode === "link-switches" ? (
        <SwitchLinksPanel
          fittings={fittings}
          activeSwitchId={activeSwitchId}
          activeGangIndex={activeGangIndex}
          onSelectSwitch={handleSelectSwitch}
          onSelectGang={setActiveGangIndex}
          onAddGang={handleAddGang}
          onRemoveGang={handleRemoveGang}
          onCycleDimmer={handleCycleDimmer}
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
    </>
  );

  // The full sidebar's content: the active tool panel above, plus the
  // measurement list and circuits legend underneath it. See
  // renderActiveToolPanel for why the floating toolbar doesn't get these two.
  const workspacePanelUI = (
    <>
      {renderActiveToolPanel(false)}

      <div className="pt-4 border-t border-border">
        <Accordion type="single" collapsible>
          <AccordionItem value="measurements" className="border-b-0">
            <AccordionTrigger className="py-0 font-sans text-base font-extrabold text-foreground hover:no-underline">
              Measurement list
              {lockedCount > 0 && <span className="ml-1.5 text-xs font-medium text-muted-foreground">({lockedCount})</span>}
            </AccordionTrigger>
            <AccordionContent className="pt-3">
              <MeasurementListPanel fittings={canvasFittings} walls={activeCanvas.walls} />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>

      <div className="pt-4 border-t border-border">
        <Accordion type="single" collapsible>
          <AccordionItem value="circuits" className="border-b-0">
            <AccordionTrigger className="py-0 font-sans text-base font-extrabold text-foreground hover:no-underline">
              Circuits &amp; switchboard legend
            </AccordionTrigger>
            <AccordionContent className="pt-3">{planId && <CircuitsPanel planId={planId} />}</AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </>
  );

  return (
    <div className="h-full overflow-y-auto">
      {/* No max-width cap here — the canvas+sidebar workspace should use the
          full viewport width. A max-w-7xl cap used to centre this and leave
          blank gutters on wide monitors instead of letting the (now
          user-resizable) right sidebar reach the true edge of the screen. */}
      <div className="px-5 pt-3 pb-24 md:pb-8">
        {/* Only imported plan images have a scale to calibrate — a drawn
            canvas has real metres typed in as each wall is sketched, so
            there's never a scale to set for it. Also hidden during the
            trace/import setup screen itself: nothing's been placed yet, so
            the warning has nothing useful to say and was just pushing that
            screen down. */}
        {activeCanvas.source_type === "import" && !hasScale && !activeCanvasNeedsSetup && (
          <div className="mb-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
            <p className="text-xs font-semibold text-foreground">No scale set on this plan</p>
            <p className="text-[11px] text-muted-foreground">
              You skipped calibration when this plan was uploaded, so any measurement shown is not a real distance.
              There's currently no way to set it after the fact — delete this floor/area and re-add it with the same
              image to calibrate scale during upload.
            </p>
          </div>
        )}
        <div className="flex items-center gap-3 mb-2 min-w-0">
          <button
            onClick={() => navigate("/setout")}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground flex-shrink-0"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <h2 className="font-sans text-lg font-extrabold text-foreground truncate">{plan.name}</h2>
        </div>

        {/* One tab per floor/area in this job — a two-storey house gets a
            Ground Floor and First Floor tab, or a job can add an unrelated
            extra canvas (e.g. Outdoor Lighting) that isn't on the house plan
            at all. Circuits, Max demand and materials stay shared across
            every tab; only what's drawn/placed is specific to the active one. */}
        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
          <Tabs value={activeCanvas.id} onValueChange={setActiveCanvasId}>
            <TabsList className="h-auto flex-wrap justify-start gap-1 bg-transparent p-0">
              {canvases.map((c) => (
                <TabsTrigger key={c.id} value={c.id}>
                  {c.name}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => setCanvasNameDialog({ mode: "add", name: "" })}
          >
            <Plus className="h-3.5 w-3.5" />
            Add floor/area
          </Button>
          {/* Rename/delete apply to whichever tab is currently active. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="h-8 w-8" title={`Rename or delete "${activeCanvas.name}"`}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => setCanvasNameDialog({ mode: "rename", name: activeCanvas.name })}>
                <Pencil className="h-3.5 w-3.5 mr-1.5" />
                Rename "{activeCanvas.name}"
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                disabled={canvases.length <= 1}
                onClick={() => {
                  if (canvases.length <= 1) return;
                  if (!window.confirm(`Delete "${activeCanvas.name}"? Everything placed on it will be deleted too. This cannot be undone.`)) return;
                  // Switch to whichever tab will be next, right away — don't
                  // wait on the delete's own query invalidation to land.
                  const next = canvases.find((c) => c.id !== activeCanvas.id);
                  deleteCanvas.mutate(activeCanvas.id);
                  if (next) setActiveCanvasId(next.id);
                }}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                {canvases.length <= 1 ? "Can't delete the only floor/area" : `Delete "${activeCanvas.name}"`}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Every tool button shown at once, on its own full-width row below
            Back/the plan name — wraps onto as many lines as it needs rather
            than hiding anything behind a Settings/More menu. */}
        <div className="w-full flex flex-wrap items-center gap-1.5 mb-2">
          {activeCanvas.background_image_path && (
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setShowBackgroundReference((v) => !v)}>
              {showBackgroundReference ? <EyeOff className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}
              {showBackgroundReference ? "Hide plan" : "Show plan"}
            </Button>
          )}
          <Button
            variant={highlightSwitchLinks ? "default" : "outline"}
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => setHighlightSwitchLinks((v) => !v)}
            title="Show every switch-to-light run in red, not just the one being edited"
          >
            <Cable className="h-3.5 w-3.5" />
            {highlightSwitchLinks ? "Hide switch links" : "Show switch links"}
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5">
                <Layers className="h-3.5 w-3.5" />
                Layers
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80" align="end">
              <p className="text-xs font-semibold text-foreground mb-2">Layer visibility</p>
              {layerToggleUI}
            </PopoverContent>
          </Popover>
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setShowMaxDemandDialog(true)}>
            <Gauge className="h-3.5 w-3.5" />
            Max demand: {maxDemandTotalAmps.toFixed(1)} A
          </Button>
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setShowLegendPreview(true)}>
            <Zap className="h-3.5 w-3.5" />
            Switchboard legend
          </Button>
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setShowVoiceNotesDialog(true)}>
            <Mic className="h-3.5 w-3.5" />
            Voice notes
          </Button>
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
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5">
                <Ruler className="h-3.5 w-3.5" />
                Job defaults
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64" align="end">
              <p className="text-xs font-semibold text-foreground mb-1">Defaults for this job</p>
              <p className="text-[11px] text-muted-foreground mb-3">
                Starting values only. A fitting takes a copy when it's placed, so changing these never moves anything already set out.
              </p>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ceiling-height-default" className="text-xs">Ceiling height (mm)</Label>
                  <Input
                    id="ceiling-height-default"
                    type="number"
                    inputMode="numeric"
                    min="0"
                    step="10"
                    value={Math.round(planDefaultsDraft.ceilingHeightM * 1000)}
                    onChange={(e) =>
                      setPlanDefaultsDraft((prev) => ({
                        ...prev,
                        ceilingHeightM: Number(e.target.value) ? Number(e.target.value) / 1000 : prev.ceilingHeightM,
                      }))
                    }
                    onBlur={commitPlanDefaults}
                    className="h-9"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Sizes the downlight coverage circles — a downlight sits flush in the ceiling, so this is its mounting height.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="twin-spacing-default" className="text-xs">Twin downlight spacing (mm)</Label>
                  <Input
                    id="twin-spacing-default"
                    type="number"
                    inputMode="numeric"
                    min="0"
                    step="10"
                    value={planDefaultsDraft.twinDownlightSpacingMm}
                    onChange={(e) =>
                      setPlanDefaultsDraft((prev) => ({ ...prev, twinDownlightSpacingMm: Number(e.target.value) || prev.twinDownlightSpacingMm }))
                    }
                    onBlur={commitPlanDefaults}
                    className="h-9"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="led-stock-default" className="text-xs">LED extrusion stock length (m)</Label>
                  <Input
                    id="led-stock-default"
                    type="number"
                    inputMode="decimal"
                    min="0.1"
                    step="0.1"
                    value={planDefaultsDraft.ledExtrusionStockLengthM}
                    onChange={(e) =>
                      setPlanDefaultsDraft((prev) => ({
                        ...prev,
                        ledExtrusionStockLengthM: Number(e.target.value) || prev.ledExtrusionStockLengthM,
                      }))
                    }
                    onBlur={commitPlanDefaults}
                    className="h-9"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    A run is sized to the smallest one that fits. A run bigger than your largest splits across several.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="led-driver-sizes" className="text-xs">LED driver sizes you carry (W)</Label>
                  <Input
                    id="led-driver-sizes"
                    inputMode="numeric"
                    placeholder="30, 60, 100, 150, 200"
                    value={driverSizesDraft}
                    onChange={(e) => setDriverSizesDraft(e.target.value)}
                    onBlur={() => {
                      // Show the tidied list back, so it's obvious what was
                      // actually saved rather than what was typed.
                      const parsed = parseDriverSizes(driverSizesDraft);
                      setDriverSizesDraft((parsed.length > 0 ? parsed : DEFAULT_DRIVER_SIZES_W).join(", "));
                      commitPlanDefaults();
                    }}
                    className="h-9"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="led-driver-headroom" className="text-xs">Driver headroom (%)</Label>
                  <Input
                    id="led-driver-headroom"
                    type="number"
                    inputMode="numeric"
                    min="0"
                    step="5"
                    value={planDefaultsDraft.ledDriverHeadroomPct}
                    onChange={(e) =>
                      setPlanDefaultsDraft((prev) => ({
                        ...prev,
                        ledDriverHeadroomPct: Number(e.target.value) || 0,
                      }))
                    }
                    onBlur={commitPlanDefaults}
                    className="h-9"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    How far above the strip's actual load the driver gets sized.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="led-wpm-default" className="text-xs">LED strip watts per metre</Label>
                  <Input
                    id="led-wpm-default"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="1"
                    value={planDefaultsDraft.ledWattsPerMetre}
                    onChange={(e) =>
                      setPlanDefaultsDraft((prev) => ({ ...prev, ledWattsPerMetre: Number(e.target.value) || prev.ledWattsPerMetre }))
                    }
                    onBlur={commitPlanDefaults}
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
        {activeCanvasNeedsSetup ? (
          // This floor/area has nothing drawn on it yet — trace walls or
          // import a plan for it, the same flow as setting up a brand new
          // job, just inline here instead of navigating away. Re-mounted
          // fresh per canvas (key) so switching tabs never carries over an
          // abandoned sketch from a different floor/area.
          <div className="h-[70vh] md:h-[80vh] rounded-xl border border-border overflow-hidden">
            {activeCanvas.source_type === "import" ? (
              <CalibrationImportFlow
                key={activeCanvas.id}
                canvas={activeCanvas}
                planId={planId!}
                onBack={() => navigate("/setout")}
                onComplete={() => {}}
              />
            ) : (
              <DrawWallsFlow key={activeCanvas.id} canvas={activeCanvas} onBack={() => navigate("/setout")} onComplete={() => {}} />
            )}
          </div>
        ) : (
        <>
        {/* Mode toggle stays mobile-only here; desktop keeps it in the
            sidebar instead. */}
        <div className="md:hidden mb-2">{modeToggleUI}</div>

        {/* Canvas dominates the left column on desktop/iPad, with the
            mode toggle moved into the sidebar there instead of stacked
            above it — frees up real vertical space for a full house plan
            rather than just one room.
            On mobile: full-screen canvas with bottom toolbar and drawer sidebar. */}
        <div className="md:flex md:gap-4 md:items-start">
          <div className="md:flex-1 md:min-w-0">
            <div className="relative h-[58vh] md:h-[78vh] mb-4 md:mb-0 md:mb-0" style={{ marginBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
              <SetoutCanvas
                stripDraft={stripDraft}
                onStripPointAdd={handleStripPointAdd}
                curveMode={stripCurveMode}
                onCurveControlCaptured={() => setStripCurveMode(false)}
                measureDraft={measureDraft}
                onMeasurePointAdd={handleMeasurePointAdd}
                backgroundImage={showBackgroundReference ? (backgroundImage ?? undefined) : undefined}
                backgroundTile={showBackgroundReference ? tile : null}
                onViewSettled={pdfPage ? handleViewSettled : undefined}
                snapToPlan={snapToPlan}
                measurementPreviewFor={lockForFittingAt}
                onPickPlanMeasurementRef={handlePickPlanMeasurementRef}
                onMeasurementDoubleTap={handleMeasurementDoubleTap}
                onMeasurementPickCancel={() => setPickingMeasurementSlot(null)}
                walls={activeCanvas.walls}
                wallThickness={{ exterior: wallThicknessMm.exterior / 1000, interior: wallThicknessMm.interior / 1000 }}
                openings={activeCanvas.openings}
                fittings={canvasFittings}
                mode={pickingMeasurementSlot ? "pick-measurement-ref" : workspaceMode}
                onMeasurementRefPick={handleMeasurementRefPick}
                selectedFittingType={selectedType}
                onPlaceFitting={handlePlaceFitting}
                onFittingDrag={handleFittingDrag}
                selectedFittingId={selectedFittingId}
                onFittingSelect={setSelectedFittingId}
                onFittingRotate={handleRotate}
                layerVisibility={layerVisibility}
                ceilingHeightDefaultM={plan?.plan_defaults?.ceilingHeightM}
                linkActiveSwitchId={activeSwitchId}
                linkActiveGangIndex={activeGangIndex}
                highlightSwitchLinks={highlightSwitchLinks}
                onSwitchTap={handleSelectSwitch}
                onLinkTargetTap={handleLinkTargetTap}
                onSwitchDoubleTap={handleSwitchDoubleTap}
                linkActiveCabinetId={activeCabinetId}
                onCabinetTap={handleSelectCabinet}
                onDataLinkTargetTap={handleDataLinkTargetTap}
                multiSelectIds={multiSelectIds}
                onMultiSelectToggle={handleMultiSelectToggle}
                circuits={circuits}
                photoPoints={canvasPhotoPoints}
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
              <input
                ref={photo360InputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePhoto360FilePicked}
              />

              {/* Replaces the sidebar's tools while it's collapsed — without
                  this there'd be no way to switch modes or place fittings
                  at all once the sidebar's gone. Draggable so it can be
                  parked wherever it isn't covering the part of the plan
                  being worked on right now. Desktop/iPad only, same as the
                  collapse feature itself. */}
              {sidebarCollapsed && (
                <div
                  data-floating-toolbar
                  className={cn(
                    "hidden md:flex md:flex-col absolute z-30 max-h-[calc(100%-1rem)] rounded-xl border border-border bg-card shadow-lg overflow-hidden",
                    // Vertical stays a small draggable box; horizontal runs
                    // the full width of the canvas instead — a "toolbar" in
                    // the usual sense, not a floating panel — so it only
                    // ever moves up/down, never side to side.
                    floatingToolbarVertical ? "w-72" : "left-3 right-3"
                  )}
                  style={
                    floatingToolbarVertical
                      ? floatingToolbarPos
                        ? { left: floatingToolbarPos.x, top: floatingToolbarPos.y }
                        : { top: 12, right: 12 }
                      : { top: floatingToolbarPos?.y ?? 12 }
                  }
                >
                  <div
                    className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border bg-muted/40 cursor-grab active:cursor-grabbing flex-shrink-0 touch-none"
                    onPointerDown={handleFloatingToolbarDragStart}
                    onPointerMove={handleFloatingToolbarDragMove}
                    onPointerUp={handleFloatingToolbarDragEnd}
                  >
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <GripHorizontal className="h-3.5 w-3.5 text-muted-foreground" /> Tools
                    </span>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={toggleFloatingToolbarOrientation}
                        title={floatingToolbarVertical ? "Lay out horizontally" : "Lay out vertically"}
                      >
                        {floatingToolbarVertical ? <Columns3 className="h-3.5 w-3.5" /> : <Rows3 className="h-3.5 w-3.5" />}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={toggleSidebarCollapsed} title="Expand sidebar">
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="p-3 space-y-3 overflow-y-auto">
                    {floatingToolbarVertical ? floatingModeToggleUI : modeToggleUI}
                    {renderActiveToolPanel(!floatingToolbarVertical)}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Desktop sidebar - hidden on mobile. Collapsing it hands its
              width back to the canvas, e.g. mid-job when the tradie just
              wants to see more of the plan. */}
          {sidebarCollapsed ? (
            <div className="hidden md:flex md:flex-col md:w-10 md:flex-shrink-0 items-center pt-1">
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={toggleSidebarCollapsed} title="Expand sidebar">
                <ChevronLeft className="h-4 w-4" />
              </Button>
            </div>
          ) : (
          <div
            className="hidden md:block relative md:flex-shrink-0 space-y-4 pl-3"
            style={{ width: sidebarWidth }}
          >
            <div
              onPointerDown={handleSidebarResizeStart}
              onPointerMove={handleSidebarResizeMove}
              onPointerUp={handleSidebarResizeEnd}
              className={cn(
                "absolute top-0 left-0 h-full w-1.5 cursor-col-resize touch-none hover:bg-primary/30",
                isResizingSidebar && "bg-primary/50"
              )}
              title="Drag to resize"
            />
            <div className="flex items-center justify-between gap-2">
              <div className="flex-1 min-w-0">{modeToggleUI}</div>
              <Button variant="outline" size="icon" className="h-8 w-8 flex-shrink-0" onClick={toggleSidebarCollapsed} title="Collapse sidebar">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            {workspacePanelUI}
          </div>
          )}
        </div>
        </>
        )}
      </div>

      {/* Mobile drawer sidebar - shown below toolbar when mode selected */}
      {mobileDrawerOpen && (
        <div className="fixed inset-0 top-auto bottom-0 md:hidden bg-card border-t border-border rounded-t-lg overflow-y-auto z-40 max-h-[75vh]">
          <div className="p-4 space-y-4">
            {workspaceMode === "place-fittings" ? (
              <FittingPalette
                twinSpacingDefaultMm={plan?.plan_defaults?.twinDownlightSpacingMm}
                ceilingHeightDefaultM={plan?.plan_defaults?.ceilingHeightM}
                selectedType={selectedType}
                onSelectType={setSelectedType}
                onSelectPreset={handleSelectPreset}
                selectedPresetSpecs={selectedPresetSpecs}
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
            ) : workspaceMode === "draw-led-strip" ? (
              stripPanelUI
            ) : workspaceMode === "link-switches" ? (
              <SwitchLinksPanel
                fittings={fittings}
                activeSwitchId={activeSwitchId}
                activeGangIndex={activeGangIndex}
                onSelectSwitch={handleSelectSwitch}
                onSelectGang={setActiveGangIndex}
                onAddGang={handleAddGang}
                onRemoveGang={handleRemoveGang}
                onCycleDimmer={handleCycleDimmer}
              />
            ) : workspaceMode === "link-data-cabinet" ? (
              <DataCabinetLinksPanel fittings={fittings} activeCabinetId={activeCabinetId} onSelectCabinet={handleSelectCabinet} />
            ) : workspaceMode === "place-photo-points" ? (
              <div className="rounded-xl border border-border p-3 space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  Tap anywhere on the plan to drop a pin and take a photo from there.
                </p>
                {uploadingPhotoPoint && (
                  <p className="text-xs font-medium text-primary flex items-center gap-1.5 pt-1">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving photo…
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}

      <CameraCapture
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={handleCameraCapture}
        capturing={uploadingPhotoPoint}
      />

      <PhotoPointDialog
        open={!!activePhotoPointId}
        onOpenChange={(open) => {
          if (!open) {
            setActivePhotoPointId(null);
            setActivePhotoIndex(0);
          }
        }}
        photoUrl={activePhotoUrl}
        photoType={currentPhotoInGallery?.photo_type ?? "flat"}
        loadingPhoto={loadingActivePhoto}
        directionDegrees={currentPhotoInGallery?.direction_degrees ?? null}
        onDirectionChange={handlePhotoPointDirectionChange}
        onDelete={handleDeletePhotoPoint}
        deleting={deletePhotoPoint.isPending}
        photoCount={activeGallery?.photos.length ?? 1}
        currentPhotoIndex={activePhotoIndex}
        onNextPhoto={handleNextPhoto}
        onPrevPhoto={handlePrevPhoto}
      />

      <Dialog open={showMaxDemandDialog} onOpenChange={setShowMaxDemandDialog}>
        {/* overflow-x-hidden is a hard backstop: regardless of what's inside,
            the dialog itself can never be forced wider than the screen —
            worst case a very long label clips at the edge instead of
            blowing the whole box out past the viewport. */}
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto overflow-x-hidden">
          <DialogHeader>
            <DialogTitle>Maximum demand</DialogTitle>
          </DialogHeader>
          {planId && <MaximumDemandPanel planId={planId} />}
        </DialogContent>
      </Dialog>

      <Dialog open={showVoiceNotesDialog} onOpenChange={setShowVoiceNotesDialog}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto overflow-x-hidden">
          <DialogHeader>
            <DialogTitle>Voice notes</DialogTitle>
          </DialogHeader>
          {planId && <VoiceNotesPanel planId={planId} />}
        </DialogContent>
      </Dialog>

      {plan && <SwitchboardLegendPreview open={showLegendPreview} onOpenChange={setShowLegendPreview} plan={plan} />}

      <Dialog open={!!canvasNameDialog} onOpenChange={(open) => { if (!open) setCanvasNameDialog(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{canvasNameDialog?.mode === "add" ? "Add a floor or area" : "Rename floor/area"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="canvas-name">Name</Label>
              <Input
                id="canvas-name"
                placeholder='e.g. "First Floor" or "Outdoor Lighting"'
                value={canvasNameDialog?.name ?? ""}
                onChange={(e) => setCanvasNameDialog((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
                onKeyDown={(e) => { if (e.key === "Enter") handleSaveCanvasName(); }}
                autoFocus
              />
            </div>
            <Button
              className="w-full"
              disabled={!canvasNameDialog?.name.trim() || createCanvas.isPending || renameCanvas.isPending}
              onClick={handleSaveCanvasName}
            >
              {createCanvas.isPending || renameCanvas.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Mobile bottom toolbar */}
      {mobileToolbarUI}

      <DropdownMenu open={!!switchMenu} onOpenChange={(open) => { if (!open) setSwitchMenu(null); }}>
        <DropdownMenuTrigger asChild>
          {/* Invisible 0x0 trigger positioned at the exact double-tap point
              — Radix anchors the menu to this element and keeps it clear of
              the screen edge on its own, same as every other menu in the
              app, just anchored by coordinates instead of a visible button. */}
          <div style={{ position: "fixed", left: switchMenu?.x ?? 0, top: switchMenu?.y ?? 0, width: 1, height: 1 }} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {switchMenuFitting &&
            gangsFor(switchMenuFitting).map((gang, i) => {
              const isDimmer = (switchMenuFitting.specs.dimmerGangs ?? []).includes(i);
              const isPushButton = isDimmer && (switchMenuFitting.specs.pushButtonDimmerGangs ?? []).includes(i);
              return (
                <Fragment key={i}>
                  <DropdownMenuItem onClick={() => handleLinkFromGang(switchMenuFitting, i)}>
                    <Cable className="h-3.5 w-3.5 mr-1.5" />
                    Link switch {i + 1}
                    <span className="ml-1.5 text-muted-foreground">
                      {gang.length === 0 ? "— nothing yet" : `— ${gang.length} light${gang.length === 1 ? "" : "s"}`}
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleCycleDimmer(switchMenuFitting, i)}>
                    <Sun className="h-3.5 w-3.5 mr-1.5" />
                    Switch {i + 1}: {isPushButton ? "Dimmer (push)" : isDimmer ? "Dimmer" : "Plain switch"}
                  </DropdownMenuItem>
                </Fragment>
              );
            })}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              if (switchMenuFitting) handleAddGang(switchMenuFitting);
              setSwitchMenu(null);
            }}
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add switch
          </DropdownMenuItem>
          {switchMenuFitting && gangsFor(switchMenuFitting).length > 1 && (
            <DropdownMenuItem onClick={handleRemoveLastGangFromMenu}>
              <Minus className="h-3.5 w-3.5 mr-1.5" />
              Remove last switch
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={handleDeleteSwitchFromMenu}>
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Delete switch
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu
        open={!!photoPointChoiceMenu}
        onOpenChange={(open) => {
          if (!open) {
            setPhotoPointChoiceMenu(null);
            // Dismissed without picking either option — nothing to do with
            // this spot, so don't leave it around for a later unrelated
            // photo action to pick up.
            pendingPhotoPointPosition.current = null;
          }
        }}
      >
        <DropdownMenuTrigger asChild>
          <div
            style={{ position: "fixed", left: photoPointChoiceMenu?.x ?? 0, top: photoPointChoiceMenu?.y ?? 0, width: 1, height: 1 }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={handleChooseTakePhoto}>
            <Camera className="h-3.5 w-3.5 mr-1.5" />
            Take photo
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleChooseUpload360}>
            <ImageIcon className="h-3.5 w-3.5 mr-1.5" />
            Upload 360° photo
            <span className="ml-1.5 text-muted-foreground">— from your library</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

export default SetoutPlan;
