import { useEffect, useRef, useState } from "react";
import { ArrowLeft, FileImage, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import SetoutCanvas from "./SetoutCanvas";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useUpdateSetoutPlanGeometry, useCreateSetoutFittingsBulk } from "@/hooks/useSetoutPlans";
import { FITTING_LABELS, FITTING_SYMBOLS, type FittingType } from "@/components/setout/symbols";
import { CATEGORY_FOR_TYPE, distance, isSingleWallFitting, type FittingSpecs, type Point, type SetoutFitting, type SetoutPlan, type WallOpening, type WallSegment } from "@/lib/setoutTypes";
import {
  applyWallLengths,
  autoRotationForWallMount,
  computeMeasurementLock,
  defaultHeightForType,
  nextOpeningId,
  nextWallId,
  polygonToWalls,
  snapToNearestWall,
  wallLength,
} from "@/lib/setoutGeometry";

// Standard Australian residential door/window widths — used as the default
// when a door/window is placed, then editable per-opening afterward.
const DEFAULT_DOOR_WIDTH = 0.82;
const DEFAULT_WINDOW_WIDTH = 1.2;

interface RasterSource {
  href: string;
  naturalWidth: number;
  naturalHeight: number;
  mimeType: string;
}

// AI extraction result — normalized 0-1 image coordinates throughout, since
// at extraction time no real-world scale exists yet.
interface NormalizedPoint {
  x: number;
  y: number;
}
// A hand-marked fixture location the tradie added themselves (highlighter/
// pen dot) — colour is a small fixed enum the AI classifies into, since
// asking it to classify the actual fixture TYPE is exactly what proved
// unreliable on real plans. The tradie assigns colour -> fitting type
// themselves in the review step below.
const MARK_COLORS = ["red", "orange", "yellow", "green", "blue", "purple", "pink", "black"] as const;
type MarkColor = (typeof MARK_COLORS)[number];
const MARK_COLOR_SWATCH_CLASS: Record<MarkColor, string> = {
  red: "bg-red-500",
  orange: "bg-orange-500",
  yellow: "bg-yellow-400",
  green: "bg-green-500",
  blue: "bg-blue-500",
  purple: "bg-purple-500",
  pink: "bg-pink-500",
  black: "bg-black",
};

interface AiMark extends NormalizedPoint {
  color: MarkColor;
}
interface AiExtraction {
  corners: NormalizedPoint[];
  suggested_scale: { corner_a_index: number; corner_b_index: number; real_distance_metres: number } | null;
  marks: AiMark[];
}

async function renderPdfFirstPage(file: File): Promise<RasterSource> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create canvas context");
  await page.render({ canvasContext: ctx, viewport }).promise;
  return { href: canvas.toDataURL("image/png"), naturalWidth: canvas.width, naturalHeight: canvas.height, mimeType: "image/png" };
}

function loadImageFile(file: File): Promise<RasterSource> {
  return new Promise((resolve, reject) => {
    const href = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ href, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, mimeType: file.type || "image/jpeg" });
    img.onerror = () => reject(new Error("Could not read that image file"));
    img.src = href;
  });
}

type Step = "select-file" | "loading" | "extracting" | "calibrate" | "trace-walls" | "adjust-lengths" | "review-marks";

interface CalibrationImportFlowProps {
  plan: SetoutPlan;
  onBack: () => void;
  onComplete: () => void;
}

export default function CalibrationImportFlow({ plan, onBack, onComplete }: CalibrationImportFlowProps) {
  const { user } = useAuth();
  const [step, setStep] = useState<Step>("select-file");
  const [raster, setRaster] = useState<RasterSource | null>(null);
  const [calibPoints, setCalibPoints] = useState<Point[]>([]);
  const [realDistance, setRealDistance] = useState("");
  const [pixelsPerMetre, setPixelsPerMetre] = useState<number | null>(null);
  const [sketchPoints, setSketchPoints] = useState<Point[]>([]);
  const [perimeterFinalized, setPerimeterFinalized] = useState(false);
  const [lengths, setLengths] = useState<string[]>([]);
  const [interiorWalls, setInteriorWalls] = useState<WallSegment[]>([]);
  const [wallOpenings, setWallOpenings] = useState<WallOpening[]>([]);
  const [wallTool, setWallTool] = useState<"perimeter" | "interior" | "opening" | "erase">("perimeter");
  const [straightInteriorWalls, setStraightInteriorWalls] = useState(true);
  const [selectedEraseWallId, setSelectedEraseWallId] = useState<string | null>(null);
  const [interiorDraftStart, setInteriorDraftStart] = useState<Point | null>(null);
  const [openingKind, setOpeningKind] = useState<"door" | "window" | "sliding_door">("door");
  const [savedWalls, setSavedWalls] = useState<WallSegment[] | null>(null);
  const [savedOpenings, setSavedOpenings] = useState<WallOpening[]>([]);
  const [uploadedImagePath, setUploadedImagePath] = useState<string | null>(null);
  const [uploadedImageContentType, setUploadedImageContentType] = useState<string | null>(null);
  const [aiCorners, setAiCorners] = useState<NormalizedPoint[] | null>(null);
  const [aiMarks, setAiMarks] = useState<AiMark[]>([]);
  const [colorAssignments, setColorAssignments] = useState<Record<string, FittingType | "skip">>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const saveGeometry = useUpdateSetoutPlanGeometry(plan.id);
  const createFittingsBulk = useCreateSetoutFittingsBulk(plan.id);

  useEffect(() => {
    return () => {
      if (raster?.href.startsWith("blob:")) URL.revokeObjectURL(raster.href);
    };
  }, [raster]);

  // Uploads the raster to the private setout-plan-uploads bucket and asks
  // the extract-setout-plan edge function to read the wall outline, an
  // optional scale suggestion, and any existing electrical symbols off it.
  // Never blocks the flow on failure — the tradie falls back to calibrating
  // and tracing manually exactly as before this feature existed.
  const runAiExtraction = async (source: RasterSource): Promise<AiExtraction | null> => {
    if (!user) return null;
    try {
      const blob = await (await fetch(source.href)).blob();
      const ext = source.mimeType === "image/jpeg" ? "jpg" : "png";
      const path = `${user.id}/${plan.id}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("setout-plan-uploads").upload(path, blob, { contentType: source.mimeType, upsert: true });
      if (upErr) throw upErr;
      // Captured regardless of whether the AI call below succeeds — the
      // upload itself is enough to keep this image around as a permanent
      // reference in the main workspace (see finishTrace).
      setUploadedImagePath(path);
      setUploadedImageContentType(source.mimeType);
      const { data, error } = await supabase.functions.invoke("extract-setout-plan", {
        body: { storage_path: path, content_type: source.mimeType, plan_id: plan.id },
      });
      if (error || data?.error) throw new Error(data?.error || "AI extraction failed");
      return data as AiExtraction;
    } catch (err) {
      console.error("[CalibrationImportFlow] AI extraction failed:", err);
      return null;
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStep("loading");
    try {
      const source = file.type === "application/pdf" ? await renderPdfFirstPage(file) : await loadImageFile(file);
      setRaster(source);
      setStep("extracting");
      const extraction = await runAiExtraction(source);
      if (extraction && extraction.corners.length >= 3) {
        setAiCorners(extraction.corners);
        setAiMarks(extraction.marks || []);
        const scale = extraction.suggested_scale;
        const a = scale ? extraction.corners[scale.corner_a_index] : null;
        const b = scale ? extraction.corners[scale.corner_b_index] : null;
        if (scale && a && b) {
          setCalibPoints([
            { x: a.x * source.naturalWidth, y: a.y * source.naturalHeight },
            { x: b.x * source.naturalWidth, y: b.y * source.naturalHeight },
          ]);
          setRealDistance(String(scale.real_distance_metres));
        }
        toast.success(
          extraction.marks?.length
            ? `AI traced the wall outline and found ${extraction.marks.length} hand-marked fixture${extraction.marks.length === 1 ? "" : "s"} — check the suggestion below.`
            : "AI traced the wall outline — check the suggestion below."
        );
      } else {
        toast.error("Couldn't auto-detect this plan — calibrate and trace it manually instead.");
      }
      setStep("calibrate");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load that file");
      setStep("select-file");
    }
  };

  const handleCalibratePointAdd = (point: Point) => {
    if (calibPoints.length >= 2) return;
    setCalibPoints((prev) => [...prev, point]);
  };

  const distanceMetres = Number(realDistance);
  const canConfirmCalibration = calibPoints.length === 2 && distanceMetres > 0;

  const confirmCalibration = () => {
    if (!canConfirmCalibration || !raster) return;
    const pixelDist = distance(calibPoints[0], calibPoints[1]);
    const ppm = pixelDist / distanceMetres;
    setPixelsPerMetre(ppm);
    // Seed the perimeter trace from the AI's corners the first time through
    // — if the tradie goes Back and forward again, don't clobber edits
    // they've already made to the traced shape. Interior walls/doors/
    // windows are never AI-seeded (see extract-setout-plan's header
    // comment) — always added manually with the tools on the next step.
    if (aiCorners && aiCorners.length >= 3 && sketchPoints.length === 0) {
      const toMetres = (p: NormalizedPoint) => ({ x: (p.x * raster.naturalWidth) / ppm, y: (p.y * raster.naturalHeight) / ppm });
      setSketchPoints(aiCorners.map(toMetres));
    }
    setStep("trace-walls");
  };

  // Perimeter tracing (rough taps) never saves directly — it hands off to
  // the adjust-lengths step, which replaces the tapped lengths with the
  // tradie's real printed/measured dimensions before anything is saved.
  const proceedToLengthAdjustment = () => {
    if (sketchPoints.length < 3) return;
    const walls = polygonToWalls(sketchPoints);
    setLengths(walls.map((w) => wallLength(w).toFixed(2)));
    setStep("adjust-lengths");
  };

  // Accepts the points explicitly rather than always reading sketchPoints
  // off the closure, since the adjust-lengths confirm handler needs to save
  // the newly-corrected points immediately rather than waiting on a state
  // update to land first.
  const finishTrace = async (finalPoints: Point[] = sketchPoints) => {
    if (finalPoints.length < 3 || !pixelsPerMetre) return;
    const walls = [...polygonToWalls(finalPoints), ...interiorWalls];
    try {
      await saveGeometry.mutateAsync({
        walls,
        scale_calibration: { pointA: calibPoints[0], pointB: calibPoints[1], realDistanceMetres: distanceMetres },
        openings: wallOpenings,
        ...(uploadedImagePath ? { background_image_path: uploadedImagePath, background_image_content_type: uploadedImageContentType ?? "image/png" } : {}),
      });
      if (aiMarks.length > 0) {
        setSavedWalls(walls);
        setSavedOpenings(wallOpenings);
        setStep("review-marks");
      } else {
        toast.success("Walls saved");
        onComplete();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the plan");
    }
  };

  if (step === "select-file") {
    return (
      <div className="px-5 py-6 max-w-md mx-auto">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <h2 className="font-sans text-lg font-extrabold text-foreground mb-1">Upload the builder's plan</h2>
        <p className="text-xs text-muted-foreground mb-5">
          PDF or photo of the plan. AI will trace the outer wall outline automatically — internal walls, doors and windows are added
          manually on the next step. If you want AI to also pick up fixture locations, mark them on the plan first with a highlighter or
          pen — use a different colour per fixture type (any colours you like), and you'll tell the app what each colour means after
          upload.
        </p>
        <input ref={fileRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={handleFileSelect} />
        <Card
          className="border-dashed border-2 p-10 flex flex-col items-center justify-center cursor-pointer hover:border-primary/50 transition-colors"
          onClick={() => fileRef.current?.click()}
        >
          <FileImage className="h-10 w-10 text-muted-foreground/40 mb-3" />
          <p className="text-sm font-semibold text-foreground mb-1">Tap to select a file</p>
          <p className="text-xs text-muted-foreground">PDF or image</p>
        </Card>
      </div>
    );
  }

  if (step === "loading") {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Reading file…</p>
      </div>
    );
  }

  if (step === "extracting") {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">AI is reading the plan…</p>
      </div>
    );
  }

  if (step === "calibrate" && raster) {
    return (
      <div className="flex flex-col h-full overflow-y-auto px-5 py-6 max-w-6xl mx-auto w-full">
        <button onClick={() => setStep("select-file")} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <h2 className="font-sans text-lg font-extrabold text-foreground mb-1">Calibrate scale</h2>
        <p className="text-xs text-muted-foreground mb-4">
          {calibPoints.length === 2
            ? "AI suggested these two points from a dimension it read on the plan — check them (and the distance below) or clear and pick your own."
            : "Zoom in and tap two points on the plan that you know the real distance between — a wall length, a door width, a dimension already marked."}{" "}
          Use the pan tool (bottom right) to move around once zoomed in.
        </p>
        <div className="flex-1 min-h-[480px] mb-4">
          <SetoutCanvas
            backgroundImage={{ href: raster.href, width: raster.naturalWidth, height: raster.naturalHeight }}
            walls={[]}
            mode="calibrate"
            calibratePoints={calibPoints}
            onCalibratePointAdd={handleCalibratePointAdd}
          />
        </div>
        {calibPoints.length > 0 && (
          <Button variant="outline" size="sm" className="mb-4 self-start" onClick={() => setCalibPoints([])}>
            Clear points
          </Button>
        )}
        <div className="space-y-2 mb-6">
          <Label htmlFor="real-distance">Real distance between those points (metres)</Label>
          <Input
            id="real-distance"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={realDistance}
            onChange={(e) => setRealDistance(e.target.value)}
            placeholder="e.g. 3.6"
          />
        </div>
        <Button className="w-full h-12 font-bold rounded-xl" disabled={!canConfirmCalibration} onClick={confirmCalibration}>
          Continue to wall tracing
        </Button>
      </div>
    );
  }

  if (step === "trace-walls" && raster && pixelsPerMetre) {
    const backgroundImage = {
      href: raster.href,
      width: raster.naturalWidth / pixelsPerMetre,
      height: raster.naturalHeight / pixelsPerMetre,
    };
    const perimeterWalls = sketchPoints.length >= 3 ? polygonToWalls(sketchPoints) : [];
    const previewWalls = [...perimeterWalls, ...interiorWalls];
    const canvasMode =
      wallTool === "perimeter"
        ? "sketch-walls"
        : wallTool === "interior"
          ? "sketch-interior-wall"
          : wallTool === "erase"
            ? "erase-wall"
            : "place-opening";

    const handleOpeningPlace = (wallId: string, offset: number) => {
      const wall = previewWalls.find((w) => w.id === wallId);
      if (!wall) return;
      const width = openingKind === "window" ? DEFAULT_WINDOW_WIDTH : DEFAULT_DOOR_WIDTH;
      const len = wallLength(wall);
      const clampedOffset = Math.max(0, Math.min(Math.max(len - width, 0), offset - width / 2));
      setWallOpenings((prev) => [...prev, { id: nextOpeningId(), wallId, offset: clampedOffset, width, kind: openingKind }]);
    };

    // Deleting a wall orphans any door/window cut into it — drop those too
    // rather than leaving a dangling opening with no wall to render against.
    const handleConfirmDeleteWall = () => {
      if (!selectedEraseWallId) return;
      const wallId = selectedEraseWallId;
      setInteriorWalls((prev) => prev.filter((w) => w.id !== wallId));
      setWallOpenings((prev) => prev.filter((o) => o.wallId !== wallId));
      setSelectedEraseWallId(null);
    };

    return (
      <div className="flex flex-col h-full overflow-y-auto px-5 py-6 max-w-6xl mx-auto w-full">
        <button onClick={() => setStep("calibrate")} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <h2 className="font-sans text-lg font-extrabold text-foreground mb-1">
          {perimeterFinalized ? "Add interior walls, doors & windows" : "Trace the outer walls"}
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          {wallTool === "perimeter"
            ? aiCorners
              ? "AI has traced a starting shape from the plan — drag/add/remove corners to fix anything it got wrong, then close the shape. You'll enter the real wall lengths next."
              : "Tap each corner of the room in order. Tap the first corner again (or the button below) to close the shape — you'll enter the real wall lengths next."
            : wallTool === "interior"
              ? `Tap point to point along the internal wall run — tap (or click) the same spot twice to finish it.${straightInteriorWalls ? " Each segment squares up to horizontal/vertical automatically." : ""}`
              : wallTool === "erase"
                ? "Tap an interior wall to select it, then confirm below to delete it. The outer perimeter can't be erased this way — re-import the plan to fix that."
                : `Tap a point on a wall to drop a ${openingKind} there — drag an existing one to reposition it, default width is editable below.`}
        </p>

        {perimeterFinalized && (
          <div className="flex gap-1.5 mb-3">
            <Button
              size="sm"
              variant={wallTool === "interior" ? "default" : "outline"}
              onClick={() => {
                setWallTool("interior");
                setSelectedEraseWallId(null);
              }}
            >
              Add interior wall
            </Button>
            <Button
              size="sm"
              variant={wallTool === "opening" ? "default" : "outline"}
              onClick={() => {
                setWallTool("opening");
                setSelectedEraseWallId(null);
              }}
            >
              Add door/window
            </Button>
            <Button size="sm" variant={wallTool === "erase" ? "default" : "outline"} onClick={() => setWallTool("erase")}>
              Delete wall
            </Button>
          </div>
        )}

        {wallTool === "interior" && (
          <div className="flex items-center gap-2 mb-3">
            <Switch id="straight-interior-walls" checked={straightInteriorWalls} onCheckedChange={setStraightInteriorWalls} />
            <Label htmlFor="straight-interior-walls" className="text-xs font-normal text-muted-foreground">
              Keep walls straight (90°) — turn off to draw an angled wall
            </Label>
          </div>
        )}

        {wallTool === "opening" && (
          <div className="flex gap-1.5 mb-3">
            <Button size="sm" variant={openingKind === "door" ? "default" : "outline"} onClick={() => setOpeningKind("door")}>
              Door
            </Button>
            <Button size="sm" variant={openingKind === "window" ? "default" : "outline"} onClick={() => setOpeningKind("window")}>
              Window
            </Button>
            <Button size="sm" variant={openingKind === "sliding_door" ? "default" : "outline"} onClick={() => setOpeningKind("sliding_door")}>
              Sliding
            </Button>
          </div>
        )}

        <div className="flex-1 min-h-[480px] mb-4">
          <SetoutCanvas
            backgroundImage={backgroundImage}
            walls={previewWalls}
            wallThickness={plan.wall_thickness}
            openings={wallOpenings}
            mode={canvasMode}
            sketchPoints={sketchPoints}
            onSketchPointAdd={(p) => setSketchPoints((prev) => [...prev, p])}
            onSketchClose={proceedToLengthAdjustment}
            snapWalls={wallTool === "perimeter"}
            interiorWallDraftStart={interiorDraftStart}
            onInteriorWallDraftPointAdd={setInteriorDraftStart}
            snapInteriorWalls={straightInteriorWalls}
            onInteriorWallSegmentAdd={(start, end) => {
              setInteriorWalls((prev) => [...prev, { id: nextWallId(), start, end, kind: "interior" }]);
              // Continue the chain from this segment's end rather than
              // resetting — the next tap starts a new segment from here,
              // finishing only once the tradie double-taps/double-clicks.
              setInteriorDraftStart(end);
            }}
            onInteriorWallChainEnd={() => setInteriorDraftStart(null)}
            onOpeningPlace={handleOpeningPlace}
            onOpeningDrag={(openingId, offset) =>
              setWallOpenings((prev) => prev.map((o) => (o.id === openingId ? { ...o, offset } : o)))
            }
            onWallTap={(wallId) => setSelectedEraseWallId((prev) => (prev === wallId ? null : wallId))}
            selectedEraseWallId={selectedEraseWallId}
          />
        </div>

        {wallTool === "erase" && (
          <Button
            variant="destructive"
            className="w-full mb-4"
            disabled={!selectedEraseWallId}
            onClick={handleConfirmDeleteWall}
          >
            {selectedEraseWallId ? "Delete selected wall" : "Tap a wall to select it"}
          </Button>
        )}

        {wallTool === "interior" && interiorWalls.length > 0 && (
          <div className="space-y-1.5 mb-4 max-h-32 overflow-y-auto">
            {interiorWalls.map((w, i) => (
              <div key={w.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-1.5 text-xs">
                <span className="font-medium text-foreground">Interior wall {i + 1}</span>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => setInteriorWalls((prev) => prev.filter((iw) => iw.id !== w.id))}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        {wallTool === "opening" && wallOpenings.length > 0 && (
          <div className="space-y-1.5 mb-4 max-h-32 overflow-y-auto">
            {wallOpenings.map((o) => (
              <div key={o.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs">
                <span className="font-medium text-foreground capitalize flex-1">{o.kind}</span>
                <Input
                  type="number"
                  inputMode="decimal"
                  min="0.1"
                  step="0.05"
                  value={o.width}
                  onChange={(e) => {
                    const width = Number(e.target.value) || o.width;
                    setWallOpenings((prev) => prev.map((p) => (p.id === o.id ? { ...p, width } : p)));
                  }}
                  className="h-7 w-20 text-xs"
                />
                <span className="text-muted-foreground">m</span>
                {o.kind === "door" && (
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      setWallOpenings((prev) => prev.map((p) => (p.id === o.id ? { ...p, swingFlipped: !p.swingFlipped } : p)))
                    }
                  >
                    Flip swing
                  </button>
                )}
                <button
                  type="button"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => setWallOpenings((prev) => prev.filter((p) => p.id !== o.id))}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          {wallTool === "perimeter" ? (
            <>
              <Button variant="outline" className="flex-1" disabled={sketchPoints.length === 0} onClick={() => setSketchPoints((prev) => prev.slice(0, -1))}>
                Undo point
              </Button>
              <Button className="flex-1 font-bold" disabled={sketchPoints.length < 3} onClick={proceedToLengthAdjustment}>
                Close shape
              </Button>
            </>
          ) : wallTool === "interior" ? (
            <>
              <Button
                variant="outline"
                className="flex-1"
                disabled={interiorWalls.length === 0 && !interiorDraftStart}
                onClick={() => {
                  if (interiorWalls.length > 0) {
                    const last = interiorWalls[interiorWalls.length - 1];
                    setInteriorWalls((prev) => prev.slice(0, -1));
                    setInteriorDraftStart(last.start);
                  } else {
                    setInteriorDraftStart(null);
                  }
                }}
              >
                Undo wall
              </Button>
              <Button className="flex-1 font-bold" disabled={saveGeometry.isPending} onClick={() => finishTrace()}>
                {saveGeometry.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save walls"}
              </Button>
            </>
          ) : (
            <Button className="flex-1 font-bold" disabled={saveGeometry.isPending} onClick={() => finishTrace()}>
              {saveGeometry.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save walls"}
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (step === "adjust-lengths" && raster && pixelsPerMetre) {
    const backgroundImage = {
      href: raster.href,
      width: raster.naturalWidth / pixelsPerMetre,
      height: raster.naturalHeight / pixelsPerMetre,
    };
    const parsedLengths = lengths.map((l) => Number(l) || 0);
    const previewPoints = parsedLengths.some((l) => l <= 0) ? sketchPoints : applyWallLengths(sketchPoints, parsedLengths);
    const previewWalls = polygonToWalls(previewPoints);
    const allLengthsValid = lengths.length > 0 && lengths.every((l) => Number(l) > 0);

    const confirmLengths = () => {
      if (!allLengthsValid) return;
      const finalPoints = applyWallLengths(sketchPoints, lengths.map(Number));
      setSketchPoints(finalPoints);
      setPerimeterFinalized(true);
      setWallTool("interior");
      setStep("trace-walls");
    };

    return (
      <div className="flex flex-col h-full overflow-y-auto px-5 py-6 max-w-6xl mx-auto w-full">
        <button
          onClick={() => setStep("trace-walls")}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="h-4 w-4" /> Back to tracing
        </button>
        <h2 className="font-sans text-lg font-extrabold text-foreground mb-1">Enter the real wall lengths</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Read each wall's length straight off the plan (or measure it on site) and type it in metres — this is what makes the shape
          exact, not the tapping. The preview redraws true to scale as you type.
        </p>

        <div className="flex-1 min-h-[420px] mb-4">
          <SetoutCanvas backgroundImage={backgroundImage} walls={previewWalls} wallThickness={plan.wall_thickness} mode="view" />
        </div>

        <div className="grid grid-cols-2 gap-3 mb-6 max-h-48 overflow-y-auto">
          {lengths.map((len, i) => (
            <div key={i} className="space-y-1">
              <Label htmlFor={`wall-${i}`} className="text-xs">Wall {i + 1}</Label>
              <Input
                id={`wall-${i}`}
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={len}
                onChange={(e) => setLengths((prev) => prev.map((v, idx) => (idx === i ? e.target.value : v)))}
              />
            </div>
          ))}
        </div>

        <Button className="w-full h-12 font-bold rounded-xl" disabled={!allLengthsValid} onClick={confirmLengths}>
          Confirm lengths
        </Button>
      </div>
    );
  }

  if (step === "review-marks" && raster && pixelsPerMetre && savedWalls) {
    const marksByColor = new Map<MarkColor, AiMark[]>();
    for (const m of aiMarks) {
      if (!marksByColor.has(m.color)) marksByColor.set(m.color, []);
      marksByColor.get(m.color)!.push(m);
    }
    const colors = Array.from(marksByColor.keys());

    const rawPositionFor = (m: AiMark): Point => ({
      x: (m.x * raster.naturalWidth) / pixelsPerMetre,
      y: (m.y * raster.naturalHeight) / pixelsPerMetre,
    });

    // Every colour with a fitting type assigned (not left unset, not
    // explicitly skipped) becomes that many fittings at their marked
    // positions — wall-mounted types still snap onto the actual wall line
    // (and clear of any door/window on it), same treatment a manually
    // placed fitting gets.
    const assignedFittings: { type: FittingType; position: Point }[] = [];
    for (const color of colors) {
      const assignment = colorAssignments[color];
      if (!assignment || assignment === "skip") continue;
      for (const m of marksByColor.get(color)!) {
        const raw = rawPositionFor(m);
        const position = isSingleWallFitting(assignment) ? snapToNearestWall(raw, savedWalls, savedOpenings) : raw;
        assignedFittings.push({ type: assignment, position });
      }
    }

    const previewFittings: SetoutFitting[] = assignedFittings.map((f, i) => ({
      id: String(i),
      plan_id: plan.id,
      type: f.type,
      position: f.position,
      category: CATEGORY_FOR_TYPE[f.type],
      specs: {},
      measurement_lock: null,
      status: "placed",
      circuit_id: null,
      linked_to: [],
      created_at: "",
      updated_at: "",
    }));

    const handleAddFittings = async () => {
      const walls = savedWalls;
      const inputs = assignedFittings.map(({ type, position }) => {
        const defaultHeight = defaultHeightForType(type);
        const specs: FittingSpecs = {};
        if (defaultHeight != null) specs.mountingHeight = defaultHeight;
        if (isSingleWallFitting(type)) specs.rotation = autoRotationForWallMount(position, walls);
        return {
          type,
          position,
          measurement_lock: computeMeasurementLock(position, walls, type),
          specs: Object.keys(specs).length > 0 ? specs : undefined,
        };
      });
      try {
        await createFittingsBulk.mutateAsync(inputs);
        toast.success(`Added ${inputs.length} fitting${inputs.length === 1 ? "" : "s"} from the plan`);
        onComplete();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not add the fittings");
      }
    };

    return (
      <div className="flex flex-col h-full overflow-y-auto px-5 py-6 max-w-6xl mx-auto w-full">
        <h2 className="font-sans text-lg font-extrabold text-foreground mb-1">What does each colour mean?</h2>
        <p className="text-xs text-muted-foreground mb-4">
          AI found {aiMarks.length} hand-marked location{aiMarks.length === 1 ? "" : "s"} across {colors.length} colour
          {colors.length === 1 ? "" : "s"}. Tell it what each colour represents — skip a colour if it wasn't for a fixture.
        </p>

        <div className="space-y-2 mb-4">
          {colors.map((color) => {
            const count = marksByColor.get(color)!.length;
            return (
              <div key={color} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
                <span className={cn("h-4 w-4 rounded-full flex-shrink-0", MARK_COLOR_SWATCH_CLASS[color])} />
                <span className="text-xs font-medium text-foreground capitalize w-14 flex-shrink-0">{color}</span>
                <span className="text-xs text-muted-foreground w-16 flex-shrink-0">
                  {count} mark{count === 1 ? "" : "s"}
                </span>
                <Select
                  value={colorAssignments[color] ?? undefined}
                  onValueChange={(v) => setColorAssignments((prev) => ({ ...prev, [color]: v as FittingType | "skip" }))}
                >
                  <SelectTrigger className="h-8 flex-1 text-xs">
                    <SelectValue placeholder="What is this?" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="skip">Skip this colour</SelectItem>
                    {(Object.keys(FITTING_SYMBOLS) as FittingType[]).map((type) => (
                      <SelectItem key={type} value={type}>
                        {FITTING_LABELS[type]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          })}
        </div>

        <div className="flex-1 min-h-[400px] mb-4">
          <SetoutCanvas
            backgroundImage={{ href: raster.href, width: raster.naturalWidth / pixelsPerMetre, height: raster.naturalHeight / pixelsPerMetre }}
            walls={savedWalls}
            wallThickness={plan.wall_thickness}
            openings={savedOpenings}
            fittings={previewFittings}
            mode="view"
          />
        </div>

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onComplete}>
            Skip — place manually
          </Button>
          <Button className="flex-1 font-bold" disabled={assignedFittings.length === 0 || createFittingsBulk.isPending} onClick={handleAddFittings}>
            {createFittingsBulk.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              `Add ${assignedFittings.length} fitting${assignedFittings.length === 1 ? "" : "s"}`
            )}
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
