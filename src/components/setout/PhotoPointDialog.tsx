import { useEffect, useRef, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const DIAL_SIZE = 120;
const DIAL_RADIUS = DIAL_SIZE / 2;

// Angle convention: 0deg = plan "up", clockwise positive — same as the
// arrow SetoutCanvas draws on the pin (`rotate(direction_degrees)`), so
// whatever's set here points the same way on the actual plan.
function angleFromCenter(dx: number, dy: number): number {
  const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return deg < 0 ? deg + 360 : deg;
}

interface DirectionDialProps {
  degrees: number | null;
  onChange: (degrees: number) => void;
}

// A drag/tap dial for "which way was the tradie facing" — chosen over an
// on-canvas rotate handle because a compass phones are unreliable indoors
// (steel framing, wiring) so this is a manual, deliberate-set control
// rather than something sensor-driven.
function DirectionDial({ degrees, onChange }: DirectionDialProps) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const setFromClientPoint = (clientX: number, clientY: number) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    onChange(angleFromCenter(clientX - cx, clientY - cy));
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    dragging.current = true;
    (e.target as Element).setPointerCapture(e.pointerId);
    setFromClientPoint(e.clientX, e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    setFromClientPoint(e.clientX, e.clientY);
  };

  const handlePointerUp = () => {
    dragging.current = false;
  };

  const handleX = degrees != null ? DIAL_RADIUS + Math.sin((degrees * Math.PI) / 180) * (DIAL_RADIUS - 14) : null;
  const handleY = degrees != null ? DIAL_RADIUS - Math.cos((degrees * Math.PI) / 180) * (DIAL_RADIUS - 14) : null;

  return (
    <div
      ref={ref}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      className="relative mx-auto rounded-full border-2 border-border bg-muted/40 touch-none select-none cursor-pointer"
      style={{ width: DIAL_SIZE, height: DIAL_SIZE }}
    >
      <span className="absolute top-1.5 left-1/2 -translate-x-1/2 text-[10px] font-semibold text-muted-foreground">
        PLAN UP
      </span>
      {degrees != null && (
        <svg className="absolute inset-0 pointer-events-none" width={DIAL_SIZE} height={DIAL_SIZE}>
          <line
            x1={DIAL_RADIUS}
            y1={DIAL_RADIUS}
            x2={handleX!}
            y2={handleY!}
            stroke="hsl(var(--primary))"
            strokeWidth={3}
            strokeLinecap="round"
          />
        </svg>
      )}
      <div
        className={cn(
          "absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full",
          degrees != null ? "bg-primary" : "bg-muted-foreground/40"
        )}
        style={{ left: handleX ?? DIAL_RADIUS, top: handleY ?? 6 }}
      />
      <div className="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/60" style={{ left: DIAL_RADIUS, top: DIAL_RADIUS }} />
    </div>
  );
}

interface PhotoPointDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  photoUrl: string | null;
  loadingPhoto?: boolean;
  directionDegrees: number | null;
  onDirectionChange: (degrees: number) => void;
  onDelete: () => void;
  deleting?: boolean;
}

export default function PhotoPointDialog({
  open,
  onOpenChange,
  photoUrl,
  loadingPhoto,
  directionDegrees,
  onDirectionChange,
  onDelete,
  deleting,
}: PhotoPointDialogProps) {
  // Local draft so dragging the dial feels instant rather than waiting on
  // the parent's mutation round-trip — the parent still owns persistence
  // (onDirectionChange fires on every change, same as elsewhere the
  // component reports geometry and the page saves it).
  const [draftDegrees, setDraftDegrees] = useState(directionDegrees);
  useEffect(() => setDraftDegrees(directionDegrees), [directionDegrees, photoUrl]);

  const handleDialChange = (degrees: number) => {
    setDraftDegrees(degrees);
    onDirectionChange(degrees);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Site photo</DialogTitle>
        </DialogHeader>
        <div className="rounded-lg overflow-hidden bg-muted flex items-center justify-center aspect-[4/3]">
          {loadingPhoto || !photoUrl ? (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          ) : (
            <img src={photoUrl} alt="Site photo" className="h-full w-full object-contain" />
          )}
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium text-foreground text-center">Which way was the photo taken toward?</p>
          <DirectionDial degrees={draftDegrees} onChange={handleDialChange} />
          <p className="text-[11px] text-muted-foreground text-center">Drag to point the arrow the way you were facing.</p>
        </div>
        <div className="space-y-2">
          <Button className="w-full" onClick={() => onOpenChange(false)}>
            Done
          </Button>
          <Button variant="outline" className="w-full text-destructive hover:text-destructive gap-1.5" onClick={onDelete} disabled={deleting}>
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Delete photo point
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
