import { useEffect, useRef, useState } from "react";
import { ArrowLeft, FileImage, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import SetoutCanvas from "./SetoutCanvas";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useUpdateSetoutPlanGeometry, useCreateSetoutFittingsBulk } from "@/hooks/useSetoutPlans";
import { FITTING_LABELS, FITTING_SYMBOLS, type FittingType } from "@/components/setout/symbols";
import { CATEGORY_FOR_TYPE, distance, isSingleWallFitting, type FittingSpecs, type Point, type SetoutFitting, type SetoutPlan, type WallOpening, type WallSegment } from "@/lib/setoutTypes";
import {
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
interface AiFitting extends NormalizedPoint {
  type: string;
  confidence: "high" | "medium" | "low";
}
interface AiExtraction {
  corners: NormalizedPoint[];
  suggested_scale: { corner_a_index: number; corner_b_index: number; real_distance_metres: number } | null;
  fittings: AiFitting[];
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

type Step = "select-file" | "loading" | "extracting" | "calibrate" | "trace-walls" | "review-fittings";

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
  const [interiorWalls, setInteriorWalls] = useState<WallSegment[]>([]);
  const [wallOpenings, setWallOpenings] = useState<WallOpening[]>([]);
  const [wallTool, setWallTool] = useState<"perimeter" | "interior" | "opening">("perimeter");
  const [interiorDraftStart, setInteriorDraftStart] = useState<Point | null>(null);
  const [openingKind, setOpeningKind] = useState<"door" | "window">("door");
  const [savedWalls, setSavedWalls] = useState<WallSegment[] | null>(null);
  const [savedOpenings, setSavedOpenings] = useState<WallOpening[]>([]);
  const [aiCorners, setAiCorners] = useState<NormalizedPoint[] | null>(null);
  const [aiFittings, setAiFittings] = useState<AiFitting[]>([]);
  const [removedKeys, setRemovedKeys] = useState<Set<string>>(new Set());
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
        setAiFittings(extraction.fittings || []);
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
          extraction.fittings?.length
            ? `AI traced the walls and found ${extraction.fittings.length} existing fitting${extraction.fittings.length === 1 ? "" : "s"} — check the suggestion below.`
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
    // Seed the trace from the AI's corners the first time through — if the
    // tradie goes Back and forward again, don't clobber edits they've
    // already made to the traced shape.
    if (aiCorners && aiCorners.length >= 3 && sketchPoints.length === 0) {
      setSketchPoints(aiCorners.map((c) => ({ x: (c.x * raster.naturalWidth) / ppm, y: (c.y * raster.naturalHeight) / ppm })));
    }
    setStep("trace-walls");
  };

  const finishTrace = async () => {
    if (sketchPoints.length < 3 || !pixelsPerMetre) return;
    const walls = [...polygonToWalls(sketchPoints), ...interiorWalls];
    try {
      await saveGeometry.mutateAsync({
        walls,
        scale_calibration: { pointA: calibPoints[0], pointB: calibPoints[1], realDistanceMetres: distanceMetres },
        openings: wallOpenings,
      });
      const classifiable = aiFittings.filter((f) => f.type in FITTING_SYMBOLS);
      if (classifiable.length > 0) {
        setSavedWalls(walls);
        setSavedOpenings(wallOpenings);
        setStep("review-fittings");
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
          PDF or photo of the plan. AI will trace the walls and pick up any electrical symbols already marked — you'll confirm scale and
          review everything before it's added.
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
      <div className="flex flex-col h-full px-5 py-6 max-w-3xl mx-auto w-full">
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
        <div className="flex-1 min-h-[360px] mb-4">
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
    const canAddInteriorOrOpening = perimeterWalls.length > 0;
    const canvasMode = wallTool === "perimeter" ? "sketch-walls" : wallTool === "interior" ? "sketch-interior-wall" : "place-opening";

    const handleOpeningPlace = (wallId: string, offset: number) => {
      const wall = previewWalls.find((w) => w.id === wallId);
      if (!wall) return;
      const width = openingKind === "door" ? DEFAULT_DOOR_WIDTH : DEFAULT_WINDOW_WIDTH;
      const len = wallLength(wall);
      const clampedOffset = Math.max(0, Math.min(Math.max(len - width, 0), offset - width / 2));
      setWallOpenings((prev) => [...prev, { id: nextOpeningId(), wallId, offset: clampedOffset, width, kind: openingKind }]);
    };

    return (
      <div className="flex flex-col h-full px-5 py-6 max-w-3xl mx-auto w-full">
        <button onClick={() => setStep("calibrate")} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <h2 className="font-sans text-lg font-extrabold text-foreground mb-1">Trace the walls</h2>
        <p className="text-xs text-muted-foreground mb-4">
          {wallTool === "perimeter"
            ? aiCorners
              ? "AI has traced a starting shape from the plan — drag/add/remove corners to fix anything it got wrong, then close the shape."
              : "Tap each corner of the room in order. Tap the first corner again (or the button below) to close the shape."
            : wallTool === "interior"
              ? "Tap the start, then the end, of one internal wall at a time."
              : `Tap a point on a wall to drop a ${openingKind} there — default width is editable below.`}
        </p>

        <div className="flex gap-1.5 mb-3">
          <Button size="sm" variant={wallTool === "perimeter" ? "default" : "outline"} onClick={() => setWallTool("perimeter")}>
            Trace perimeter
          </Button>
          <Button size="sm" variant={wallTool === "interior" ? "default" : "outline"} disabled={!canAddInteriorOrOpening} onClick={() => setWallTool("interior")}>
            Add interior wall
          </Button>
          <Button size="sm" variant={wallTool === "opening" ? "default" : "outline"} disabled={!canAddInteriorOrOpening} onClick={() => setWallTool("opening")}>
            Add door/window
          </Button>
        </div>

        {wallTool === "opening" && (
          <div className="flex gap-1.5 mb-3">
            <Button size="sm" variant={openingKind === "door" ? "default" : "outline"} onClick={() => setOpeningKind("door")}>
              Door
            </Button>
            <Button size="sm" variant={openingKind === "window" ? "default" : "outline"} onClick={() => setOpeningKind("window")}>
              Window
            </Button>
          </div>
        )}

        <div className="flex-1 min-h-[360px] mb-4">
          <SetoutCanvas
            backgroundImage={backgroundImage}
            walls={previewWalls}
            openings={wallOpenings}
            mode={canvasMode}
            sketchPoints={sketchPoints}
            onSketchPointAdd={(p) => setSketchPoints((prev) => [...prev, p])}
            onSketchClose={finishTrace}
            interiorWallDraftStart={interiorDraftStart}
            onInteriorWallDraftPointAdd={setInteriorDraftStart}
            onInteriorWallSegmentAdd={(start, end) => {
              setInteriorWalls((prev) => [...prev, { id: nextWallId(), start, end, kind: "interior" }]);
              setInteriorDraftStart(null);
            }}
            onOpeningPlace={handleOpeningPlace}
          />
        </div>

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
          {wallTool === "perimeter" && (
            <Button variant="outline" className="flex-1" disabled={sketchPoints.length === 0} onClick={() => setSketchPoints((prev) => prev.slice(0, -1))}>
              Undo point
            </Button>
          )}
          <Button className="flex-1 font-bold" disabled={sketchPoints.length < 3 || saveGeometry.isPending} onClick={finishTrace}>
            {saveGeometry.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save walls"}
          </Button>
        </div>
      </div>
    );
  }

  if (step === "review-fittings" && raster && pixelsPerMetre && savedWalls) {
    const classifiedCount = aiFittings.filter((f) => f.type in FITTING_SYMBOLS).length;
    const unclassifiedCount = aiFittings.length - classifiedCount;
    const draftFittings = aiFittings
      .map((f, i) => ({ key: String(i), f }))
      .filter(({ f }) => f.type in FITTING_SYMBOLS)
      .filter(({ key }) => !removedKeys.has(key))
      .map(({ key, f }) => {
        const type = f.type as FittingType;
        const rawPosition = { x: (f.x * raster.naturalWidth) / pixelsPerMetre, y: (f.y * raster.naturalHeight) / pixelsPerMetre };
        // Snap wall-mounted detections onto the actual wall line (and clear
        // of any door/window on it) — same treatment a manually-placed
        // fitting gets, so AI-detected GPOs/switches don't end up floating
        // just off the wall or sitting mid-doorway.
        const position = isSingleWallFitting(type) ? snapToNearestWall(rawPosition, savedWalls, savedOpenings) : rawPosition;
        return { key, type, position };
      });

    const previewFittings: SetoutFitting[] = draftFittings.map((f) => ({
      id: f.key,
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
      const inputs = draftFittings.map(({ type, position }) => {
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
      <div className="flex flex-col h-full px-5 py-6 max-w-3xl mx-auto w-full">
        <h2 className="font-sans text-lg font-extrabold text-foreground mb-1">Review detected fittings</h2>
        <p className="text-xs text-muted-foreground mb-4">
          AI found {aiFittings.length} existing electrical symbol{aiFittings.length === 1 ? "" : "s"} on this plan
          {unclassifiedCount > 0
            ? `, ${unclassifiedCount} of which it couldn't confidently classify — those aren't shown, you'll need to add ${unclassifiedCount === 1 ? "it" : "them"} manually`
            : ""}
          . Remove anything that looks wrong below, then add the rest to the plan with measurements attached automatically.
        </p>
        <div className="flex-1 min-h-[300px] mb-4">
          <SetoutCanvas
            backgroundImage={{ href: raster.href, width: raster.naturalWidth / pixelsPerMetre, height: raster.naturalHeight / pixelsPerMetre }}
            walls={savedWalls}
            openings={savedOpenings}
            fittings={previewFittings}
            mode="view"
          />
        </div>
        {draftFittings.length > 0 && (
          <div className="space-y-1.5 mb-4 max-h-40 overflow-y-auto">
            {draftFittings.map((f) => (
              <div key={f.key} className="flex items-center justify-between rounded-lg border border-border px-3 py-1.5 text-xs">
                <span className="font-medium text-foreground">{FITTING_LABELS[f.type]}</span>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => setRemovedKeys((prev) => new Set(prev).add(f.key))}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onComplete}>
            Skip — place manually
          </Button>
          <Button className="flex-1 font-bold" disabled={draftFittings.length === 0 || createFittingsBulk.isPending} onClick={handleAddFittings}>
            {createFittingsBulk.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              `Add ${draftFittings.length} fitting${draftFittings.length === 1 ? "" : "s"}`
            )}
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
