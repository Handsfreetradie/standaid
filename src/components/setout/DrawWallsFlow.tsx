import { useMemo, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import SetoutCanvas from "./SetoutCanvas";
import { useUpdateSetoutPlanGeometry } from "@/hooks/useSetoutPlans";
import type { Point, SetoutPlan } from "@/lib/setoutTypes";
import { applyWallLengths, polygonToWalls, wallLength } from "@/lib/setoutGeometry";

type Step = "sketch" | "lengths";

interface DrawWallsFlowProps {
  plan: SetoutPlan;
  onBack: () => void;
  onComplete: () => void;
}

export default function DrawWallsFlow({ plan, onBack, onComplete }: DrawWallsFlowProps) {
  const [step, setStep] = useState<Step>("sketch");
  const [sketchPoints, setSketchPoints] = useState<Point[]>([]);
  const [lengths, setLengths] = useState<string[]>([]);
  const saveGeometry = useUpdateSetoutPlanGeometry(plan.id);

  const closeSketch = () => {
    if (sketchPoints.length < 3) return;
    const walls = polygonToWalls(sketchPoints);
    setLengths(walls.map((w) => wallLength(w).toFixed(2)));
    setStep("lengths");
  };

  const previewWalls = useMemo(() => {
    if (step !== "lengths") return [];
    const parsed = lengths.map((l) => Number(l) || 0);
    if (parsed.some((l) => l <= 0)) return polygonToWalls(sketchPoints);
    const adjustedPoints = applyWallLengths(sketchPoints, parsed);
    return polygonToWalls(adjustedPoints);
  }, [step, lengths, sketchPoints]);

  const allLengthsValid = lengths.length > 0 && lengths.every((l) => Number(l) > 0);

  const saveWalls = async () => {
    if (!allLengthsValid) return;
    const finalWalls = polygonToWalls(applyWallLengths(sketchPoints, lengths.map(Number)));
    try {
      await saveGeometry.mutateAsync({ walls: finalWalls, scale_calibration: null });
      toast.success("Walls saved");
      onComplete();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the plan");
    }
  };

  if (step === "sketch") {
    return (
      <div className="flex flex-col h-full overflow-y-auto px-5 py-6 max-w-6xl mx-auto w-full">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <h2 className="font-sans text-lg font-extrabold text-foreground mb-1">Sketch the room</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Tap each corner as you see it on the frame, in order — walls snap square automatically. Tap the first corner again (or the button below) to close the shape.
        </p>
        <div className="flex-1 min-h-[480px] mb-4">
          <SetoutCanvas
            walls={[]}
            mode="sketch-walls"
            sketchPoints={sketchPoints}
            onSketchPointAdd={(p) => setSketchPoints((prev) => [...prev, p])}
            onSketchClose={closeSketch}
            snapWalls
          />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" disabled={sketchPoints.length === 0} onClick={() => setSketchPoints((prev) => prev.slice(0, -1))}>
            Undo point
          </Button>
          <Button className="flex-1 font-bold" disabled={sketchPoints.length < 3} onClick={closeSketch}>
            Close shape
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto px-5 py-6 max-w-6xl mx-auto w-full">
      <button onClick={() => setStep("sketch")} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-4 w-4" /> Back to sketch
      </button>
      <h2 className="font-sans text-lg font-extrabold text-foreground mb-1">Enter real wall lengths</h2>
      <p className="text-xs text-muted-foreground mb-4">Type the tape-measure length of each wall, in metres. The shape redraws true to scale.</p>

      <div className="flex-1 min-h-[420px] mb-4">
        <SetoutCanvas walls={previewWalls} mode="view" />
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
              onChange={(e) =>
                setLengths((prev) => prev.map((v, idx) => (idx === i ? e.target.value : v)))
              }
            />
          </div>
        ))}
      </div>

      <Button className="w-full h-12 font-bold rounded-xl" disabled={!allLengthsValid || saveGeometry.isPending} onClick={saveWalls}>
        {saveGeometry.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save walls"}
      </Button>
    </div>
  );
}
