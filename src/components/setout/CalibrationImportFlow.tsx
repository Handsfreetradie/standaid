import { useEffect, useRef, useState } from "react";
import { ArrowLeft, FileImage, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import SetoutCanvas from "./SetoutCanvas";
import { useUpdateSetoutPlanGeometry } from "@/hooks/useSetoutPlans";
import { distance, type Point, type SetoutPlan } from "@/lib/setoutTypes";
import { polygonToWalls } from "@/lib/setoutGeometry";

interface RasterSource {
  href: string;
  naturalWidth: number;
  naturalHeight: number;
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
  return { href: canvas.toDataURL("image/png"), naturalWidth: canvas.width, naturalHeight: canvas.height };
}

function loadImageFile(file: File): Promise<RasterSource> {
  return new Promise((resolve, reject) => {
    const href = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ href, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight });
    img.onerror = () => reject(new Error("Could not read that image file"));
    img.src = href;
  });
}

type Step = "select-file" | "loading" | "calibrate" | "trace-walls";

interface CalibrationImportFlowProps {
  plan: SetoutPlan;
  onBack: () => void;
  onComplete: () => void;
}

export default function CalibrationImportFlow({ plan, onBack, onComplete }: CalibrationImportFlowProps) {
  const [step, setStep] = useState<Step>("select-file");
  const [raster, setRaster] = useState<RasterSource | null>(null);
  const [calibPoints, setCalibPoints] = useState<Point[]>([]);
  const [realDistance, setRealDistance] = useState("");
  const [pixelsPerMetre, setPixelsPerMetre] = useState<number | null>(null);
  const [sketchPoints, setSketchPoints] = useState<Point[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const saveGeometry = useUpdateSetoutPlanGeometry(plan.id);

  useEffect(() => {
    return () => {
      if (raster?.href.startsWith("blob:")) URL.revokeObjectURL(raster.href);
    };
  }, [raster]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStep("loading");
    try {
      const source = file.type === "application/pdf" ? await renderPdfFirstPage(file) : await loadImageFile(file);
      setRaster(source);
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
    setPixelsPerMetre(pixelDist / distanceMetres);
    setStep("trace-walls");
  };

  const finishTrace = async () => {
    if (sketchPoints.length < 3 || !pixelsPerMetre) return;
    const walls = polygonToWalls(sketchPoints);
    try {
      await saveGeometry.mutateAsync({
        walls,
        scale_calibration: { pointA: calibPoints[0], pointB: calibPoints[1], realDistanceMetres: distanceMetres },
      });
      toast.success("Walls saved");
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
        <p className="text-xs text-muted-foreground mb-5">PDF or photo of the plan. You'll calibrate it to real scale next.</p>
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
      <div className="flex flex-col h-full px-5 py-6 max-w-3xl mx-auto w-full">
        <button onClick={() => setStep("select-file")} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <h2 className="font-sans text-lg font-extrabold text-foreground mb-1">Calibrate scale</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Zoom in and tap two points on the plan that you know the real distance between — a wall length, a door width, a dimension already
          marked. Use the pan tool (bottom right) to move around once zoomed in.
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
    return (
      <div className="flex flex-col h-full px-5 py-6 max-w-3xl mx-auto w-full">
        <button onClick={() => setStep("calibrate")} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <h2 className="font-sans text-lg font-extrabold text-foreground mb-1">Trace the walls</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Tap each corner of the room in order. Tap the first corner again (or the button below) to close the shape.
        </p>
        <div className="flex-1 min-h-[360px] mb-4">
          <SetoutCanvas
            backgroundImage={backgroundImage}
            walls={[]}
            mode="sketch-walls"
            sketchPoints={sketchPoints}
            onSketchPointAdd={(p) => setSketchPoints((prev) => [...prev, p])}
            onSketchClose={finishTrace}
          />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" disabled={sketchPoints.length === 0} onClick={() => setSketchPoints((prev) => prev.slice(0, -1))}>
            Undo point
          </Button>
          <Button className="flex-1 font-bold" disabled={sketchPoints.length < 3 || saveGeometry.isPending} onClick={finishTrace}>
            {saveGeometry.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Close shape & save"}
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
