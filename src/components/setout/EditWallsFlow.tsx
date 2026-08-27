import { useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import SetoutCanvas from "./SetoutCanvas";
import { useUpdateSetoutPlanGeometry } from "@/hooks/useSetoutPlans";
import type { Point, SetoutPlan, WallOpening, WallSegment } from "@/lib/setoutTypes";
import { nextOpeningId, nextWallId, wallLength } from "@/lib/setoutGeometry";

// Standard Australian residential door/window widths — used as the default
// when a door/window is placed, then editable per-opening afterward.
const DEFAULT_DOOR_WIDTH = 0.82;
const DEFAULT_WINDOW_WIDTH = 1.2;

interface EditWallsFlowProps {
  plan: SetoutPlan;
  onClose: () => void;
}

// A lightweight touch-up tool for a plan that already has its exterior
// perimeter saved — add internal walls or doors/windows the import missed
// (AI or manual) without re-running the whole calibrate/trace flow. Fixing
// the exterior perimeter itself isn't in scope here — that needs its own
// scale reference, which this tool doesn't have; re-import for that.
export default function EditWallsFlow({ plan, onClose }: EditWallsFlowProps) {
  const [interiorWalls, setInteriorWalls] = useState<WallSegment[]>(plan.walls.filter((w) => w.kind === "interior"));
  const [openings, setOpenings] = useState<WallOpening[]>(plan.openings ?? []);
  const [tool, setTool] = useState<"interior" | "opening">("interior");
  const [straightInteriorWalls, setStraightInteriorWalls] = useState(true);
  const [openingKind, setOpeningKind] = useState<"door" | "window">("door");
  const [draftStart, setDraftStart] = useState<Point | null>(null);
  const saveGeometry = useUpdateSetoutPlanGeometry(plan.id);

  const exteriorWalls = plan.walls.filter((w) => w.kind !== "interior");
  const walls = [...exteriorWalls, ...interiorWalls];

  const handleOpeningPlace = (wallId: string, offset: number) => {
    const wall = walls.find((w) => w.id === wallId);
    if (!wall) return;
    const width = openingKind === "door" ? DEFAULT_DOOR_WIDTH : DEFAULT_WINDOW_WIDTH;
    const len = wallLength(wall);
    const clampedOffset = Math.max(0, Math.min(Math.max(len - width, 0), offset - width / 2));
    setOpenings((prev) => [...prev, { id: nextOpeningId(), wallId, offset: clampedOffset, width, kind: openingKind }]);
  };

  const handleSave = async () => {
    try {
      await saveGeometry.mutateAsync({ walls, scale_calibration: plan.scale_calibration, openings });
      toast.success("Walls updated");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save changes");
    }
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto px-5 py-6 max-w-6xl mx-auto w-full">
      <button onClick={onClose} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <h2 className="font-sans text-lg font-extrabold text-foreground mb-1">Edit walls</h2>
      <p className="text-xs text-muted-foreground mb-4">
        Add internal walls or doors/windows that were missed — drag an existing door/window to reposition it. To fix the outer
        perimeter itself, re-import the plan instead.
      </p>

      <div className="flex gap-1.5 mb-3">
        <Button size="sm" variant={tool === "interior" ? "default" : "outline"} onClick={() => setTool("interior")}>
          Add interior wall
        </Button>
        <Button size="sm" variant={tool === "opening" ? "default" : "outline"} onClick={() => setTool("opening")}>
          Add door/window
        </Button>
      </div>

      {tool === "interior" && (
        <>
          <p className="text-xs text-muted-foreground mb-2">
            Tap point to point along the internal wall run — tap (or click) the same spot twice to finish it.
          </p>
          <div className="flex items-center gap-2 mb-3">
            <Switch id="edit-straight-interior-walls" checked={straightInteriorWalls} onCheckedChange={setStraightInteriorWalls} />
            <Label htmlFor="edit-straight-interior-walls" className="text-xs font-normal text-muted-foreground">
              Keep walls straight (90°) — turn off to draw an angled wall
            </Label>
          </div>
        </>
      )}

      {tool === "opening" && (
        <div className="flex gap-1.5 mb-3">
          <Button size="sm" variant={openingKind === "door" ? "default" : "outline"} onClick={() => setOpeningKind("door")}>
            Door
          </Button>
          <Button size="sm" variant={openingKind === "window" ? "default" : "outline"} onClick={() => setOpeningKind("window")}>
            Window
          </Button>
        </div>
      )}

      <div className="flex-1 min-h-[480px] mb-4">
        <SetoutCanvas
          walls={walls}
          wallThickness={plan.wall_thickness}
          openings={openings}
          mode={tool === "interior" ? "sketch-interior-wall" : "place-opening"}
          interiorWallDraftStart={draftStart}
          onInteriorWallDraftPointAdd={setDraftStart}
          snapInteriorWalls={straightInteriorWalls}
          onInteriorWallSegmentAdd={(start, end) => {
            setInteriorWalls((prev) => [...prev, { id: nextWallId(), start, end, kind: "interior" }]);
            setDraftStart(end);
          }}
          onInteriorWallChainEnd={() => setDraftStart(null)}
          onOpeningPlace={handleOpeningPlace}
          onOpeningDrag={(openingId, offset) =>
            setOpenings((prev) => prev.map((o) => (o.id === openingId ? { ...o, offset } : o)))
          }
        />
      </div>

      {tool === "interior" && (interiorWalls.length > 0 || draftStart) && (
        <Button
          variant="outline"
          className="w-full mb-3"
          disabled={interiorWalls.length === 0 && !draftStart}
          onClick={() => {
            if (interiorWalls.length > 0) {
              const last = interiorWalls[interiorWalls.length - 1];
              setInteriorWalls((prev) => prev.slice(0, -1));
              setDraftStart(last.start);
            } else {
              setDraftStart(null);
            }
          }}
        >
          Undo wall
        </Button>
      )}

      {tool === "interior" && interiorWalls.length > 0 && (
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

      {tool === "opening" && openings.length > 0 && (
        <div className="space-y-1.5 mb-4 max-h-32 overflow-y-auto">
          {openings.map((o) => (
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
                  setOpenings((prev) => prev.map((p) => (p.id === o.id ? { ...p, width } : p)));
                }}
                className="h-7 w-20 text-xs"
              />
              <span className="text-muted-foreground">m</span>
              <button
                type="button"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => setOpenings((prev) => prev.filter((p) => p.id !== o.id))}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <Button className="w-full h-12 font-bold rounded-xl" disabled={saveGeometry.isPending} onClick={handleSave}>
        {saveGeometry.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save changes"}
      </Button>
    </div>
  );
}
