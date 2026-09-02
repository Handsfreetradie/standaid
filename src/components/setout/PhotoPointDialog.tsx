import { useEffect, useRef, useState } from "react";
import { Loader2, Trash2, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";
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
  photoCount?: number;
  currentPhotoIndex?: number;
  onNextPhoto?: () => void;
  onPrevPhoto?: () => void;
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
  photoCount = 1,
  currentPhotoIndex = 0,
  onNextPhoto,
  onPrevPhoto,
}: PhotoPointDialogProps) {
  // Local draft for direction dial
  const [draftDegrees, setDraftDegrees] = useState(directionDegrees);
  useEffect(() => setDraftDegrees(directionDegrees), [directionDegrees, photoUrl]);

  // Zoom and pan state for high-res photo viewing
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [lastDistance, setLastDistance] = useState(0);
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const panStartRef = useRef<{ x: number; y: number } | null>(null);

  const handleZoom = (direction: number) => {
    setZoom((prev) => Math.max(1, Math.min(4, prev + direction * 0.5)));
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    handleZoom(e.deltaY > 0 ? -1 : 1);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (zoom > 1) {
      panStartRef.current = { x: e.clientX, y: e.clientY };
      (e.target as Element).setPointerCapture(e.pointerId);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!panStartRef.current || zoom <= 1) return;
    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;
    setPanX((prev) => prev + dx);
    setPanY((prev) => prev + dy);
    panStartRef.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerUp = () => {
    panStartRef.current = null;
  };

  // Reset zoom when photo changes
  useEffect(() => {
    setZoom(1);
    setPanX(0);
    setPanY(0);
  }, [photoUrl]);

  const handleDialChange = (degrees: number) => {
    setDraftDegrees(degrees);
    onDirectionChange(degrees);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            Site photo {photoCount > 1 && `(${currentPhotoIndex + 1} of ${photoCount})`}
          </DialogTitle>
        </DialogHeader>
        {/* High-res image viewer with zoom/pan */}
        <div
          ref={containerRef}
          className="rounded-lg overflow-hidden bg-muted flex items-center justify-center flex-1 relative cursor-grab active:cursor-grabbing"
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={{ minHeight: "400px" }}
        >
          {loadingPhoto || !photoUrl ? (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          ) : (
            <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
              <img
                ref={imageRef}
                src={photoUrl}
                alt="Site photo"
                className="object-contain select-none"
                style={{
                  transform: `scale(${zoom}) translate(${panX / (zoom * 100)}px, ${panY / (zoom * 100)}px)`,
                  transformOrigin: "center",
                  transition: zoom === 1 ? "transform 0.2s ease-out" : "none",
                  maxWidth: "100%",
                  maxHeight: "100%",
                }}
              />
            </div>
          )}
          {/* Zoom controls */}
          {!loadingPhoto && photoUrl && (
            <div className="absolute top-3 right-3 flex gap-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleZoom(1)}
                disabled={zoom >= 4}
                className="h-8 w-8 p-0"
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleZoom(-1)}
                disabled={zoom <= 1}
                className="h-8 w-8 p-0"
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
              {zoom > 1 && (
                <span className="text-xs font-medium px-2 py-1 bg-card rounded border border-border">
                  {zoom.toFixed(1)}x
                </span>
              )}
            </div>
          )}
          {/* Gallery navigation */}
          {photoCount > 1 && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={onPrevPhoto}
                disabled={currentPhotoIndex === 0}
                className="absolute left-3 top-1/2 -translate-y-1/2 h-8 w-8 p-0"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={onNextPhoto}
                disabled={currentPhotoIndex === photoCount - 1}
                className="absolute right-3 top-1/2 -translate-y-1/2 h-8 w-8 p-0"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </>
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
