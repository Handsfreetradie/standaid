import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, FileImage, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import SetoutCanvas, { type BackgroundTile } from "./SetoutCanvas";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useUpdateSetoutPlanGeometry } from "@/hooks/useSetoutPlans";
import { distance, type Point, type SetoutPlan, type WallOpening, type WallSegment } from "@/lib/setoutTypes";
import { applyWallLengths, nextOpeningId, nextWallId, polygonToWalls, wallLength } from "@/lib/setoutGeometry";
import { detectPlanEdges, type PlanEdges } from "@/lib/edgeDetection";
import { extractPlanLines, PlanVectorIndex, type PdfPageForVector } from "@/lib/planVector";

// Standard Australian residential door/window widths — used as the default
// when a door/window is placed, then editable per-opening afterward.
const DEFAULT_DOOR_WIDTH = 0.82;
const DEFAULT_WINDOW_WIDTH = 1.2;

interface RasterSource {
  href: string;
  naturalWidth: number;
  naturalHeight: number;
  mimeType: string;
  // Kept alive for PDFs so the plan can be rasterised again at whatever zoom
  // the tradie is on. A photo has no such source — it's stuck at the
  // resolution it was taken.
  pdfPage?: PdfPage;
}

// Scale the plan is first rasterised at. Everything that converts between
// scene metres and PDF points goes through this, so it must not drift.
const BASE_PDF_SCALE = 2;
// A re-render never exceeds this on either side, so a deep zoom on a big
// screen can't allocate a canvas a phone won't survive.
// Only binds on large desktop viewports; a phone never gets near it. Sized so
// a typical screen renders at full device resolution rather than being capped
// back into softness.
const MAX_TILE_PX = 4096;
// Rasterise this much more than is actually on screen, so a nudge of the plan
// doesn't immediately expose the soft base image at the edges. Every pixel
// spent on margin is a pixel not spent on what's actually visible, and the
// view re-renders once panning stops anyway — so this stays modest, and the
// on-screen area keeps full device resolution.
const TILE_MARGIN = 1.35;

// The slice of pdf.js's page API used here, named so this file doesn't depend
// on pdfjs-dist's types at module load (it's imported lazily below).
interface PdfPage extends PdfPageForVector {
  getViewport(options: { scale: number }): { width: number; height: number } & { convertToViewportPoint(x: number, y: number): number[] };
  render(options: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
    transform?: number[];
  }): { promise: Promise<void>; cancel(): void };
}

/**
 * Rasterises just the part of the plan currently on screen, at the screen's
 * own pixel density.
 *
 * This is what makes a deep zoom sharp. The base image is rendered once at a
 * fixed scale, so magnifying it past that is magnifying pixels — at 600% the
 * linework turns to mush. A PDF is vector, so instead of stretching pixels we
 * ask it for the visible rectangle again at the resolution actually needed.
 *
 * @param view  the on-screen region, in scene metres
 * @returns the tile plus the region it ACTUALLY covers — rounding the canvas
 *          to whole pixels means that isn't exactly what was asked for, and
 *          placing it as if it were would stretch it very slightly.
 */
async function renderPdfTile(
  page: PdfPage,
  view: { x: number; y: number; w: number; h: number; screenWidth: number },
  plan: { w: number; h: number },
  pixelsPerMetre: number
): Promise<{ href: string; revoke: () => void; x: number; y: number; coveredW: number; coveredH: number } | null> {
  // Scene metres -> PDF points. Base image pixels are scene * ppm, and those
  // were themselves rendered at BASE_PDF_SCALE points-to-pixels.
  const toPdfPoints = pixelsPerMetre / BASE_PDF_SCALE;
  if (view.w <= 0 || view.h <= 0) return null;

  const dprEarly = window.devicePixelRatio || 1;
  // Pixels per scene unit the screen is actually asking for right now. Render
  // at this and the result is exactly as sharp as the display can show.
  const wantedDensity = (view.screenWidth * dprEarly) / view.w;

  // Prefer to rasterise the ENTIRE plan: then there's no tile boundary at all,
  // panning never exposes anything soft, and one render serves every position
  // at this zoom. Only when the whole plan won't fit the pixel budget — a deep
  // zoom on a big drawing — fall back to the part that's on screen plus a
  // margin.
  const wholePlanPx = plan.w * wantedDensity;
  const wholePlanFits =
    wholePlanPx <= MAX_TILE_PX && plan.h * wantedDensity <= MAX_TILE_PX;
  const region = wholePlanFits
    ? { x: 0, y: 0, w: plan.w, h: plan.h }
    : {
        x: view.x - (view.w * (TILE_MARGIN - 1)) / 2,
        y: view.y - (view.h * (TILE_MARGIN - 1)) / 2,
        w: view.w * TILE_MARGIN,
        h: view.h * TILE_MARGIN,
      };
  const viewPts = region.w * toPdfPoints;
  if (viewPts <= 0) return null;

  const aspect = region.h / region.w;
  // Both sides have to come down together — clamping only the taller one would
  // render less of the plan than the tile then claims to cover, squashing it.
  // Enough pixels to hold `wantedDensity` across whatever region was chosen,
  // so widening the area never costs sharpness — only the cap can.
  let targetPx = Math.min(Math.round(region.w * wantedDensity), MAX_TILE_PX);
  if (targetPx * aspect > MAX_TILE_PX) targetPx = Math.floor(MAX_TILE_PX / aspect);

  const width = targetPx;
  const height = Math.round(targetPx * aspect);
  if (width < 1 || height < 1) return null;

  const scale = width / viewPts;
  if (!Number.isFinite(scale) || scale <= 0) return null;
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  // The page is drawn full size and shifted so the requested region lands at
  // the canvas origin — pdf.js has no crop, but it does take a transform.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  await page.render({
    canvasContext: ctx,
    viewport,
    transform: [1, 0, 0, 1, -region.x * toPdfPoints * scale, -region.y * toPdfPoints * scale],
  }).promise;

  // WebP encodes far faster than PNG at this size. Quality is high enough to
  // be indistinguishable on linework, and browsers without WebP encoding hand
  // back a PNG instead, which still works.
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.95));
  if (!blob) return null;
  const href = URL.createObjectURL(blob);
  // Decode before handing it over. Swapping in an undecoded image makes the
  // plan visibly blink and jump as the browser catches up mid-frame.
  try {
    const img = new Image();
    img.src = href;
    await img.decode();
  } catch {
    // Older browsers without decode() just paint a frame later.
  }
  return {
    href,
    revoke: () => URL.revokeObjectURL(href),
    // Where the tile actually landed, which is the grown region and — because
    // the canvas is a whole number of pixels — not quite its requested size.
    x: region.x,
    y: region.y,
    coveredW: width / scale / toPdfPoints,
    coveredH: height / scale / toPdfPoints,
  };
}

async function renderPdfFirstPage(file: File): Promise<RasterSource> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: BASE_PDF_SCALE });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create canvas context");
  await page.render({ canvasContext: ctx, viewport }).promise;
  return {
    href: canvas.toDataURL("image/png"),
    naturalWidth: canvas.width,
    naturalHeight: canvas.height,
    mimeType: "image/png",
    // Held for re-rendering at zoom; a plain image upload has no equivalent.
    pdfPage: page as unknown as PdfPage,
  };
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

type Step = "select-file" | "loading" | "calibrate" | "trace-walls" | "adjust-lengths";

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
  const [uploadedImagePath, setUploadedImagePath] = useState<string | null>(null);
  const [uploadedImageContentType, setUploadedImageContentType] = useState<string | null>(null);
  // Exact line geometry read straight out of the PDF. Preferred over the pixel
  // detector whenever the plan actually is vector, because it needs no
  // estimating at all — see planVector.ts.
  const [vectorIndex, setVectorIndex] = useState<PlanVectorIndex | null>(null);
  const [planEdges, setPlanEdges] = useState<PlanEdges | null>(null);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [detectingEdges, setDetectingEdges] = useState(false);
  // The sharp re-render of whatever's on screen. Null until the first one
  // lands, and while a photo (rather than a PDF) is the source.
  const [tile, setTile] = useState<BackgroundTile | null>(null);
  // Set when the tradie skips calibration. The plan still opens and things can
  // still be placed on it — there is just no real-world scale, so nothing may
  // report a distance. Kept separate from pixelsPerMetre, which is forced to 1
  // (scene units become image pixels) purely so the canvas has a mapping.
  const [scaleSkipped, setScaleSkipped] = useState(false);
  const tileCleanupRef = useRef<(() => void) | null>(null);
  // Bumped per request so a slow render that finishes after the tradie has
  // moved on gets dropped instead of painting a stale region.
  const tileRequestRef = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const saveGeometry = useUpdateSetoutPlanGeometry(plan.id);

  useEffect(() => {
    return () => {
      if (raster?.href.startsWith("blob:")) URL.revokeObjectURL(raster.href);
    };
  }, [raster]);

  // Release the last tile's blob when this screen goes away.
  useEffect(() => () => tileCleanupRef.current?.(), []);

  // Re-rasterise the visible region of the PDF at screen resolution whenever
  // the view settles. `scenePixelsPerMetre` is what converts the canvas's
  // scene units to the base image's pixels — during calibration the canvas
  // works directly in image pixels, so it's 1 there.
  // Must be referentially stable: the canvas holds this in an effect's
  // dependencies, so a fresh function each render would restart its settle
  // timer forever and the tile would never land.
  const renderTileForView = useCallback(
    async (view: { x: number; y: number; w: number; h: number; screenWidth: number }, scenePixelsPerMetre: number) => {
      const page = raster?.pdfPage;
      if (!page || !raster) return;
      const token = ++tileRequestRef.current;
      try {
        // The plan's full extent in the same scene units the canvas uses.
        const plan = {
          w: raster.naturalWidth / scenePixelsPerMetre,
          h: raster.naturalHeight / scenePixelsPerMetre,
        };
        const next = await renderPdfTile(page, view, plan, scenePixelsPerMetre);
        if (!next) return;
        if (token !== tileRequestRef.current) {
          // The view moved on while this was rendering — bin it.
          next.revoke();
          return;
        }
        tileCleanupRef.current?.();
        tileCleanupRef.current = next.revoke;
        setTile({ href: next.href, x: next.x, y: next.y, width: next.coveredW, height: next.coveredH });
      } catch {
        // A cancelled or failed render just leaves the base image showing.
      }
    },
    [raster]
  );

  // During calibration the canvas works directly in image pixels, so the
  // scene-to-image scale is 1; once calibrated it works in metres.
  const handleCalibrateViewSettled = useCallback(
    (view: { x: number; y: number; w: number; h: number; screenWidth: number }) => renderTileForView(view, 1),
    [renderTileForView]
  );
  const handleTraceViewSettled = useCallback(
    (view: { x: number; y: number; w: number; h: number; screenWidth: number }) =>
      pixelsPerMetre ? renderTileForView(view, pixelsPerMetre) : undefined,
    [renderTileForView, pixelsPerMetre]
  );

  // Works out what the tap should snap to. A vector PDF carries its own exact
  // geometry, so that is read directly; only when the plan turns out to be a
  // scan or a photograph does this fall back to detecting lines in pixels,
  // which is an estimate and costs both time and memory.
  //
  // Rebuilt when the scale changes, since both forms answer in scene units.
  const builtFor = useRef<string | null>(null);
  useEffect(() => {
    if (!raster || !pixelsPerMetre || !snapEnabled) return;
    const key = `${raster.href}@${pixelsPerMetre}`;
    if (builtFor.current === key) return;
    builtFor.current = key;

    let cancelled = false;
    setDetectingEdges(true);

    (async () => {
      // A page with real drawn geometry has thousands of lines; a scan wrapped
      // in a PDF has a handful or none, and is better served by the detector.
      const MIN_VECTOR_LINES = 20;
      if (raster.pdfPage) {
        try {
          const lines = await extractPlanLines(raster.pdfPage, pixelsPerMetre, BASE_PDF_SCALE);
          if (cancelled) return;
          if (lines.length >= MIN_VECTOR_LINES) {
            setVectorIndex(new PlanVectorIndex(lines));
            setPlanEdges(null);
            return;
          }
        } catch (err) {
          // Falls through to the pixel detector below.
          console.error("[CalibrationImportFlow] Vector read failed:", err);
        }
      }

      try {
        const edges = await detectPlanEdges(raster.href, pixelsPerMetre);
        if (cancelled) return;
        setVectorIndex(null);
        setPlanEdges(edges);
        if (edges.count === 0) toast.info("No clear lines found on this plan — tracing won't snap.");
      } catch (err) {
        console.error("[CalibrationImportFlow] Edge detection failed:", err);
        if (!cancelled) {
          builtFor.current = null;
          setPlanEdges(null);
          toast.error("Couldn't read the lines on this plan — trace it by hand.");
        }
      }
    })().finally(() => {
      if (!cancelled) setDetectingEdges(false);
    });

    return () => {
      cancelled = true;
    };
  }, [raster, pixelsPerMetre, snapEnabled]);

  // Tracing follows the middle of a drawn line. Placing fittings will measure
  // off the faces instead, which is why the vector index exposes both.
  const snapToPlan = useCallback(
    (point: Point, tolerance: number): Point | null => {
      if (!snapEnabled) return null;
      if (vectorIndex) return vectorIndex.nearestCentre(point.x, point.y, tolerance)?.point ?? null;
      return planEdges?.index.nearestWallCentre(point.x, point.y, tolerance) ?? null;
    },
    [snapEnabled, vectorIndex, planEdges]
  );

  // Keeps the plan image as the permanent background reference for the
  // workspace. Nothing is read off it automatically — the tradie calibrates
  // and traces by hand, with the detected lines only offered as a snap guide.
  const uploadPlanImage = async (source: RasterSource) => {
    if (!user) return;
    try {
      const blob = await (await fetch(source.href)).blob();
      const ext = source.mimeType === "image/jpeg" ? "jpg" : "png";
      const path = `${user.id}/${plan.id}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage
        .from("setout-plan-uploads")
        .upload(path, blob, { contentType: source.mimeType, upsert: true });
      if (error) throw error;
      setUploadedImagePath(path);
      setUploadedImageContentType(source.mimeType);
    } catch (err) {
      // Non-fatal: the tradie can still calibrate and trace, they just won't
      // get the plan as a backdrop in the workspace afterwards.
      console.error("[CalibrationImportFlow] Plan upload failed:", err);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStep("loading");
    try {
      const source = file.type === "application/pdf" ? await renderPdfFirstPage(file) : await loadImageFile(file);
      setRaster(source);
      tileRequestRef.current++;
      tileCleanupRef.current?.();
      tileCleanupRef.current = null;
      setTile(null);
      await uploadPlanImage(source);
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

  const skipCalibration = () => {
    setScaleSkipped(true);
    setPixelsPerMetre(1);
    setStep("trace-walls");
  };

  const confirmCalibration = () => {
    if (!canConfirmCalibration || !raster) return;
    const pixelDist = distance(calibPoints[0], calibPoints[1]);
    const ppm = pixelDist / distanceMetres;
    setPixelsPerMetre(ppm);
    setScaleSkipped(false);
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
  const finishTrace = async (finalPoints: Point[] = sketchPoints, skipWalls = false) => {
    if (!pixelsPerMetre) return;
    if (!skipWalls && finalPoints.length < 3) return;
    const walls = skipWalls ? [] : [...polygonToWalls(finalPoints), ...interiorWalls];
    try {
      await saveGeometry.mutateAsync({
        walls,
        // Null when calibration was skipped — the workspace uses its absence
        // to know it must not report any distance.
        scale_calibration: scaleSkipped
          ? null
          : { pointA: calibPoints[0], pointB: calibPoints[1], realDistanceMetres: distanceMetres },
        openings: wallOpenings,
        ...(uploadedImagePath ? { background_image_path: uploadedImagePath, background_image_content_type: uploadedImageContentType ?? "image/png" } : {}),
      });
      toast.success(skipWalls ? "Plan saved" : "Walls saved");
      onComplete();
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
          PDF or photo of the plan. You'll set the scale, then trace the walls yourself — tracing snaps to the lines printed on the
          plan, so you only need to tap near a corner rather than exactly on it.
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

  if (step === "calibrate" && raster) {
    return (
      <div className="flex flex-col h-full overflow-y-auto px-5 py-6 max-w-6xl mx-auto w-full">
        <button onClick={() => setStep("select-file")} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <h2 className="font-sans text-lg font-extrabold text-foreground mb-1">Calibrate scale</h2>
        <p className="text-xs text-muted-foreground mb-4">
          {calibPoints.length === 2
            ? "Both points placed — enter the real distance between them below, or clear them and pick two others."
            : "Zoom in and tap two points on the plan that you know the real distance between — a wall length, a door width, a dimension already marked."}{" "}
          Use the pan tool (bottom right) to move around once zoomed in.
        </p>
        <div className="flex-1 min-h-[480px] mb-4">
          <SetoutCanvas
            backgroundImage={{ href: raster.href, width: raster.naturalWidth, height: raster.naturalHeight }}
            backgroundTile={tile}
            onViewSettled={handleCalibrateViewSettled}
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
        <Button variant="ghost" className="w-full h-11 text-muted-foreground" onClick={skipCalibration}>
          Skip — I don't need measurements
        </Button>
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
            ? "Tap each corner of the room in order. Tap the first corner again (or the button below) to close the shape — you'll enter the real wall lengths next."
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

        {(wallTool === "perimeter" || wallTool === "interior") && (
          <div className="flex items-center gap-2 mb-3">
            <Switch id="snap-to-plan" checked={snapEnabled} onCheckedChange={setSnapEnabled} />
            <Label htmlFor="snap-to-plan" className="text-xs font-normal text-muted-foreground">
              {detectingEdges
                ? "Reading the lines on the plan…"
                : snapEnabled
                  ? vectorIndex
                    ? `Snap to the plan's lines — exact, read from the PDF (${vectorIndex.size} lines)`
                    : planEdges
                      ? "Snap to the plan's lines — detected from the image"
                      : "Snap to the plan's lines"
                  : "Snap off — taps land exactly where you touch"}
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
            onSketchPointUndo={() => setSketchPoints((prev) => prev.slice(0, -1))}
            backgroundTile={tile}
            onViewSettled={handleTraceViewSettled}
            onSketchClose={proceedToLengthAdjustment}
            snapWalls={wallTool === "perimeter"}
            snapToPlan={snapToPlan}
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

        {wallTool === "perimeter" && sketchPoints.length === 0 && (
          <Button
            variant="ghost"
            className="w-full h-11 mb-2 text-muted-foreground"
            disabled={saveGeometry.isPending}
            onClick={() => finishTrace([], true)}
          >
            Skip — just place things on the plan
          </Button>
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

  return null;
}
