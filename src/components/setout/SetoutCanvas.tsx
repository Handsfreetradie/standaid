import { useRef, useState, useCallback, useMemo, useEffect } from "react";
import { GripHorizontal, Minus, Plus, MousePointer2, Camera } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMm } from "@/lib/units";
import { measurementRefId, DEFAULT_TWIN_SPACING_MM, DEFAULT_WIFI_RANGE_M, type MeasurementLock } from "@/lib/setoutTypes";
import { pathLength, pathMidpoint, pathToSvgD } from "@/lib/setoutPathGeometry";
import { FITTING_SYMBOLS, type FittingType } from "@/components/setout/symbols";
import {
  colorForCircuit,
  distance,
  gangsFor,
  isSingleWallFitting,
  symbolExtraPropsFor,
  wayCountForTarget,
  runGroupFittingIds,
  DEFAULT_WALL_THICKNESS,
  type Point,
  type PathPoint,
  type SetoutCircuit,
  type SetoutFitting,
  type SetoutPhotoPoint,
  type SetoutPhotoGallery,
  type WallSegment,
  type WallOpening,
  type WallThickness,
  type MeasurementRef,
  type LayerVisibility,
} from "@/lib/setoutTypes";
import {
  snapOrthogonal,
  isNearFirstPoint,
  lightPoolRadius,
  poolsSignificantlyOverlap,
  downlightLampPositions,
  closestPointOnWall,
  snapToNearestWall,
  alignToExistingPoints,
  findMidpointSnap,
  wallLength,
  pointAtOffset,
  wallsCentroid,
  roomFacingNormal,
  nearestWallAndOffset,
  perpendicularDistanceToWall,
  projectPointOntoWall,
  offsetSymbolIntoRoom,
  groupPhotosByPosition,
} from "@/lib/setoutGeometry";

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const ICON_SCREEN_PX = 28;
// Radius of a traced corner dot, in SCREEN pixels. Deliberately not a fixed
// size in metres: that made the dots grow or shrink with whatever scale the
// tradie happened to calibrate, and on a large commercial plan they covered
// the very detail needed to place the next corner. Small enough to sit on a
// wall junction without burying it.
const CORNER_MARKER_PX = 5;

interface BackgroundImage {
  href: string;
  width: number;
  height: number;
}

// A crisp re-render of just the part of the plan currently on screen, drawn
// over the base image. A PDF is vector, so it can be rasterised again at
// whatever zoom the tradie is on; the base image below it is a fixed
// resolution and turns to mush when magnified. Positioned in scene units.
export interface BackgroundTile {
  href: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type SetoutCanvasMode =
  | "view"
  | "calibrate"
  | "sketch-walls"
  | "sketch-interior-wall"
  | "erase-wall"
  | "place-opening"
  | "place-fittings"
  | "link-switches"
  | "select-multiple"
  | "pick-measurement-ref"
  | "place-photo-points"
  | "link-data-cabinet"
  | "draw-led-strip"
  | "measure";

interface SetoutCanvasProps {
  // The LED strip run currently being traced. Held by the parent for the same
  // reason sketchPoints is — undo and the "finish run" button live up there.
  stripDraft?: PathPoint[];
  // curveControl, when present, is the Bézier control point for the segment
  // arriving at `point` from the previous one — see curveMode below.
  onStripPointAdd?: (point: Point, curveControl?: Point) => void;
  // The ad-hoc tape-measure chain currently being walked — ephemeral, same
  // ownership split as stripDraft (held by the parent for undo/clear), but
  // never becomes a fitting: it's just a ruler for reading a distance off
  // the plan (e.g. a hallway run), not something that gets saved.
  measureDraft?: Point[];
  onMeasurePointAdd?: (point: Point) => void;
  backgroundImage?: BackgroundImage;
  backgroundTile?: BackgroundTile | null;
  // Fires once the view stops moving, so the owner can re-render the plan for
  // the region now on screen. Debounced here rather than by the caller,
  // because this component is what knows when a pan or zoom has settled.
  onViewSettled?: (view: { x: number; y: number; w: number; h: number; screenWidth: number }) => void;
  walls: WallSegment[];
  // Real thickness (metres) drawn straight into the wall line's stroke
  // width in scene units — deliberately not vector-effect non-scaling like
  // every other line here, so a wall genuinely reads thicker/thinner as the
  // tradie zooms, the same way it would on a printed scaled drawing.
  wallThickness?: WallThickness;
  openings?: WallOpening[];
  fittings?: SetoutFitting[];
  mode: SetoutCanvasMode;
  sketchPoints?: PathPoint[];
  onSketchPointAdd?: (point: Point, curveControl?: Point) => void;
  // Drops the most recently added sketch point. Used to retract the point a
  // double-tap-to-zoom placed on its way in — see handleBackgroundPointerDown.
  onSketchPointUndo?: () => void;
  onSketchClose?: () => void;
  // "calibrate" mode: up to two taps to pick the scale-reference points,
  // rendered as its own marker pair rather than reusing sketchPoints, since
  // a calibration pair and a wall trace can coexist on the same screen at
  // different steps of the import flow.
  calibratePoints?: Point[];
  onCalibratePointAdd?: (point: Point) => void;
  // "sketch-interior-wall" mode: point-to-point chain, same interaction as
  // sketch-walls' perimeter tracing. First tap sets the draft start point
  // (rendered so the tradie can see it's pending); each further tap
  // completes a segment from the previous point and immediately continues
  // the chain from there — the parent owns the growing list of interior
  // walls, this component only reports one segment at a time. A second tap
  // landing close in time and space to the previous one (a double-click or
  // double-tap) ends the chain instead of adding another near-duplicate
  // point — see onInteriorWallChainEnd.
  interiorWallDraftStart?: Point | null;
  onInteriorWallDraftPointAdd?: (point: Point) => void;
  onInteriorWallSegmentAdd?: (start: Point, end: Point, curveControl?: Point) => void;
  onInteriorWallChainEnd?: () => void;
  // One-shot curve mode: while true, the NEXT tap in sketch-walls,
  // sketch-interior-wall or draw-led-strip is captured as a Bézier control
  // point (bypassing every snap) instead of adding a corner; the tap after
  // that is the destination corner, tagged with that control point. Fires
  // onCurveControlCaptured once the control tap lands so the parent can
  // flip its own toggle back off — this is deliberately not sticky.
  curveMode?: boolean;
  onCurveControlCaptured?: () => void;
  // Interior walls default to square (horizontal/vertical off the start
  // point) same as the perimeter's snapWalls — a tradie's rough second tap
  // gets straightened automatically. Set false to let a wall land exactly
  // where tapped (an intentionally angled partition).
  snapInteriorWalls?: boolean;
  // "erase-wall" mode: tapping an interior wall selects it (highlighted
  // strongly below) — the parent decides what a tap means (select vs.
  // toggle-off) and owns the actual delete, which happens via a separate
  // confirm action outside this component. Two-step rather than
  // delete-on-tap since a mis-tap between two close/thin walls used to be
  // both easy to make and irreversible; selecting first is free to correct.
  // The exterior perimeter is never tappable here (fixing it needs a
  // re-import, same boundary EditWallsFlow/CalibrationImportFlow draw).
  onWallTap?: (wallId: string) => void;
  selectedEraseWallId?: string | null;
  // "place-opening" mode: a tap resolves to the nearest wall + offset along
  // it (via nearestWallAndOffset) — the parent turns that into a
  // WallOpening with whatever kind/width is currently selected.
  onOpeningPlace?: (wallId: string, offset: number) => void;
  // A wall the opening tap actually landed on that turned out to be curved
  // — openings aren't supported on curved segments this pass (see
  // curveMode below), so the caller can toast an explanation instead of
  // the tap silently doing nothing.
  onOpeningPlaceOnCurveBlocked?: () => void;
  // "place-opening" mode: dragging an already-placed door/window slides it
  // along its own wall — the parent persists the new offset, clamped to the
  // wall's length here since this component owns the wall geometry.
  onOpeningDrag?: (openingId: string, offset: number) => void;
  // "pick-measurement-ref" mode: re-points selectedFittingId's measurement
  // at whatever the tradie taps next — a wall (if the tap lands close
  // enough to one) or another fitting — rather than a labelled dropdown,
  // since walls have no visible label on the plan to pick from. Resolves
  // the distance here (same division of responsibility as onOpeningPlace:
  // this component has the geometry, the parent just persists the result).
  onMeasurementRefPick?: (ref: MeasurementRef) => void;
  snapWalls?: boolean;
  // Pulls a raw point onto the plan's geometry, or returns null to leave it
  // where it was. Deliberately a function rather than an index: the owner
  // decides whether that means the exact vector lines read out of the PDF or
  // the pixel detector used on scans, and this component doesn't need to know
  // which. Given the tolerance in scene units, since only the canvas knows the
  // zoom. Absent for draw-on-site, where there's no plan to snap to.
  snapToPlan?: ((point: Point, tolerance: number) => Point | null) | null;
  // Turns a tap on the plan's own line work into a measurement reference, for
  // when there are no traced walls or openings to point at. Lives with the
  // owner rather than here because it needs the plan's line geometry to work
  // out a square measurement, which this component doesn't hold.
  onPickPlanMeasurementRef?: (tap: Point, from: Point, tolerance: number) => MeasurementRef | null;
  // Double-tapping a measurement on the plan re-points it, without going via
  // the panel — the measurement itself is the obvious thing to aim at.
  onMeasurementDoubleTap?: (fittingId: string, slot: "refA" | "refB") => void;
  // A tap that lands on nothing while picking. Without a way out, starting a
  // pick by double-tapping the plan strands the tradie in a mode with no
  // visible exit, since a tap in open space is deliberately ignored.
  onMeasurementPickCancel?: () => void;
  // What a fitting's measurement would be at a given position. Used to keep
  // the dimensions live while it's being dragged, so the tradie can see where
  // to drop it — the stored numbers are for where it currently sits, which is
  // exactly what they're trying to change.
  measurementPreviewFor?: (fitting: SetoutFitting, position: Point) => MeasurementLock | null;
  selectedFittingType?: FittingType | null;
  // The snapped position, plus where the tap actually landed. The raw point
  // is what says which side of a wall the tradie was standing on, and so which
  // way a switch or GPO should face — information the snapped point, sitting
  // exactly on the wall's face, no longer carries.
  onPlaceFitting?: (point: Point, rawPoint: Point) => void;
  onFittingDrag?: (fittingId: string, position: Point) => void;
  onFittingRotate?: (fittingId: string) => void;
  selectedFittingId?: string | null;
  onFittingSelect?: (fittingId: string | null) => void;
  layerVisibility?: LayerVisibility;
  // This job's ceiling height, in metres — the fallback for a downlight's
  // coverage-pool radius when it has no mounting height of its own (every
  // downlight placed before that field existed). See PlanDefaults.
  ceilingHeightDefaultM?: number;
  linkActiveSwitchId?: string | null;
  linkActiveGangIndex?: number;
  onSwitchTap?: (switchId: string | null) => void;
  onLinkTargetTap?: (fittingId: string) => void;
  // Shows every switch-to-light run in red, not just the one currently
  // being edited — a "check the wiring" toggle for when a tradie wants to
  // verify the whole layout rather than muted lines everywhere but the
  // active gang.
  highlightSwitchLinks?: boolean;
  // Double-tap/double-click a switch to open its menu — reports
  // the raw client (screen) coordinates so the parent can anchor a
  // position-controlled menu right where the tradie tapped, rather than
  // making them find the switch's card in the side panel.
  onSwitchDoubleTap?: (switchFitting: SetoutFitting, clientPos: { x: number; y: number }) => void;
  // "link-data-cabinet" mode: same select-then-tap pattern as switches, but
  // simpler — a data point either home-runs to the active cabinet or it
  // doesn't (see FittingSpecs.dataCabinetId), no gangs/N-way concept.
  linkActiveCabinetId?: string | null;
  onCabinetTap?: (cabinetId: string | null) => void;
  onDataLinkTargetTap?: (fittingId: string) => void;
  multiSelectIds?: Set<string>;
  onMultiSelectToggle?: (fittingId: string) => void;
  circuits?: SetoutCircuit[];
  // "place-photo-points" mode: a tap on empty canvas drops a pin at that
  // spot — the parent takes it from there (opens the camera, uploads, then
  // creates the row once a photo actually exists; a cancelled camera means
  // this never turns into a saved point). Tapping an existing pin instead
  // opens it for viewing/editing (onPhotoPointTap) — same division as
  // fittings' select-vs-place split.
  photoPoints?: SetoutPhotoPoint[];
  // clientX/clientY (screen space) let the caller anchor a "take photo or
  // upload 360°" choice menu right where the tap happened, same convention
  // as onSwitchDoubleTap.
  onPhotoPointPlace?: (point: Point, clientX: number, clientY: number) => void;
  onPhotoPointTap?: (photoPointId: string) => void;
  className?: string;
}

// A wall stroke, straight or curved. A curved wall never has an opening cut
// into it (openings are blocked on curved segments — see
// onOpeningPlaceOnCurveBlocked), so `seg` is always the whole wall in that
// case; rendered as a real quadratic-Bézier <path> rather than sampling it
// into a polyline, so SVG hit-tests the actual curve geometry natively.
interface WallStrokeProps {
  seg: { from: Point; to: Point };
  curveControl?: Point;
  stroke: string;
  strokeWidth: number;
  strokeOpacity?: number;
  strokeLinecap?: "round" | "square" | "butt";
  vectorEffect?: "non-scaling-stroke";
  pointerEvents?: React.CSSProperties["pointerEvents"];
}

function WallStroke({ seg, curveControl, ...strokeProps }: WallStrokeProps) {
  if (curveControl) {
    return <path d={`M ${seg.from.x} ${seg.from.y} Q ${curveControl.x} ${curveControl.y} ${seg.to.x} ${seg.to.y}`} fill="none" {...strokeProps} />;
  }
  return <line x1={seg.from.x} y1={seg.from.y} x2={seg.to.x} y2={seg.to.y} {...strokeProps} />;
}

function initialViewBox(backgroundImage?: BackgroundImage, walls?: WallSegment[]): ViewBox {
  if (backgroundImage) {
    const pad = Math.max(backgroundImage.width, backgroundImage.height) * 0.05;
    return { x: -pad, y: -pad, w: backgroundImage.width + pad * 2, h: backgroundImage.height + pad * 2 };
  }
  if (walls && walls.length > 0) {
    const xs = walls.flatMap((w) => [w.start.x, w.end.x]);
    const ys = walls.flatMap((w) => [w.start.y, w.end.y]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const pad = Math.max(maxX - minX, maxY - minY, 4) * 0.2;
    return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
  }
  return { x: -1, y: -1, w: 10, h: 10 };
}

export default function SetoutCanvas({
  backgroundImage,
  backgroundTile = null,
  onViewSettled,
  walls,
  wallThickness = DEFAULT_WALL_THICKNESS,
  openings = [],
  fittings = [],
  mode,
  stripDraft = [],
  onStripPointAdd,
  measureDraft = [],
  onMeasurePointAdd,
  sketchPoints = [],
  onSketchPointAdd,
  onSketchPointUndo,
  onSketchClose,
  calibratePoints = [],
  onCalibratePointAdd,
  interiorWallDraftStart = null,
  onInteriorWallDraftPointAdd,
  onInteriorWallSegmentAdd,
  onInteriorWallChainEnd,
  snapInteriorWalls = true,
  curveMode = false,
  onCurveControlCaptured,
  onWallTap,
  selectedEraseWallId = null,
  onOpeningPlace,
  onOpeningPlaceOnCurveBlocked,
  onOpeningDrag,
  onMeasurementRefPick,
  snapWalls = false,
  snapToPlan = null,
  onPickPlanMeasurementRef,
  onMeasurementDoubleTap,
  onMeasurementPickCancel,
  measurementPreviewFor,
  selectedFittingType,
  onPlaceFitting,
  onFittingDrag,
  onFittingRotate,
  selectedFittingId,
  onFittingSelect,
  layerVisibility,
  ceilingHeightDefaultM,
  linkActiveSwitchId,
  linkActiveGangIndex = 0,
  onSwitchTap,
  onLinkTargetTap,
  onSwitchDoubleTap,
  highlightSwitchLinks = false,
  linkActiveCabinetId,
  onCabinetTap,
  onDataLinkTargetTap,
  multiSelectIds,
  onMultiSelectToggle,
  circuits = [],
  photoPoints = [],
  onPhotoPointPlace,
  onPhotoPointTap,
  className,
}: SetoutCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  // Zoom limits are relative to how wide a view this canvas started with,
  // not a fixed absolute number — a fixed span assumes scene units are
  // metres, but "calibrate" mode feeds this component a backgroundImage
  // sized in raw image pixels (often thousands of units), so a fixed cap
  // of e.g. 200 would clamp almost immediately on the very first zoom,
  // snapping to a tiny sliver of the image with no way back out.
  const spanBoundsRef = useRef<{ min: number; max: number } | null>(null);
  const [viewBox, setViewBox] = useState<ViewBox>(() => {
    const vb = initialViewBox(backgroundImage, walls);
    const initialSpan = Math.max(vb.w, vb.h);
    spanBoundsRef.current = { min: initialSpan / 200, max: initialSpan * 1.5 };
    return vb;
  });
  // Whether the view has ever been fitted to something real. A plan loaded
  // from storage arrives after this component mounts, and a plan whose walls
  // were skipped has nothing else to fit to — so without this the view keeps
  // the 10m fallback window and the tradie stares at blank paper beside a plan
  // that is, say, eighty metres wide.
  const fittedToContentRef = useRef(!!backgroundImage || (walls?.length ?? 0) > 0);

  useEffect(() => {
    if (fittedToContentRef.current) return;
    if (!backgroundImage && (walls?.length ?? 0) === 0) return;
    const vb = initialViewBox(backgroundImage, walls);
    const span = Math.max(vb.w, vb.h);
    spanBoundsRef.current = { min: span / 200, max: span * 1.5 };
    fittedToContentRef.current = true;
    setViewBox(vb);
  }, [backgroundImage, walls]);
  const [panMode, setPanMode] = useState(false);
  const panState = useRef<{ clientX: number; clientY: number; vb: ViewBox; scale: number } | null>(null);
  const dragState = useRef<{ fittingId: string; type: FittingType; clientX: number; clientY: number; scale: number; origin: Point } | null>(null);
  const [dragPreview, setDragPreview] = useState<{ id: string; position: Point } | null>(null);
  const [alignGuides, setAlignGuides] = useState<{ x?: number; y?: number } | null>(null);
  // Shown while aiming near the halfway point between two fittings, so it's
  // clear WHICH two the centre is being taken from before committing to it.
  const [midpointGuide, setMidpointGuide] = useState<{ a: Point; b: Point; at: Point } | null>(null);
  const openingDragState = useRef<{ openingId: string; wall: WallSegment; width: number } | null>(null);
  const [openingDragPreview, setOpeningDragPreview] = useState<{ id: string; offset: number } | null>(null);
  // Tracks the previous interior-wall tap so a second one landing close in
  // time and space to it can be recognised as a double-click/double-tap
  // (browsers don't reliably surface dblclick for touch on a manually
  // pointer-driven SVG) — see the sketch-interior-wall branch below.
  const lastInteriorTapRef = useRef<{ time: number; point: Point } | null>(null);
  // Same double-tap recognition as above, scoped to "was the last tap this
  // same switch fitting" rather than screen position — opens the add-gang
  // menu on the second tap.
  const lastSwitchTapRef = useRef<{ time: number; fittingId: string } | null>(null);

  const clampSpan = useCallback((v: number) => {
    const bounds = spanBoundsRef.current;
    if (!bounds) return v;
    return Math.min(bounds.max, Math.max(bounds.min, v));
  }, []);

  // Scene units per screen pixel. The viewBox is fitted with the default
  // preserveAspectRatio ("meet"), so the real scale is whichever axis runs out
  // of room first — assuming width made every screen-pixel measurement in this
  // component (snap tolerance, marker sizes, tap slop, pan speed) wrong
  // whenever the canvas was taller in aspect than the view it was showing.
  const px2scene = useCallback(() => {
    const el = svgRef.current;
    if (!el || el.clientWidth === 0 || el.clientHeight === 0) return viewBox.w / 600;
    return Math.max(viewBox.w / el.clientWidth, viewBox.h / el.clientHeight);
  }, [viewBox.w, viewBox.h]);

  const zoomAround = useCallback((center: Point, factor: number) => {
    setViewBox((vb) => {
      const w = clampSpan(vb.w * factor);
      const h = clampSpan(vb.h * factor);
      const ratioW = w / vb.w;
      const ratioH = h / vb.h;
      return {
        x: center.x - (center.x - vb.x) * ratioW,
        y: center.y - (center.y - vb.y) * ratioH,
        w,
        h,
      };
    });
  }, [clampSpan]);

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const svg = svgRef.current;
      if (!svg) return;
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const scene = pt.matrixTransform(ctm.inverse());
      const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
      zoomAround({ x: scene.x, y: scene.y }, factor);
    },
    [zoomAround]
  );

  // React attaches its synthetic wheel handler as a passive listener, so
  // `e.preventDefault()` inside a plain `onWheel` prop silently does
  // nothing — the browser scrolls the page underneath the zoom regardless.
  // A native, explicitly non-passive listener is the only way to actually
  // stop that scroll.
  const touchStateRef = useRef<{ distance: number } | null>(null);
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);
  // Matches the double-tap window/tolerance used by the zoom gesture above, so
  // the two agree on what counts as one gesture.
  const PERIMETER_DOUBLE_TAP_MS = 400;
  const PERIMETER_DOUBLE_TAP_PX = 20;
  const lastPerimeterTapRef = useRef<{ time: number; clientX: number; clientY: number; placed: boolean } | null>(null);
  // Recognises a double-tap on a measurement. Done by hand rather than with
  // onDoubleClick because touch doesn't reliably raise that on an SVG child.
  const lastMeasurementTapRef = useRef<{ key: string; time: number } | null>(null);
  // A tap waiting to find out whether it was really a tap. Set on pointer down
  // in a placement mode, and either committed or discarded on pointer up
  // depending on how far the pointer travelled in between.
  const pendingTapRef = useRef<{ clientX: number; clientY: number } | null>(null);
  // How far a pointer may travel and still count as a tap rather than a drag.
  const TAP_SLOP_PX = 8;

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      // Double-tap zoom (single touch)
      if (e.touches.length === 1) {
        const now = Date.now();
        const lastTap = lastTapRef.current;
        const touch = e.touches[0];
        const isDoubleTap =
          !!lastTap &&
          now - lastTap.time < 400 &&
          Math.hypot(touch.clientX - lastTap.x, touch.clientY - lastTap.y) < 20;
        lastTapRef.current = { time: now, x: touch.clientX, y: touch.clientY };

        if (isDoubleTap) {
          lastTapRef.current = null;
          // Double-tap zooms in/out at that point
          const svg = svgRef.current;
          if (!svg) return;
          const pt = svg.createSVGPoint();
          pt.x = touch.clientX;
          pt.y = touch.clientY;
          const ctm = svg.getScreenCTM();
          if (!ctm) return;
          const scene = pt.matrixTransform(ctm.inverse());
          // Zoom in at 1.4x, or out if already zoomed
          const currentZoom = viewBox.w / 50; // Estimate current zoom level
          const factor = currentZoom > 1.5 ? 1 / 1.4 : 1.4;
          zoomAround({ x: scene.x, y: scene.y }, factor);
        }
        touchStateRef.current = null;
        return;
      }

      // Pinch zoom (two touches)
      if (e.touches.length !== 2) {
        touchStateRef.current = null;
        return;
      }
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const dx = touch1.clientX - touch2.clientX;
      const dy = touch1.clientY - touch2.clientY;
      const distance = Math.hypot(dx, dy);
      touchStateRef.current = { distance };
    },
    [zoomAround, viewBox.w]
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      // Only pinch-zoom with 2 touches
      if (e.touches.length !== 2) {
        touchStateRef.current = null;
        return;
      }
      if (!touchStateRef.current) return;
      e.preventDefault();
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const dx = touch1.clientX - touch2.clientX;
      const dy = touch1.clientY - touch2.clientY;
      const distance = Math.hypot(dx, dy);
      const lastDistance = touchStateRef.current.distance;
      if (lastDistance === 0) return;

      const svg = svgRef.current;
      if (!svg) return;
      const centerX = (touch1.clientX + touch2.clientX) / 2;
      const centerY = (touch1.clientY + touch2.clientY) / 2;
      const pt = svg.createSVGPoint();
      pt.x = centerX;
      pt.y = centerY;
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const scene = pt.matrixTransform(ctm.inverse());
      const factor = lastDistance / distance;
      zoomAround({ x: scene.x, y: scene.y }, factor);
      touchStateRef.current.distance = distance;
    },
    [zoomAround]
  );

  const handleTouchEnd = useCallback(() => {
    touchStateRef.current = null;
  }, []);

  // Where the next tap would land once pulled onto a wall centre, so the
  // tradie can see what they're about to snap to before committing.
  const [edgeSnapPreview, setEdgeSnapPreview] = useState<Point | null>(null);

  // Captured once a curve-mode control-point tap lands, held until the very
  // next tap (the destination corner) consumes it. State rather than a ref
  // so the captured point renders as a marker in the meantime.
  const [pendingCurveControl, setPendingCurveControl] = useState<Point | null>(null);
  useEffect(() => {
    setPendingCurveControl(null);
  }, [mode]);

  // How near the halfway point between two fittings a tap has to be to take
  // it. Generous in screen terms, because it's a point in open space with
  // nothing drawn through it — unlike a wall, there's no line to aim along.
  const MIDPOINT_SNAP_PX = 26;
  // ...but bounded in real terms at both ends. Zoomed out, those screen pixels
  // cover most of a metre and a fitting lands on a centre it was never aimed
  // at; zoomed in they shrink to nothing, and the snap stops helping just when
  // the tradie has zoomed in to be exact.
  const MIDPOINT_SNAP_MIN_M = 0.04;
  const MIDPOINT_SNAP_MAX_M = 0.25;
  const midpointTolerance = useCallback(
    () => Math.min(Math.max(MIDPOINT_SNAP_PX * px2scene(), MIDPOINT_SNAP_MIN_M), MIDPOINT_SNAP_MAX_M),
    [px2scene]
  );

  // Radius in screen pixels a tap may be off by and still grab a wall. Kept in
  // screen space rather than metres so it feels the same at every zoom level.
  const EDGE_SNAP_PX = 20;

  // A hit takes precedence over the orthogonal snap: landing on the plan's own
  // geometry is a more specific intent than keeping the run square.
  const snapToPlanEdge = useCallback(
    (scene: Point): Point | null => (snapToPlan ? snapToPlan(scene, EDGE_SNAP_PX * px2scene()) : null),
    [snapToPlan, px2scene]
  );

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    svg.addEventListener("wheel", handleWheel, { passive: false });
    svg.addEventListener("touchstart", handleTouchStart, { passive: true });
    svg.addEventListener("touchmove", handleTouchMove, { passive: false });
    svg.addEventListener("touchend", handleTouchEnd, { passive: true });
    return () => {
      svg.removeEventListener("wheel", handleWheel);
      svg.removeEventListener("touchstart", handleTouchStart);
      svg.removeEventListener("touchmove", handleTouchMove);
      svg.removeEventListener("touchend", handleTouchEnd);
    };
  }, [handleWheel, handleTouchStart, handleTouchMove, handleTouchEnd]);

  const sceneFromClient = useCallback((clientX: number, clientY: number): Point => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const transformed = pt.matrixTransform(ctm.inverse());
    return { x: transformed.x, y: transformed.y };
  }, []);

  const handleBackgroundPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (dragState.current || openingDragState.current) return;
      // Allow panning in several cases:
      // 1. Pan mode is explicitly enabled
      // 2. In place-fittings mode with no type selected
      // 3. Clicking empty canvas in non-placement modes
      const isActivelyPlacing = (mode === "place-fittings" && selectedFittingType) || mode === "place-photo-points";
      const isSketchingMode = mode === "place-opening" || mode === "sketch-walls" || mode === "sketch-interior-wall";
      if (panMode || mode === "view") {
        panState.current = { clientX: e.clientX, clientY: e.clientY, vb: viewBox, scale: px2scene() };
        (e.target as Element).setPointerCapture(e.pointerId);
        return;
      }
      // Allow panning on empty canvas (SVG background) when not actively placing/sketching
      if (!isActivelyPlacing && !isSketchingMode && e.target === e.currentTarget) {
        panState.current = { clientX: e.clientX, clientY: e.clientY, vb: viewBox, scale: px2scene() };
        (e.target as Element).setPointerCapture(e.pointerId);
        return;
      }
      // Everything below is a placement mode. Start a pan anyway so that
      // press-and-drag moves the plan, and hold the intended tap until the
      // pointer lifts — if it barely moved it was a tap, if it travelled it
      // was a drag and no point should be dropped.
      panState.current = { clientX: e.clientX, clientY: e.clientY, vb: viewBox, scale: px2scene() };
      pendingTapRef.current = { clientX: e.clientX, clientY: e.clientY };
      (e.target as Element).setPointerCapture(e.pointerId);
    },
    [panMode, mode, viewBox, px2scene, selectedFittingType]
  );

  // The actual placement, run on pointer UP rather than DOWN: pressing and
  // dragging has to pan the plan, and that can't be told apart from a tap
  // until the pointer is released.
  const commitBackgroundTap = useCallback(
    (clientX: number, clientY: number, bypassSnap = false) => {
      const scene = sceneFromClient(clientX, clientY);

      // Curve mode's control-point tap: captured raw, no snapping at all —
      // the whole point of it is to bulge away from the plan's own line
      // work, so pulling it back onto that line work would defeat it. Held
      // until the very next tap (the destination corner) consumes it.
      if (
        curveMode &&
        !pendingCurveControl &&
        (mode === "sketch-walls" || mode === "sketch-interior-wall" || mode === "draw-led-strip")
      ) {
        setPendingCurveControl(scene);
        onCurveControlCaptured?.();
        return;
      }

      if (mode === "sketch-walls") {
        // Zooming in is how you read a detailed plan, and double-tap is how
        // you zoom — but pointerdown fires before touchstart, so by the time
        // the zoom handler recognises the gesture this handler has already
        // dropped a point for each tap. Recognise it here too: swallow the
        // second tap and retract the first, leaving a clean zoom.
        const now = Date.now();
        const lastTap = lastPerimeterTapRef.current;
        const isDoubleTap =
          !!lastTap &&
          now - lastTap.time < PERIMETER_DOUBLE_TAP_MS &&
          Math.hypot(clientX - lastTap.clientX, clientY - lastTap.clientY) < PERIMETER_DOUBLE_TAP_PX;
        if (isDoubleTap) {
          lastPerimeterTapRef.current = null;
          if (lastTap.placed) onSketchPointUndo?.();
          return;
        }

        if (isNearFirstPoint(sketchPoints, scene) && onSketchClose) {
          lastPerimeterTapRef.current = { time: now, clientX: clientX, clientY: clientY, placed: false };
          onSketchClose();
          return;
        }
        lastPerimeterTapRef.current = { time: now, clientX: clientX, clientY: clientY, placed: true };
        const last = sketchPoints[sketchPoints.length - 1];
        const onEdge = snapToPlanEdge(scene);
        const point = onEdge ?? (snapWalls && last ? snapOrthogonal(last, scene) : scene);
        onSketchPointAdd?.(point, pendingCurveControl ?? undefined);
        if (pendingCurveControl) setPendingCurveControl(null);
      } else if (mode === "draw-led-strip") {
        // Snap to the plan's line work and square up to the previous point the
        // same way a traced wall does — a strip almost always runs along a
        // cupboard or a wall, so freehand angles are nearly always a misread
        // tap rather than what the tradie meant. Shift bypasses this, same as
        // it bypasses snap on a fitting drag, for the rare point that
        // genuinely isn't on the plan's line work.
        const last = stripDraft[stripDraft.length - 1];
        const onEdge = bypassSnap ? null : snapToPlanEdge(scene);
        onStripPointAdd?.(
          onEdge ?? (!bypassSnap && snapWalls && last ? snapOrthogonal(last, scene) : scene),
          pendingCurveControl ?? undefined
        );
        if (pendingCurveControl) setPendingCurveControl(null);
      } else if (mode === "measure") {
        // Same snap/square-up (and shift bypass) as the LED strip trace above
        // — a hallway or a run between two walls is almost always along the
        // plan's own line work, so this reads a tap the same forgiving way.
        const last = measureDraft[measureDraft.length - 1];
        const onEdge = bypassSnap ? null : snapToPlanEdge(scene);
        onMeasurePointAdd?.(onEdge ?? (!bypassSnap && snapWalls && last ? snapOrthogonal(last, scene) : scene));
      } else if (mode === "calibrate") {
        if (calibratePoints.length < 2) onCalibratePointAdd?.(scene);
      } else if (mode === "sketch-interior-wall") {
        const DOUBLE_TAP_MS = 400;
        const DOUBLE_TAP_TOLERANCE_PX = 20;
        const now = Date.now();
        const lastTap = lastInteriorTapRef.current;
        const isDoubleTap =
          !!lastTap && now - lastTap.time < DOUBLE_TAP_MS && distance(scene, lastTap.point) < DOUBLE_TAP_TOLERANCE_PX * px2scene();
        lastInteriorTapRef.current = { time: now, point: scene };
        if (isDoubleTap) {
          lastInteriorTapRef.current = null;
          onInteriorWallChainEnd?.();
        } else if (!interiorWallDraftStart) {
          onInteriorWallDraftPointAdd?.(snapToPlanEdge(scene) ?? scene);
        } else {
          const onEdge = snapToPlanEdge(scene);
          const end = onEdge ?? (snapInteriorWalls ? snapOrthogonal(interiorWallDraftStart, scene) : scene);
          onInteriorWallSegmentAdd?.(interiorWallDraftStart, end, pendingCurveControl ?? undefined);
          if (pendingCurveControl) setPendingCurveControl(null);
        }
      } else if (mode === "place-opening") {
        const result = nearestWallAndOffset(scene, walls);
        if (result) {
          if (result.wall.curveControl) {
            onOpeningPlaceOnCurveBlocked?.();
          } else {
            onOpeningPlace?.(result.wall.id, result.offset);
          }
        }
      } else if (mode === "pick-measurement-ref") {
        // Background tap = pick a wall or opening edge, but only if the tap
        // actually landed close to one — walls/openings aren't labelled on
        // the plan, so a tap in open space should do nothing.
        const TAP_TOLERANCE_PX = 20;
        const tolerance = TAP_TOLERANCE_PX * px2scene();
        const selectedFitting = fittings.find((f) => f.id === selectedFittingId);
        if (!selectedFitting) return;

        let nearestRef: MeasurementRef | null = null;
        let nearestDistance = Infinity;

        // Check opening edges first (using offset positions to match visual rendering)
        const wallById = new Map(walls.map((w) => [w.id, w]));
        for (const opening of openings) {
          const wall = wallById.get(opening.wallId);
          if (!wall) continue;
          const p1 = pointAtOffset(wall, Math.max(0, opening.offset));
          const p2 = pointAtOffset(wall, Math.min(wallLength(wall), opening.offset + opening.width));

          // Apply same offset as door/window rendering (half wall thickness inward)
          const thickness = wall.kind === "interior" ? wallThickness.interior : wallThickness.exterior;
          const normal = roomFacingNormal(wall, p1, wallsCentroid(walls));
          const p1Offset = { x: p1.x + normal.x * (thickness / 2), y: p1.y + normal.y * (thickness / 2) };
          const p2Offset = { x: p2.x + normal.x * (thickness / 2), y: p2.y + normal.y * (thickness / 2) };

          const d1 = distance(scene, p1Offset);
          const d2 = distance(scene, p2Offset);

          if (d1 < nearestDistance && d1 <= tolerance) {
            nearestDistance = d1;
            nearestRef = { kind: "opening", openingId: opening.id, distance: distance(selectedFitting.position, p1Offset), edge: "start" };
          }
          if (d2 < nearestDistance && d2 <= tolerance) {
            nearestDistance = d2;
            nearestRef = { kind: "opening", openingId: opening.id, distance: distance(selectedFitting.position, p2Offset), edge: "end" };
          }
        }

        // If no opening was close enough, check walls
        if (!nearestRef) {
          let nearestWall: WallSegment | null = null;
          let wallDistance = Infinity;
          for (const wall of walls) {
            const d = perpendicularDistanceToWall(scene, wall);
            if (d < wallDistance) {
              wallDistance = d;
              nearestWall = wall;
            }
          }
          if (nearestWall && wallDistance <= tolerance) {
            nearestRef = { kind: "wall", wallId: nearestWall.id, distance: perpendicularDistanceToWall(selectedFitting.position, nearestWall) };
          }
        }

        // Nothing traced to point at — fall back to the plan's own line work,
        // which on a plan imported without tracing is the only reference there
        // is, and the reason tapping used to do nothing at all here.
        if (!nearestRef) {
          nearestRef = onPickPlanMeasurementRef?.(scene, selectedFitting.position, tolerance) ?? null;
        }

        if (nearestRef) {
          onMeasurementRefPick?.(nearestRef);
        } else {
          // Tapped open space: take it as "never mind" rather than leaving the
          // tradie in a mode nothing appears to get them out of.
          onMeasurementPickCancel?.();
        }
      } else if (mode === "place-fittings" && selectedFittingType) {
        // Alignment applies to every ceiling/surface-mounted fitting (not
        // just downlights) — a smoke alarm or exhaust fan lining up with
        // existing downlights (or each other) is just as useful as
        // downlight-to-downlight rows/columns.
        // A wall-mounted fitting goes on a wall. With walls traced that's the
        // traced geometry; with tracing skipped the plan's own line work is
        // all there is, and its FACE is what a tape measures to.
        // Shift bypasses all of this at placement time too, same as it does
        // for an already-placed fitting being dragged.
        let point: Point;
        if (bypassSnap) {
          point = scene;
        } else if (isSingleWallFitting(selectedFittingType)) {
          point = walls.length > 0 ? snapToNearestWall(scene, walls, openings) : (snapToPlanEdge(scene) ?? scene);
        } else {
          const ceilingPoints = fittings.filter((f) => !isSingleWallFitting(f.type)).map((f) => f.position);
          // Halfway between two fittings beats lining up with one of them: it's
          // a more specific thing to be aiming at, and it's the whole reason
          // for aiming there.
          const mid = findMidpointSnap(scene, ceilingPoints, midpointTolerance());
          point = mid ? mid.position : alignToExistingPoints(scene, ceilingPoints).position;
        }
        onPlaceFitting?.(point, scene);
        setMidpointGuide(null);
      } else if (mode === "place-fittings") {
        onFittingSelect?.(null);
      } else if (mode === "link-switches") {
        onSwitchTap?.(null);
      } else if (mode === "link-data-cabinet") {
        onCabinetTap?.(null);
      } else if (mode === "place-photo-points") {
        onPhotoPointPlace?.(scene, clientX, clientY);
      }
    },
    [
      panMode,
      mode,
      viewBox,
      px2scene,
      sceneFromClient,
      sketchPoints,
      onSketchClose,
      onSketchPointUndo,
      snapWalls,
      snapToPlanEdge,
      midpointTolerance,
      onSketchPointAdd,
      calibratePoints,
      onCalibratePointAdd,
      interiorWallDraftStart,
      onInteriorWallDraftPointAdd,
      onInteriorWallSegmentAdd,
      onInteriorWallChainEnd,
      snapInteriorWalls,
      curveMode,
      pendingCurveControl,
      onCurveControlCaptured,
      onOpeningPlace,
      onOpeningPlaceOnCurveBlocked,
      onMeasurementRefPick,
      onPickPlanMeasurementRef,
      onMeasurementPickCancel,
      onPhotoPointPlace,
      selectedFittingId,
      selectedFittingType,
      onPlaceFitting,
      onFittingSelect,
      onSwitchTap,
      onCabinetTap,
      walls,
      openings,
      fittings,
      measureDraft,
      onMeasurePointAdd,
    ]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (panState.current) {
        const pending = pendingTapRef.current;
        if (pending) {
          // A tap is still in the running. Hold the plan completely still
          // until the pointer has travelled far enough to be a drag —
          // otherwise the shake in an ordinary click pans the plan under the
          // very point being placed.
          const travelled = Math.hypot(e.clientX - pending.clientX, e.clientY - pending.clientY);
          if (travelled <= TAP_SLOP_PX) return;
          // It's a drag. Give up on the tap and rebase the pan to here, so the
          // plan starts moving from where the finger is now instead of jumping
          // by the slop distance the moment the threshold is crossed.
          pendingTapRef.current = null;
          panState.current = { clientX: e.clientX, clientY: e.clientY, vb: viewBox, scale: px2scene() };
          return;
        }
        const { clientX, clientY, vb, scale } = panState.current;
        const dx = (e.clientX - clientX) * scale;
        const dy = (e.clientY - clientY) * scale;
        setViewBox({ ...vb, x: vb.x - dx, y: vb.y - dy });
      } else if (dragState.current) {
        const { fittingId, type, clientX, clientY, scale, origin } = dragState.current;
        const dx = (e.clientX - clientX) * scale;
        const dy = (e.clientY - clientY) * scale;
        const raw = { x: origin.x + dx, y: origin.y + dy };
        let position = raw;
        // Shift bypasses every placement assist (wall snap, align-to-points)
        // for exactly this drag — the tradie's own judgement wins when the
        // snap logic is fighting a position they actually want.
        if (e.shiftKey) {
          setAlignGuides(null);
        } else if (isSingleWallFitting(type)) {
          // Pass dragOrigin to allow snapping to different walls during drag
          position = snapToNearestWall(raw, walls, openings, origin);
          setAlignGuides(null);
        } else {
          const others = fittings.filter((f) => !isSingleWallFitting(f.type) && f.id !== fittingId).map((f) => f.position);
          const aligned = alignToExistingPoints(raw, others);
          position = aligned.position;
          setAlignGuides({ x: aligned.guideX, y: aligned.guideY });
        }
        setDragPreview({ id: fittingId, position });
      } else if (openingDragState.current) {
        const { openingId, wall, width } = openingDragState.current;
        const scene = sceneFromClient(e.clientX, e.clientY);
        const len = wallLength(wall);
        const raw = projectPointOntoWall(scene, wall) - width / 2;
        const offset = Math.max(0, Math.min(Math.max(len - width, 0), raw));
        setOpeningDragPreview({ id: openingId, offset });
      } else if (mode === "place-fittings" && selectedFittingType && !isSingleWallFitting(selectedFittingType)) {
        // Show the halfway point being aimed at, and the two fittings it sits
        // between, before anything is committed. This doubles as the main
        // visual reference for where the pointer is while placing a ceiling
        // fitting, so it stays visible even while Shift is held — only the
        // actual placement (commitBackgroundTap) skips the snap on tap.
        const scene = sceneFromClient(e.clientX, e.clientY);
        const ceilingPoints = fittings.filter((f) => !isSingleWallFitting(f.type)).map((f) => f.position);
        const mid = findMidpointSnap(scene, ceilingPoints, midpointTolerance());
        setMidpointGuide(mid ? { a: mid.a, b: mid.b, at: mid.position } : null);
      } else if (snapToPlan && (mode === "sketch-walls" || mode === "sketch-interior-wall")) {
        // Show what the next tap would grab. On touch this only fires while a
        // finger is down (there's no hover), so the drawn overlay stays the
        // primary cue on a phone and this is a bonus on desktop.
        setEdgeSnapPreview(snapToPlanEdge(sceneFromClient(e.clientX, e.clientY)));
      }
    },
    [walls, openings, fittings, sceneFromClient, snapToPlan, mode, snapToPlanEdge, viewBox, px2scene, selectedFittingType, midpointTolerance]
  );

  const endPan = useCallback(() => {
    panState.current = null;
  }, []);

  const endDrag = useCallback(() => {
    if (dragState.current && dragPreview) {
      // A plain tap-to-select never moved the pointer, so the preview is
      // still exactly the fitting's starting position (pointermove is what
      // updates it — see handlePointerMove above). Feeding that through as a
      // move anyway made SetoutPlan's handleFittingDrag re-run the wall-mount
      // auto-rotate on every select, which can silently flip a fitting to
      // face a different nearby wall without it ever being touched.
      const moved = dragPreview.position.x !== dragState.current.origin.x || dragPreview.position.y !== dragState.current.origin.y;
      if (moved) onFittingDrag?.(dragState.current.fittingId, dragPreview.position);
    }
    if (openingDragState.current && openingDragPreview) {
      onOpeningDrag?.(openingDragState.current.openingId, openingDragPreview.offset);
    }
    dragState.current = null;
    openingDragState.current = null;
    setDragPreview(null);
    setOpeningDragPreview(null);
    setAlignGuides(null);
  }, [dragPreview, onFittingDrag, openingDragPreview, onOpeningDrag]);

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const pending = pendingTapRef.current;
      pendingTapRef.current = null;
      if (pending) {
        const travelled = Math.hypot(e.clientX - pending.clientX, e.clientY - pending.clientY);
        // Barely moved: the tradie meant to place something here. Moved: they
        // were dragging the plan around, so leave the canvas alone.
        if (travelled <= TAP_SLOP_PX) commitBackgroundTap(pending.clientX, pending.clientY, e.shiftKey);
      }
      endPan();
      endDrag();
    },
    [endPan, endDrag, commitBackgroundTap]
  );

  const handleFittingPointerDown = useCallback(
    (e: React.PointerEvent<SVGGElement>, fitting: SetoutFitting) => {
      e.stopPropagation();
      if (fitting.type === "switch" && onSwitchDoubleTap) {
        const DOUBLE_TAP_MS = 400;
        const now = Date.now();
        const lastTap = lastSwitchTapRef.current;
        if (lastTap && lastTap.fittingId === fitting.id && now - lastTap.time < DOUBLE_TAP_MS) {
          lastSwitchTapRef.current = null;
          onSwitchDoubleTap(fitting, { x: e.clientX, y: e.clientY });
          return;
        }
        lastSwitchTapRef.current = { time: now, fittingId: fitting.id };
      }
      if (mode === "link-switches") {
        if (fitting.type === "switch") {
          onSwitchTap?.(fitting.id === linkActiveSwitchId ? null : fitting.id);
        } else if (linkActiveSwitchId) {
          onLinkTargetTap?.(fitting.id);
        }
        return;
      }
      if (mode === "link-data-cabinet") {
        if (fitting.type === "data_cabinet") {
          onCabinetTap?.(fitting.id === linkActiveCabinetId ? null : fitting.id);
        } else if (fitting.type === "data" && linkActiveCabinetId) {
          onDataLinkTargetTap?.(fitting.id);
        }
        return;
      }
      if (mode === "select-multiple") {
        onMultiSelectToggle?.(fitting.id);
        return;
      }
      if (mode === "pick-measurement-ref") {
        if (fitting.id === selectedFittingId) return;
        const selectedFitting = fittings.find((f) => f.id === selectedFittingId);
        if (!selectedFitting) return;
        onMeasurementRefPick?.({ kind: "fitting", fittingId: fitting.id, distance: distance(selectedFitting.position, fitting.position) });
        return;
      }
      onFittingSelect?.(fitting.id);
      if (mode !== "place-fittings" || panMode || fitting.specs.locked) return;
      dragState.current = {
        fittingId: fitting.id,
        type: fitting.type,
        clientX: e.clientX,
        clientY: e.clientY,
        scale: px2scene(),
        origin: fitting.position,
      };
      setDragPreview({ id: fitting.id, position: fitting.position });
      (e.target as Element).setPointerCapture(e.pointerId);
    },
    [
      mode,
      panMode,
      px2scene,
      onFittingSelect,
      linkActiveSwitchId,
      onSwitchTap,
      onLinkTargetTap,
      onSwitchDoubleTap,
      linkActiveCabinetId,
      onCabinetTap,
      onDataLinkTargetTap,
      selectedFittingId,
      fittings,
      onMeasurementRefPick,
    ]
  );

  // Grabbing an already-placed door/window slides it along its own wall
  // instead of the background tap handler treating the same spot as
  // "place a new opening here" — stopPropagation keeps the two from firing
  // together, same pattern as handleFittingPointerDown.
  const handleOpeningPointerDown = useCallback(
    (e: React.PointerEvent, opening: WallOpening, wall: WallSegment) => {
      if (mode !== "place-opening") return;
      e.stopPropagation();
      openingDragState.current = { openingId: opening.id, wall, width: opening.width };
      setOpeningDragPreview({ id: opening.id, offset: opening.offset });
      (e.target as Element).setPointerCapture(e.pointerId);
    },
    [mode]
  );

  // Selecting (not deleting) a wall is not destructive, so unlike the old
  // delete-on-tap behaviour there's no DOM-node-removed-mid-gesture hazard
  // here — a plain pointerdown is fine.
  const handleWallPointerDown = useCallback(
    (e: React.PointerEvent, wallId: string) => {
      if (mode !== "erase-wall") return;
      e.stopPropagation();
      onWallTap?.(wallId);
    },
    [mode, onWallTap]
  );

  const gridLines = useMemo(() => {
    const step = 1;
    const startX = Math.floor(viewBox.x / step) * step;
    const endX = viewBox.x + viewBox.w;
    const startY = Math.floor(viewBox.y / step) * step;
    const endY = viewBox.y + viewBox.h;
    const vLines: number[] = [];
    for (let x = startX; x <= endX; x += step) vLines.push(x);
    const hLines: number[] = [];
    for (let y = startY; y <= endY; y += step) hLines.push(y);
    return { vLines, hLines, startX, endX, startY, endY };
  }, [viewBox]);

  const wallCentroid = useMemo(() => wallsCentroid(walls), [walls]);

  // While an opening is being dragged, its offset in the render data tracks
  // the live drag preview rather than the last-saved value — so the wall
  // gap and door/window glyph visibly slide with the pointer, not just jump
  // once the drag ends.
  const effectiveOpenings = useMemo(() => {
    if (!openingDragPreview) return openings;
    return openings.map((o) => (o.id === openingDragPreview.id ? { ...o, offset: openingDragPreview.offset } : o));
  }, [openings, openingDragPreview]);

  // Cuts each wall into the solid sub-segments either side of its openings
  // (a door/window leaves a visible gap in the wall line, drawn separately
  // below) — computed once per walls/openings change rather than inline in
  // JSX since every wall needs its own sorted-by-offset pass.
  const wallRenderData = useMemo(() => {
    return walls.map((wall) => {
      const wallOpenings = effectiveOpenings.filter((o) => o.wallId === wall.id).sort((a, b) => a.offset - b.offset);
      const len = wallLength(wall);
      const segments: { from: Point; to: Point }[] = [];
      let cursor = 0;
      for (const o of wallOpenings) {
        const start = Math.max(0, Math.min(len, o.offset));
        const end = Math.max(0, Math.min(len, o.offset + o.width));
        if (start > cursor) segments.push({ from: pointAtOffset(wall, cursor), to: pointAtOffset(wall, start) });
        cursor = Math.max(cursor, end);
      }
      if (cursor < len) segments.push({ from: pointAtOffset(wall, cursor), to: pointAtOffset(wall, len) });
      return { wall, segments, openings: wallOpenings };
    });
  }, [walls, effectiveOpenings]);

  const visibleFittings = useMemo(() => {
    if (!layerVisibility) return fittings;
    return fittings.filter((f) => layerVisibility[f.category]);
  }, [fittings, layerVisibility]);

  const photoGalleries = useMemo(() => {
    if (!layerVisibility?.photoPoints) return [];
    return groupPhotosByPosition(photoPoints);
  }, [photoPoints, layerVisibility]);

  const lightPools = useMemo(() => {
    if (!layerVisibility?.coverage) return [];
    const downlights = fittings.filter((f) => f.type === "downlight");
    // A twin downlight is two real lamps, each throwing its own pool from its
    // own offset position — not one pool centred on the fixture (see
    // downlightLampPositions). Flattened here so overlap is checked lamp
    // against lamp, not fixture against fixture.
    const lampPools = downlights.flatMap((f) => {
      const pos = dragPreview?.id === f.id ? dragPreview.position : f.position;
      // A downlight placed before ceiling height was a real per-fitting spec
      // has no mountingHeight of its own — fall back to this job's ceiling
      // height default rather than the hardcoded 2.4m inside lightPoolRadius,
      // so an existing downlight's circle tracks a ceiling-height default
      // the tradie sets after the fact just like a newly placed one would.
      const specs = f.specs.mountingHeight != null ? f.specs : { ...f.specs, mountingHeight: ceilingHeightDefaultM };
      const radius = lightPoolRadius(specs);
      return downlightLampPositions({ position: pos, specs: f.specs }).map((lampPosition, i) => ({
        id: `${f.id}-${i}`,
        fittingId: f.id,
        position: lampPosition,
        radius,
      }));
    });
    return lampPools.map((pool) => {
      // A twin's own two lamps sit deliberately close together — that's not
      // a placement mistake, so only another fixture's lamp can trigger the
      // overlap warning, never a fixture's own sibling lamp.
      const overlapsAnother = lampPools.some(
        (other) => other.fittingId !== pool.fittingId && poolsSignificantlyOverlap(pool.position, pool.radius, other.position, other.radius)
      );
      return { ...pool, overlapsAnother };
    });
  }, [fittings, layerVisibility?.coverage, dragPreview, ceilingHeightDefaultM]);

  // Same overlay toggle as the downlight light pools, since it's the same
  // "how far does this actually reach" concept — but unlike a light pool,
  // two APs' circles overlapping is normal (that's roaming coverage, not a
  // mistake), so this deliberately has no overlap-warning styling.
  const wifiPools = useMemo(() => {
    if (!layerVisibility?.coverage) return [];
    return fittings
      .filter((f) => f.type === "wifi_ap")
      .map((f) => ({
        id: f.id,
        position: dragPreview?.id === f.id ? dragPreview.position : f.position,
        radius: f.specs.wifiRangeM ?? DEFAULT_WIFI_RANGE_M,
      }));
  }, [fittings, layerVisibility?.coverage, dragPreview]);

  // Each gang of a switch plate is its own loop-in chain, not a star — the
  // cable runs switch -> first light -> second light -> ... in tap order
  // within that gang, same as a real 2-core-and-earth loop threaded through
  // each fitting, not a separate home-run from the switch to every light.
  // A 2-gang plate draws two independent chains leaving the same switch
  // icon. A light is automatically N-way the moment N different switches
  // each independently link it (see wayCountForTarget) — no separate
  // switch-to-switch step, so a gang only ever targets lights, never
  // another switch.
  const switchLinks = useMemo(() => {
    if (layerVisibility && !layerVisibility.switches) return [];
    const switches = fittings.filter((f) => f.type === "switch");
    const links: { key: string; switchPos: Point; targetPos: Point; active: boolean; wayCount: number }[] = [];
    for (const sw of switches) {
      const swPos = dragPreview?.id === sw.id ? dragPreview.position : sw.position;
      const gangs = gangsFor(sw);
      gangs.forEach((gang, gangIndex) => {
        let fromPos = swPos;
        let fromId = sw.id;
        for (const targetId of gang) {
          const target = fittings.find((f) => f.id === targetId);
          // Leftover switch ids from the older chain-based model don't draw
          // as a link target any more — a gang only points at lights now.
          if (!target || target.type === "switch") continue;
          const targetPos = dragPreview?.id === target.id ? dragPreview.position : target.position;
          links.push({
            key: `${sw.id}-g${gangIndex}-${fromId}-${targetId}`,
            switchPos: fromPos,
            targetPos,
            active: sw.id === linkActiveSwitchId && gangIndex === linkActiveGangIndex,
            wayCount: wayCountForTarget(targetId, switches),
          });
          fromPos = targetPos;
          fromId = targetId;
        }
      });
    }
    return links;
  }, [fittings, layerVisibility?.switches, dragPreview, linkActiveSwitchId, linkActiveGangIndex]);

  // Data cabling is always a home run, never a loop-in chain — no
  // gangs/N-way concept, just "does this point's dataCabinetId match this
  // cabinet". Far simpler than switchLinks above.
  const dataCabinetLinks = useMemo(() => {
    if (layerVisibility && !layerVisibility.data) return [];
    const cabinets = fittings.filter((f) => f.type === "data_cabinet");
    const links: { key: string; cabinetPos: Point; targetPos: Point; active: boolean }[] = [];
    for (const cabinet of cabinets) {
      const cabinetPos = dragPreview?.id === cabinet.id ? dragPreview.position : cabinet.position;
      for (const f of fittings) {
        if (f.type !== "data" || f.specs.dataCabinetId !== cabinet.id) continue;
        const targetPos = dragPreview?.id === f.id ? dragPreview.position : f.position;
        links.push({
          key: `${cabinet.id}-${f.id}`,
          cabinetPos,
          targetPos,
          active: cabinet.id === linkActiveCabinetId,
        });
      }
    }
    return links;
  }, [fittings, layerVisibility?.data, dragPreview, linkActiveCabinetId]);

  // Selecting any one member of a 2-way/3-way/4-way run — a switch's active
  // gang (while linking) or a light (its usual selection elsewhere) —
  // lights up every other switch and light wired into that same run on the
  // canvas itself, not just in the side panel list. runGroupFittingIds
  // follows the whole connected run (an indirect chain like switch A -
  // light1, switch B - light1 & light2, switch C - light2 still lights up
  // as one group), but — passing linkActiveGangIndex — never crosses into
  // an unrelated gang on the same multi-gang plate. Selecting a data
  // cabinet or one of its points highlights that simpler one-to-many group
  // the same way.
  const selectionGroupIds = useMemo(() => {
    const triggerId = mode === "link-switches" ? linkActiveSwitchId : mode === "link-data-cabinet" ? linkActiveCabinetId : selectedFittingId;
    if (!triggerId) return new Set<string>();
    const triggerFitting = fittings.find((f) => f.id === triggerId);
    if (triggerFitting && (triggerFitting.type === "data_cabinet" || triggerFitting.type === "data")) {
      const cabinetId = triggerFitting.type === "data_cabinet" ? triggerFitting.id : triggerFitting.specs.dataCabinetId;
      if (!cabinetId) return new Set<string>();
      const group = new Set<string>([cabinetId]);
      for (const f of fittings) {
        if (f.type === "data" && f.specs.dataCabinetId === cabinetId) group.add(f.id);
      }
      return group;
    }
    const switches = fittings.filter((f) => f.type === "switch");
    return runGroupFittingIds(triggerId, switches, mode === "link-switches" ? linkActiveGangIndex : undefined);
  }, [mode, linkActiveSwitchId, linkActiveGangIndex, linkActiveCabinetId, selectedFittingId, fittings]);

  const measurementLines = useMemo(() => {
    if (!layerVisibility?.measurements) return [];
    const wallById = new Map(walls.map((w) => [w.id, w]));
    const fittingById = new Map(fittings.map((f) => [f.id, f]));
    const openingById = new Map(openings?.map((o) => [o.id, o]) ?? []);
    const lines: {
      key: string;
      from: Point;
      to: Point;
      label: string;
      note?: string;
      // Carried so a tap on the line knows which measurement of which fitting
      // it belongs to, rather than working it back out from geometry.
      fittingId: string;
      slot: "refA" | "refB";
    }[] = [];
    // visibleFittings, not the raw fittings list — a fitting whose category
    // layer is toggled off should have its measurement line disappear too,
    // otherwise a hidden GPO still leaves a dangling wall-measurement line
    // with nothing visibly attached to it.
    for (const f of visibleFittings) {
      if (!f.measurement_lock) continue;
      const dragging = dragPreview?.id === f.id;
      const pos = dragging ? dragPreview.position : f.position;
      // While dragging, show what the measurement WILL be at the position
      // under the finger, not what it was before the drag started.
      const lock = (dragging ? measurementPreviewFor?.(f, pos) : null) ?? f.measurement_lock;
      const slotted = ([["refA", lock.refA], ["refB", lock.refB]] as const).filter(
        (entry): entry is readonly ["refA" | "refB", MeasurementRef] => !!entry[1]
      );
      for (const [slot, ref] of slotted) {
        let to: Point | null = null;
        if (ref.kind === "wall") {
          const wall = wallById.get(ref.wallId);
          if (!wall) continue;
          to = closestPointOnWall(pos, wall);
        } else if (ref.kind === "opening") {
          const opening = openingById.get(ref.openingId);
          if (!opening) continue;
          const wall = wallById.get(opening.wallId);
          if (!wall) continue;
          const len = wallLength(wall);
          const edgeOffset = ref.edge === "start" ? opening.offset : Math.min(len, opening.offset + opening.width);
          let edgePoint = pointAtOffset(wall, edgeOffset);
          // Apply same offset as door/window rendering
          const thickness = wall.kind === "interior" ? wallThickness.interior : wallThickness.exterior;
          const normal = roomFacingNormal(wall, edgePoint, wallsCentroid(walls));
          to = { x: edgePoint.x + normal.x * (thickness / 2), y: edgePoint.y + normal.y * (thickness / 2) };
        } else if (ref.kind === "stroke") {
          // A line on the imported drawing: the point it was measured to was
          // frozen when the fitting was placed, because the drawing can't move.
          to = ref.point;
        } else {
          const other = fittingById.get(ref.fittingId);
          if (!other) continue;
          to = dragPreview?.id === other.id ? dragPreview.position : other.position;
        }
        const label = formatMm(ref.distance);
        const refKey = measurementRefId(ref);
        lines.push({ key: `${f.id}-${ref.kind}-${refKey}`, from: pos, to, label, note: lock.note, fittingId: f.id, slot });
      }
    }
    return lines;
  }, [visibleFittings, walls, openings, layerVisibility?.measurements, dragPreview, measurementPreviewFor, wallThickness]);

  /**
   * Where each measurement's label goes, nudged clear of the others.
   *
   * Labels sit at the middle of their line, and fittings set out in a row all
   * measure to the same wall — so their labels land at the same height and
   * print straight over each other. Two overlapping numbers don't read as a
   * mess, they read as one wrong number: 2794 and 3298 on top of each other
   * look exactly like a plausible 27943298.
   *
   * Colliding labels are pushed perpendicular to their own measurement line,
   * so a label stays visibly attached to the run it belongs to.
   */
  const measurementLabels = useMemo(() => {
    const scale = px2scene();
    const fontSize = 11 * scale;
    const lineHeight = fontSize * 1.35;
    // Rough box for the text; the font is proportional, so this only has to be
    // close enough to keep two labels from touching.
    const widthOf = (text: string) => text.length * fontSize * 0.62;

    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const overlaps = (a: { x: number; y: number; w: number; h: number }) =>
      placed.some(
        (b) =>
          Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h
      );

    return measurementLines.map((line) => {
      const midX = (line.from.x + line.to.x) / 2;
      const midY = (line.from.y + line.to.y) / 2;
      const dx = line.to.x - line.from.x;
      const dy = line.to.y - line.from.y;
      const len = Math.hypot(dx, dy) || 1;
      // Perpendicular to the measurement, so the label moves away from its
      // neighbours without drifting off its own line.
      const nx = -dy / len;
      const ny = dx / len;
      const w = widthOf(line.label);
      const h = lineHeight;

      let best = { x: midX, y: midY };
      // Alternate above and below, widening each time, and take the first spot
      // that's clear. Six steps is enough for the densest run of downlights;
      // beyond that the label stays put rather than flying off somewhere
      // unrelated to its own line.
      for (let step = 0; step <= 6; step++) {
        for (const dir of step === 0 ? [0] : [1, -1]) {
          const off = step * lineHeight * dir;
          const candidate = { x: midX + nx * off, y: midY + ny * off, w, h };
          if (!overlaps(candidate)) {
            placed.push(candidate);
            return { ...line, labelX: candidate.x, labelY: candidate.y };
          }
        }
      }
      placed.push({ x: best.x, y: best.y, w, h });
      return { ...line, labelX: best.x, labelY: best.y };
    });
  }, [measurementLines, px2scene]);

  // Tell the owner which part of the plan is on screen, once the view has
  // stopped moving. Deliberately trailing-only: re-rendering a PDF mid-pinch
  // would fight the gesture, and the base image covers the interim.
  useEffect(() => {
    if (!onViewSettled) return;
    const id = window.setTimeout(() => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return;
      // The viewBox is NOT what's on screen. With the default
      // preserveAspectRatio ("xMidYMid meet") the viewBox is scaled to fit
      // inside the element, so whichever axis has room to spare shows MORE
      // scene than the viewBox asks for — and content out there is still
      // drawn. Reporting the raw viewBox meant the re-render stopped short of
      // the edges of what the tradie could actually see.
      const scale = Math.min(rect.width / viewBox.w, rect.height / viewBox.h);
      const visibleW = rect.width / scale;
      const visibleH = rect.height / scale;
      onViewSettled({
        x: viewBox.x - (visibleW - viewBox.w) / 2,
        y: viewBox.y - (visibleH - viewBox.h) / 2,
        w: visibleW,
        h: visibleH,
        screenWidth: rect.width,
      });
      // Long enough that a pinch or a flick of the wheel doesn't kick off a
      // render on every intermediate frame — the re-render only happens once
      // the tradie has actually settled on a view.
    }, 260);
    return () => window.clearTimeout(id);
  }, [viewBox, onViewSettled]);

  // Icons are drawn at a constant SCREEN size (ICON_SCREEN_PX) so they don't
  // vanish when the tradie zooms in on detail. Zoomed the other way — out
  // far enough to see a whole house — that "constant on screen" becomes huge
  // in plan terms: icons overlap each other, and a wall-mounted symbol's
  // offset into the room (offsetSymbolIntoRoom, a fixed few cm — real wall
  // thickness, not something that can just be made bigger) is dwarfed by an
  // icon many times that size, so it visually drifts off its wall. Capping
  // the icon's real-world footprint lets it keep its constant screen size at
  // normal zoom (where that cap is never reached) but shrink like everything
  // else on the plan once zoomed out past MAX_ICON_SCENE_M. A real GPO/switch
  // plate is roughly 100mm; 200mm keeps the drafting convention of drawing
  // symbols oversized for legibility without growing so far past the wall
  // offset that it visibly floats off the wall.
  const MAX_ICON_SCENE_M = 0.2;
  const iconScale = Math.min(ICON_SCREEN_PX * px2scene(), MAX_ICON_SCENE_M) / 24;
  const cursorClass = panMode || mode === "view" ? "cursor-grab active:cursor-grabbing" : "cursor-crosshair";

  return (
    <div className={cn("relative h-full w-full overflow-hidden rounded-xl border border-border bg-secondary/40", className)}>
      <svg
        ref={svgRef}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
        className={cn("h-full w-full touch-none select-none", cursorClass)}
        onPointerDown={handleBackgroundPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {backgroundImage && (
          <image href={backgroundImage.href} x={0} y={0} width={backgroundImage.width} height={backgroundImage.height} />
        )}
        {backgroundTile && (
          // Sits directly over the base image at the same scene coordinates,
          // so the swap is invisible apart from the detail sharpening up.
          <image
            href={backgroundTile.href}
            x={backgroundTile.x}
            y={backgroundTile.y}
            width={backgroundTile.width}
            height={backgroundTile.height}
            pointerEvents="none"
          />
        )}

        {/* No grid over a plan — the drawing has its own linework, and a
            second set of lines on top just competes with it. On a blank
            canvas (drawing on site, no plan) it's the only spatial reference
            there is, so it stays. */}
        {!backgroundImage && (
          <g className="text-border">
            {gridLines.vLines.map((x) => (
              <line key={`v${x}`} x1={x} y1={gridLines.startY} x2={x} y2={gridLines.endY} stroke="currentColor" strokeOpacity={0.5} vectorEffect="non-scaling-stroke" />
            ))}
            {gridLines.hLines.map((y) => (
              <line key={`h${y}`} x1={gridLines.startX} y1={y} x2={gridLines.endX} y2={y} stroke="currentColor" strokeOpacity={0.5} vectorEffect="non-scaling-stroke" />
            ))}
          </g>
        )}

        <g>
          {wallRenderData.map(({ wall, segments }) => {
            const erasable = mode === "erase-wall" && wall.kind === "interior";
            const selected = erasable && wall.id === selectedEraseWallId;
            return (
              <g
                key={wall.id}
                className={
                  selected
                    ? "text-destructive cursor-pointer"
                    : erasable
                      ? "text-destructive/45 cursor-pointer"
                      : backgroundImage
                        // Over a reference photo, black wall lines vanish
                        // against the photo's own (often black) linework —
                        // a colour the photo won't contain keeps the traced
                        // walls readable.
                        ? wall.kind === "interior"
                          ? "text-blue-600/70"
                          : "text-blue-600"
                        : wall.kind === "interior"
                          ? "text-foreground/60"
                          : "text-foreground"
                }
                onPointerDown={erasable ? (e) => handleWallPointerDown(e, wall.id) : undefined}
              >
                {segments.map((seg, i) => (
                  <g key={i}>
                    {erasable && (
                      // Hit-stroke sized off the wall's own real thickness
                      // (erasable walls are always "interior") plus a fixed
                      // on-screen margin, so thicker walls get a proportionally
                      // fatter tap zone rather than every wall sharing one
                      // flat number. Selecting isn't destructive (see
                      // onWallTap), so being generous with the margin costs
                      // nothing — a mis-tap between two close walls just
                      // selects the wrong one, easy to correct.
                      <WallStroke
                        seg={seg}
                        curveControl={wall.curveControl}
                        stroke="transparent"
                        strokeWidth={wallThickness.interior + 90 * px2scene()}
                        vectorEffect="non-scaling-stroke"
                        pointerEvents="stroke"
                      />
                    )}
                    {selected && (
                      // Halo under the selected wall, sized off the wall's
                      // own real thickness (erasable walls are always
                      // "interior") plus a small fixed on-screen margin so
                      // it still reads as a glow around the wall rather than
                      // being swallowed by the solid line drawn on top.
                      <WallStroke
                        seg={seg}
                        curveControl={wall.curveControl}
                        stroke="currentColor"
                        strokeOpacity={0.35}
                        strokeWidth={wallThickness.interior + 14 * px2scene()}
                        strokeLinecap="round"
                        vectorEffect="non-scaling-stroke"
                        pointerEvents="none"
                      />
                    )}
                    <WallStroke
                      seg={seg}
                      curveControl={wall.curveControl}
                      stroke="currentColor"
                      strokeWidth={wall.kind === "interior" ? wallThickness.interior : wallThickness.exterior}
                      strokeLinecap="square"
                      pointerEvents={erasable ? "none" : undefined}
                    />
                  </g>
                ))}
              </g>
            );
          })}
          {wallRenderData.flatMap(({ wall, openings: wallOpenings }) =>
            wallOpenings.map((o) => {
              const len = wallLength(wall);
              const p1 = pointAtOffset(wall, Math.max(0, o.offset));
              const p2 = pointAtOffset(wall, Math.min(len, o.offset + o.width));
              // Offset door/window hinge point inward by half wall thickness so it sits
              // at the edge of the wall stroke (not centerline), making it clear the
              // door/window is inside the wall opening, not on top of the wall.
              const thickness = wall.kind === "interior" ? wallThickness.interior : wallThickness.exterior;
              const normal = roomFacingNormal(wall, p1, wallCentroid);
              const p1Offset = { x: p1.x + normal.x * (thickness / 2), y: p1.y + normal.y * (thickness / 2) };
              const p2Offset = { x: p2.x + normal.x * (thickness / 2), y: p2.y + normal.y * (thickness / 2) };
              const draggable = mode === "place-opening";
              // A transparent, much fatter line sitting over the same span as
              // the visible glyph — the actual door/window line is only 1px
              // wide, far too thin to reliably grab on a phone screen.
              const hitStroke = (
                <line
                  x1={p1Offset.x}
                  y1={p1Offset.y}
                  x2={p2Offset.x}
                  y2={p2Offset.y}
                  stroke="transparent"
                  strokeWidth={22 * px2scene()}
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="stroke"
                />
              );
              if (o.kind === "window") {
                return (
                  <g
                    key={o.id}
                    className={draggable ? "cursor-grab active:cursor-grabbing" : undefined}
                    onPointerDown={draggable ? (e) => handleOpeningPointerDown(e, o, wall) : undefined}
                  >
                    {hitStroke}
                    <line
                      x1={p1Offset.x}
                      y1={p1Offset.y}
                      x2={p2Offset.x}
                      y2={p2Offset.y}
                      stroke="currentColor"
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                      className="text-sky-600"
                    />
                  </g>
                );
              }
              if (o.kind === "sliding_door") {
                // Sliding door: two parallel lines showing the door slides along the wall
                // Top line marks the closed position, bottom marks the open position
                const wallDir = { x: wall.end.x - wall.start.x, y: wall.end.y - wall.start.y };
                const wallLen = Math.hypot(wallDir.x, wallDir.y) || 1;
                const wallUnit = { x: wallDir.x / wallLen, y: wallDir.y / wallLen };
                const slideEnd = { x: p1Offset.x + wallUnit.x * o.width, y: p1Offset.y + wallUnit.y * o.width };
                return (
                  <g
                    key={o.id}
                    className={cn("text-amber-600", draggable && "cursor-grab active:cursor-grabbing")}
                    onPointerDown={draggable ? (e) => handleOpeningPointerDown(e, o, wall) : undefined}
                  >
                    {hitStroke}
                    <line x1={p1Offset.x} y1={p1Offset.y} x2={p2Offset.x} y2={p2Offset.y} stroke="currentColor" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                    <line x1={p1Offset.x} y1={p1Offset.y} x2={slideEnd.x} y2={slideEnd.y} stroke="currentColor" strokeWidth={1} strokeDasharray="0.06 0.06" vectorEffect="non-scaling-stroke" />
                  </g>
                );
              }
              // Door: a leaf line from the hinge (p1) swinging into the room,
              // plus a quarter-circle arc tracing the leaf's sweep back to
              // the far jamb (p2) — the standard architectural door glyph.
              // swingFlipped negates the room-facing normal to swing the
              // leaf out instead, for the doors where the default guess
              // (always inward) doesn't match reality.
              const roomNormal = roomFacingNormal(wall, p1Offset, wallCentroid);
              const doorNormal = o.swingFlipped ? { x: -roomNormal.x, y: -roomNormal.y } : roomNormal;
              const openEnd = { x: p1Offset.x + doorNormal.x * o.width, y: p1Offset.y + doorNormal.y * o.width };
              return (
                <g
                  key={o.id}
                  className={cn("text-foreground/70", draggable && "cursor-grab active:cursor-grabbing")}
                  onPointerDown={draggable ? (e) => handleOpeningPointerDown(e, o, wall) : undefined}
                >
                  {hitStroke}
                  <line x1={p1Offset.x} y1={p1Offset.y} x2={openEnd.x} y2={openEnd.y} stroke="currentColor" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                  {/* Flipping the normal mirrors openEnd across the wall
                      line, which also flips the arc's rotational sense —
                      the sweep flag has to flip along with it or the arc
                      bows the wrong way. */}
                  <path
                    d={`M ${openEnd.x} ${openEnd.y} A ${o.width} ${o.width} 0 0 ${o.swingFlipped ? 0 : 1} ${p2Offset.x} ${p2Offset.y}`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1}
                    strokeDasharray="0.06 0.06"
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              );
            })
          )}
        </g>

        {sketchPoints.length > 0 && (
          <g className="text-primary">
            <path
              d={pathToSvgD(sketchPoints)}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeDasharray="0.15 0.1"
              vectorEffect="non-scaling-stroke"
            />
            {sketchPoints.map((p, i) => (
              <circle
                key={i}
                cx={p.x}
                cy={p.y}
                r={CORNER_MARKER_PX * px2scene()}
                fill="currentColor"
                stroke="hsl(var(--background))"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
        )}

        {pendingCurveControl && (
          // Distinct colour from the plain corner dots — this is the
          // captured curve control point, waiting on the next tap (the
          // destination corner) to consume it.
          <circle
            cx={pendingCurveControl.x}
            cy={pendingCurveControl.y}
            r={CORNER_MARKER_PX * px2scene()}
            className="fill-amber-500"
            stroke="hsl(var(--background))"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        )}

        {midpointGuide && (
          // The pair it's centred between, and the centre itself.
          <g pointerEvents="none" className="text-primary">
            <line
              x1={midpointGuide.a.x}
              y1={midpointGuide.a.y}
              x2={midpointGuide.b.x}
              y2={midpointGuide.b.y}
              stroke="currentColor"
              strokeOpacity={0.5}
              strokeWidth={1}
              strokeDasharray="0.05 0.05"
              vectorEffect="non-scaling-stroke"
            />
            {[midpointGuide.a, midpointGuide.b].map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={3 * px2scene()} fill="currentColor" fillOpacity={0.5} />
            ))}
            <circle
              cx={midpointGuide.at.x}
              cy={midpointGuide.at.y}
              r={7 * px2scene()}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
            <circle cx={midpointGuide.at.x} cy={midpointGuide.at.y} r={1.5 * px2scene()} fill="currentColor" />
          </g>
        )}

        {edgeSnapPreview && (
          // Ring showing the line the next tap will grab.
          <g pointerEvents="none">
            <circle
              cx={edgeSnapPreview.x}
              cy={edgeSnapPreview.y}
              r={10 * px2scene()}
              fill="rgb(6 182 212 / 0.25)"
              stroke="rgb(6 182 212)"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
            <circle cx={edgeSnapPreview.x} cy={edgeSnapPreview.y} r={2.5 * px2scene()} fill="rgb(6 182 212)" />
          </g>
        )}

        {calibratePoints.length > 0 && (
          <g className="text-primary">
            {calibratePoints.length === 2 && (
              <line
                x1={calibratePoints[0].x}
                y1={calibratePoints[0].y}
                x2={calibratePoints[1].x}
                y2={calibratePoints[1].y}
                stroke="currentColor"
                strokeWidth={2}
                strokeDasharray="6 4"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {calibratePoints.map((p, i) => (
              <circle
                key={i}
                cx={p.x}
                cy={p.y}
                r={9 * px2scene()}
                fill="currentColor"
                stroke="hsl(var(--background))"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
        )}

        {interiorWallDraftStart && (
          <circle
            cx={interiorWallDraftStart.x}
            cy={interiorWallDraftStart.y}
            r={9 * px2scene()}
            className="text-primary"
            fill="currentColor"
            stroke="hsl(var(--background))"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        )}

        {lightPools.length > 0 && (
          <g>
            {lightPools.map((pool) => (
              <circle
                key={pool.id}
                cx={pool.position.x}
                cy={pool.position.y}
                r={pool.radius}
                className={pool.overlapsAnother ? "fill-warning/15 stroke-warning" : "fill-primary/10 stroke-primary/40"}
                strokeWidth={1}
                strokeDasharray="0.1 0.08"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
        )}

        {/* A different colour (accent, not primary) and a longer dash than a
            light pool, so the two overlays read apart at a glance — and no
            overlap-warning styling, since two APs' circles overlapping is
            normal roaming coverage, not a placement mistake like a doubled-up
            downlight. */}
        {wifiPools.length > 0 && (
          <g>
            {wifiPools.map((pool) => (
              <circle
                key={pool.id}
                cx={pool.position.x}
                cy={pool.position.y}
                r={pool.radius}
                className="fill-accent/10 stroke-accent/60"
                strokeWidth={1}
                strokeDasharray="0.3 0.2"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
        )}

        {switchLinks.length > 0 && (
          <g>
            {switchLinks.map((link) => {
              // A gentle bow (quadratic bezier, not a straight line) — the
              // trade-drawing convention for a switch-to-fixture cable run
              // (see e.g. a real switchboard/lighting layout), and reads
              // more clearly than straight lines once several links share
              // an endpoint. Bow direction is a fixed left-hand normal, cap
              // the offset so a long run doesn't get an absurd arc.
              const dx = link.targetPos.x - link.switchPos.x;
              const dy = link.targetPos.y - link.switchPos.y;
              const len = Math.hypot(dx, dy) || 1;
              const nx = -dy / len;
              const ny = dx / len;
              const bow = Math.min(len * 0.15, 0.4);
              const cx = (link.switchPos.x + link.targetPos.x) / 2 + nx * bow;
              const cy = (link.switchPos.y + link.targetPos.y) / 2 + ny * bow;
              const fontSize = 10 * px2scene();
              // highlightSwitchLinks is the "check the wiring" toggle — every
              // run shows in red (the same styling the actively-edited gang
              // already gets), not just the one gang is currently being
              // worked on.
              const highlighted = link.active || highlightSwitchLinks;
              return (
                <g key={link.key}>
                  <path
                    d={`M ${link.switchPos.x} ${link.switchPos.y} Q ${cx} ${cy} ${link.targetPos.x} ${link.targetPos.y}`}
                    fill="none"
                    className={highlighted ? "text-primary" : "text-muted-foreground"}
                    stroke="currentColor"
                    strokeOpacity={highlighted ? 0.8 : 0.35}
                    strokeWidth={highlighted ? 1.5 : 1}
                    strokeDasharray="0.12 0.08"
                    vectorEffect="non-scaling-stroke"
                  />
                  {link.wayCount > 1 && (
                    <text
                      x={0.25 * link.switchPos.x + 0.5 * cx + 0.25 * link.targetPos.x}
                      y={0.25 * link.switchPos.y + 0.5 * cy + 0.25 * link.targetPos.y}
                      fontSize={fontSize}
                      textAnchor="middle"
                      stroke="hsl(var(--background))"
                      strokeWidth={fontSize * 0.28}
                      className={highlighted ? "text-primary" : "text-muted-foreground"}
                      fill="currentColor"
                      paintOrder="stroke"
                    >
                      {link.wayCount}-way
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        )}

        {dataCabinetLinks.length > 0 && (
          <g>
            {dataCabinetLinks.map((link) => {
              // Same bowed-run convention as switchLinks — no way-count
              // label here, data cabling is always a plain home run.
              const dx = link.targetPos.x - link.cabinetPos.x;
              const dy = link.targetPos.y - link.cabinetPos.y;
              const len = Math.hypot(dx, dy) || 1;
              const nx = -dy / len;
              const ny = dx / len;
              const bow = Math.min(len * 0.15, 0.4);
              const cx = (link.cabinetPos.x + link.targetPos.x) / 2 + nx * bow;
              const cy = (link.cabinetPos.y + link.targetPos.y) / 2 + ny * bow;
              return (
                <path
                  key={link.key}
                  d={`M ${link.cabinetPos.x} ${link.cabinetPos.y} Q ${cx} ${cy} ${link.targetPos.x} ${link.targetPos.y}`}
                  fill="none"
                  className={link.active ? "text-primary" : "text-muted-foreground"}
                  stroke="currentColor"
                  strokeOpacity={link.active ? 0.8 : 0.35}
                  strokeWidth={link.active ? 1.5 : 1}
                  strokeDasharray="0.12 0.08"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </g>
        )}

        {measurementLabels.length > 0 && (
          <g>
            {measurementLabels.map((line) => {
              const midX = line.labelX;
              const midY = line.labelY;
              const fontSize = 11 * px2scene();
              return (
                <g
                  key={line.key}
                  // On the group, not on the line: the label is painted text
                  // and hit-tests in its own right, so a tap on the number —
                  // the obvious thing to aim at — was being swallowed before it
                  // reached the line underneath.
                  className={onMeasurementDoubleTap ? "cursor-pointer" : undefined}
                  onPointerDown={
                    onMeasurementDoubleTap
                      ? (e) => {
                          e.stopPropagation();
                          const now = Date.now();
                          // Identified by fitting and slot rather than the
                          // render key: that key carries the measured point,
                          // which shifts whenever the fitting moves, so a
                          // double-tap could fail to match itself.
                          const id = `${line.fittingId}:${line.slot}`;
                          const last = lastMeasurementTapRef.current;
                          if (last && last.key === id && now - last.time < 400) {
                            lastMeasurementTapRef.current = null;
                            onMeasurementDoubleTap(line.fittingId, line.slot);
                            return;
                          }
                          lastMeasurementTapRef.current = { key: id, time: now };
                        }
                      : undefined
                  }
                >
                  {/* A dashed hairline is far too thin to hit, especially with
                      a finger, so an invisible fat line widens the target. */}
                  {onMeasurementDoubleTap && (
                    <line
                      x1={line.from.x}
                      y1={line.from.y}
                      x2={line.to.x}
                      y2={line.to.y}
                      stroke="transparent"
                      strokeWidth={14 * px2scene()}
                      pointerEvents="stroke"
                    />
                  )}
                  <line
                    x1={line.from.x}
                    y1={line.from.y}
                    x2={line.to.x}
                    y2={line.to.y}
                    className="text-primary"
                    stroke="currentColor"
                    strokeOpacity={0.6}
                    strokeWidth={1}
                    strokeDasharray="0.06 0.06"
                    vectorEffect="non-scaling-stroke"
                  />
                  <text x={midX} y={midY} fontSize={fontSize} textAnchor="middle" stroke="hsl(var(--background))" strokeWidth={fontSize * 0.28} className="text-primary" fill="currentColor" paintOrder="stroke">
                    {line.label}
                  </text>
                  {line.note && (
                    <text x={midX} y={midY + fontSize * 1.5} fontSize={fontSize * 0.8} textAnchor="middle" stroke="hsl(var(--background))" strokeWidth={fontSize * 0.22} className="text-muted-foreground" fill="currentColor" paintOrder="stroke" fontStyle="italic">
                      {line.note}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        )}

        {alignGuides && (
          // vector-effect is not an inherited SVG property — setting it on
          // the parent <g> (as this used to) has no effect on the child
          // <line>s, so their 1-unit stroke width scaled with the current
          // zoom like any other geometry, rendering as a thick bar rather
          // than a thin on-screen guide line once zoomed in. Each line needs
          // its own vector-effect attribute.
          <g className="text-sky-500" stroke="currentColor" strokeOpacity={0.7} strokeWidth={1} strokeDasharray="6 4">
            {alignGuides.x != null && (
              <line x1={alignGuides.x} y1={viewBox.y} x2={alignGuides.x} y2={viewBox.y + viewBox.h} vectorEffect="non-scaling-stroke" />
            )}
            {alignGuides.y != null && (
              <line x1={viewBox.x} y1={alignGuides.y} x2={viewBox.x + viewBox.w} y2={alignGuides.y} vectorEffect="non-scaling-stroke" />
            )}
          </g>
        )}

        {/* LED strips are runs, not points — they're drawn as the polyline the
            tradie traced rather than a fixed-size icon, so the length on the
            plan is the real length. Drawn before the icons so a fitting that
            sits on a strip still reads on top. */}
        {visibleFittings
          .filter((f) => f.type === "led_strip" && (f.specs.path?.length ?? 0) >= 2)
          .map((f) => {
            const path = f.specs.path!;
            const d = pathToSvgD(path);
            const selected = selectedFittingId === f.id;
            const mid = pathMidpoint(path);
            const lengthMm = Math.round(pathLength(path) * 1000);
            const circuitColor = colorForCircuit(circuits, f.circuit_id);
            return (
              <g key={`strip-${f.id}`}>
                {/* A wide transparent stroke under the visible one: a 4px strip is
                    almost impossible to hit with a gloved finger. Rendered as a
                    real <path> (not a sampled polyline) so a curved run's actual
                    curve geometry is what SVG paints and hit-tests. */}
                <path
                  d={d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={16}
                  vectorEffect="non-scaling-stroke"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  pointerEvents="stroke"
                  onPointerDown={(e) => handleFittingPointerDown(e, f)}
                  style={{ cursor: "pointer" }}
                />
                <path
                  d={d}
                  fill="none"
                  className="text-primary"
                  stroke={selected ? "hsl(var(--primary))" : circuitColor ?? "currentColor"}
                  // A real physical width (a typical LED aluminium channel,
                  // ~15mm) rather than non-scaling-stroke — same convention
                  // as the wall lines (strokeWidth={wallThickness...} below),
                  // so the run shrinks with the rest of the plan when zoomed
                  // out instead of staying a constant on-screen thickness
                  // that reads as disproportionately fat at house scale.
                  strokeWidth={selected ? 0.022 : 0.015}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  pointerEvents="none"
                />
                <text
                  x={mid.x}
                  y={mid.y - iconScale * 6}
                  textAnchor="middle"
                  fontSize={iconScale * 9}
                  fontWeight="600"
                  className="text-primary"
                  fill="currentColor"
                  pointerEvents="none"
                >
                  {lengthMm}mm
                </text>
              </g>
            );
          })}

        {/* The run being drawn right now, before it's saved. */}
        {stripDraft.length > 0 && (
          <g pointerEvents="none">
            <path
              d={pathToSvgD(stripDraft)}
              fill="none"
              className="text-primary"
              stroke="currentColor"
              strokeWidth={4}
              strokeDasharray="6 4"
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {stripDraft.map((pt, i) => (
              <circle key={i} cx={pt.x} cy={pt.y} r={iconScale * 3} className="text-primary" fill="currentColor" />
            ))}
          </g>
        )}

        {/* An ad-hoc tape measure — never saved, just a running readout of
            each leg while the tradie walks it out (e.g. down a hallway). A
            distinct colour (accent, not primary) so it doesn't read as an
            LED strip mid-trace. */}
        {measureDraft.length > 0 && (
          <g pointerEvents="none">
            <polyline
              points={measureDraft.map((pt) => `${pt.x},${pt.y}`).join(" ")}
              fill="none"
              className="text-accent-foreground"
              stroke="currentColor"
              strokeWidth={4}
              strokeDasharray="6 4"
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {measureDraft.map((pt, i) => (
              <circle key={i} cx={pt.x} cy={pt.y} r={iconScale * 3} className="text-accent-foreground" fill="currentColor" />
            ))}
            {measureDraft.slice(1).map((pt, i) => {
              const prev = measureDraft[i];
              const mid = { x: (prev.x + pt.x) / 2, y: (prev.y + pt.y) / 2 };
              const legMm = Math.round(distance(prev, pt) * 1000);
              return (
                <text
                  key={i}
                  x={mid.x}
                  y={mid.y - iconScale * 6}
                  textAnchor="middle"
                  fontSize={iconScale * 9}
                  fontWeight="600"
                  className="text-accent-foreground"
                  fill="currentColor"
                >
                  {legMm}mm
                </text>
              );
            })}
          </g>
        )}

        {visibleFittings.map((f) => {
          const Icon = FITTING_SYMBOLS[f.type];
          if (!Icon) return null;
          // Already drawn as a run above — a strip has no icon on the plan.
          if (f.type === "led_strip") return null;
          let pos = dragPreview?.id === f.id ? dragPreview.position : f.position;
          // Wall-mounted symbols offset into the room so they sit on the inside
          // edge of the wall, not straddling the wall centerline. Offset scales
          // with wall thickness so it adapts when wall thickness is changed.
          if (isSingleWallFitting(f.type)) {
            pos = offsetSymbolIntoRoom(pos, walls, wallThickness);
          }
          const selected = selectedFittingId === f.id;
          const isActiveSwitch = mode === "link-switches" && f.id === linkActiveSwitchId;
          const isLinkTarget = mode === "link-switches" && !!linkActiveSwitchId;
          const isInSelectionGroup = selectionGroupIds.has(f.id);
          const isMultiSelected = mode === "select-multiple" && !!multiSelectIds?.has(f.id);
          const symbolExtraProps = symbolExtraPropsFor(f);
          const rotation = f.specs.rotation ?? 0;
          // Wall-mounted symbols anchor at their base (bottom-centre, where
          // GpoSymbol/SwitchSymbol and friends draw their wall baseline)
          // rather than their geometric centre, so the base sits exactly on
          // the wall and the body projects into the room from there.
          // Rotate must come before the anchor-translate here (i.e. run on
          // the *raw* icon coordinates first) — doing it the other way
          // round, as this previously did, rotates around the wrong pivot
          // once the coordinate space has already been shifted, so the
          // icon visibly drifts off-position at anything but 0°/360°.
          const anchorX = 12;
          const anchorY = isSingleWallFitting(f.type) ? 20.5 : 12;
          // Once a fitting is assigned to a circuit, its icon takes on that
          // circuit's colour (see colorForCircuit) instead of the default
          // foreground — a quick visual "which circuit is this on" cue that
          // doesn't require opening the circuits panel. Selection/active
          // states still win over the circuit tint since they're transient.
          const circuitColor = colorForCircuit(circuits, f.circuit_id);
          return (
            <g
              key={f.id}
              transform={`translate(${pos.x} ${pos.y}) scale(${iconScale}) translate(${-anchorX} ${-anchorY}) rotate(${rotation} ${anchorX} ${anchorY})`}
              onPointerDown={(e) => handleFittingPointerDown(e, f)}
              className={cn(
                mode === "place-fittings" && !panMode && "cursor-grab",
                (mode === "link-switches" && (f.type === "switch" || isLinkTarget)) || mode !== "link-switches" ? "cursor-pointer" : ""
              )}
            >
              <circle
                cx={12}
                cy={12}
                r={13}
                fill={isActiveSwitch || isMultiSelected || isInSelectionGroup ? "hsl(var(--primary) / 0.15)" : "transparent"}
                pointerEvents="all"
                stroke={isActiveSwitch || isMultiSelected || isInSelectionGroup ? "hsl(var(--primary))" : "none"}
                strokeWidth={isActiveSwitch || isMultiSelected || isInSelectionGroup ? 1.5 : 0}
              />
              {/* A twin downlight is two lamps in one fixture, so it's drawn as
                  two glyphs at their real centre-to-centre spacing rather than
                  one "twin" glyph — on a setout plan the tradie measures the
                  gap off the drawing, so it has to be to scale. Dividing the
                  spacing by iconScale converts metres into the icon's own
                  coordinate space, which the parent <g> then scales back. */}
              {(f.type === "downlight" && f.specs.twin
                ? [-1, 1].map((side) => (side * (f.specs.twinSpacingMm ?? DEFAULT_TWIN_SPACING_MM)) / 1000 / iconScale / 2)
                : [0]
              ).map((dx, i) => (
                <g key={i} transform={dx ? `translate(${dx} 0)` : undefined}>
                  <Icon
                    size={24}
                    // Fittings are drawn in the app's red so they stand out against the
                    // black line work of a plan underneath. A circuit colour, when one
                    // is assigned, still wins.
                    className="text-primary"
                    style={circuitColor && !selected && !isActiveSwitch && !isInSelectionGroup ? { color: circuitColor } : undefined}
                    strokeWidth={selected || isActiveSwitch || isInSelectionGroup ? 2 : 1.5}
                    {...symbolExtraProps}
                    {...(f.type === "downlight" && f.specs.twin ? { twin: false } : {})}
                  />
                </g>
              ))}
              {f.status === "confirmed" && (
                <g transform="translate(15 -3)">
                  <circle r={5} fill="hsl(var(--primary))" />
                  <path d="M-2 0l1.5 1.5L2.5 -2" stroke="hsl(var(--primary-foreground))" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </g>
              )}
              {selected && (
                <g
                  transform="translate(27 -3)"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onFittingRotate?.(f.id);
                  }}
                  style={{ cursor: "pointer" }}
                  pointerEvents="all"
                >
                  <circle r={5} fill="hsl(var(--primary))" pointerEvents="all" />
                  <path d="M-2 -1a2.5 2.5 0 0 1 3 0M0.5 1v-2M0.5 -1h2" stroke="hsl(var(--primary-foreground))" strokeWidth={1} strokeLinecap="round" fill="none" pointerEvents="all" />
                </g>
              )}
              {f.specs.locked && (
                <g transform="translate(-3 27)">
                  <circle r={5} fill="hsl(var(--muted-foreground))" />
                  <rect x={-2} y={-0.5} width={4} height={3} rx={0.5} fill="hsl(var(--background))" />
                  <path d="M-1.3 -0.5v-1.2a1.3 1.3 0 0 1 2.6 0v1.2" stroke="hsl(var(--background))" strokeWidth={1} fill="none" />
                </g>
              )}
            </g>
          );
        })}

        {photoGalleries.map((gallery) => {
          const firstPhoto = gallery.photos[0];
          const photoCount = gallery.photos.length;
          return (
            <g key={`gallery-${firstPhoto.id}`} transform={`translate(${gallery.position.x} ${gallery.position.y}) scale(${iconScale})`}>
              {/* Draw stacked thumbnails for multiple photos */}
              {gallery.photos.slice(0, 3).map((photo, idx) => {
                const offset = idx * 3;
                return (
                  <g key={photo.id} transform={`translate(${offset} ${offset}) translate(-12 -12)`}>
                    <circle cx={12} cy={12} r={13} fill="hsl(var(--primary))" stroke="hsl(var(--background))" strokeWidth={2} opacity={0.7 + idx * 0.1} />
                  </g>
                );
              })}
              {/* Main icon on top */}
              <g
                transform={`translate(-12 -12)`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onPhotoPointTap?.(firstPhoto.id);
                }}
                className="cursor-pointer"
              >
                {firstPhoto.direction_degrees != null && (
                  <g transform={`rotate(${firstPhoto.direction_degrees} 12 12)`}>
                    <path d="M 12 -7 L 7 2 L 17 2 Z" className="text-primary" fill="currentColor" />
                  </g>
                )}
                <circle cx={12} cy={12} r={13} className="text-primary" fill="hsl(var(--primary))" stroke="hsl(var(--background))" strokeWidth={2} />
                <Camera x={4} y={4} size={16} className="text-primary-foreground" strokeWidth={2} />
              </g>
              {/* Photo count badge if more than 1 */}
              {photoCount > 1 && (
                <text x={20} y={-8} fontSize={10} fontWeight="bold" fill="hsl(var(--primary))" textAnchor="middle">
                  {photoCount}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <div className="absolute bottom-3 right-3 flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => setPanMode((v) => !v)}
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card shadow-sm",
            panMode ? "text-primary" : "text-muted-foreground"
          )}
          aria-label={panMode ? "Switch to draw/select mode" : "Switch to pan mode"}
        >
          {panMode ? <GripHorizontal className="h-4 w-4" /> : <MousePointer2 className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={() => zoomAround({ x: viewBox.x + viewBox.w / 2, y: viewBox.y + viewBox.h / 2 }, 1 / 1.3)}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground shadow-sm"
          aria-label="Zoom in"
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => zoomAround({ x: viewBox.x + viewBox.w / 2, y: viewBox.y + viewBox.h / 2 }, 1.3)}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground shadow-sm"
          aria-label="Zoom out"
        >
          <Minus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
