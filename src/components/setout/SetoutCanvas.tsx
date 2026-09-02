import { useRef, useState, useCallback, useMemo, useEffect } from "react";
import { Hand, Minus, Plus, MousePointer2, Camera } from "lucide-react";
import { cn } from "@/lib/utils";
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
  type SetoutCircuit,
  type SetoutFitting,
  type SetoutPhotoPoint,
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
  closestPointOnWall,
  snapToNearestWall,
  alignToExistingPoints,
  wallLength,
  pointAtOffset,
  wallsCentroid,
  roomFacingNormal,
  nearestWallAndOffset,
  perpendicularDistanceToWall,
  projectPointOntoWall,
  offsetSymbolIntoRoom,
} from "@/lib/setoutGeometry";

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const ICON_SCREEN_PX = 28;
const CORNER_MARKER_METRES = 0.09;

interface BackgroundImage {
  href: string;
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
  | "link-data-cabinet";

interface SetoutCanvasProps {
  backgroundImage?: BackgroundImage;
  walls: WallSegment[];
  // Real thickness (metres) drawn straight into the wall line's stroke
  // width in scene units — deliberately not vector-effect non-scaling like
  // every other line here, so a wall genuinely reads thicker/thinner as the
  // tradie zooms, the same way it would on a printed scaled drawing.
  wallThickness?: WallThickness;
  openings?: WallOpening[];
  fittings?: SetoutFitting[];
  mode: SetoutCanvasMode;
  sketchPoints?: Point[];
  onSketchPointAdd?: (point: Point) => void;
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
  onInteriorWallSegmentAdd?: (start: Point, end: Point) => void;
  onInteriorWallChainEnd?: () => void;
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
  selectedFittingType?: FittingType | null;
  onPlaceFitting?: (point: Point) => void;
  onFittingDrag?: (fittingId: string, position: Point) => void;
  onFittingRotate?: (fittingId: string) => void;
  selectedFittingId?: string | null;
  onFittingSelect?: (fittingId: string | null) => void;
  layerVisibility?: LayerVisibility;
  linkActiveSwitchId?: string | null;
  linkActiveGangIndex?: number;
  onSwitchTap?: (switchId: string | null) => void;
  onLinkTargetTap?: (fittingId: string) => void;
  // Double-tap/double-click a switch to open its "add gang" menu — reports
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
  onPhotoPointPlace?: (point: Point) => void;
  onPhotoPointTap?: (photoPointId: string) => void;
  className?: string;
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
  walls,
  wallThickness = DEFAULT_WALL_THICKNESS,
  openings = [],
  fittings = [],
  mode,
  sketchPoints = [],
  onSketchPointAdd,
  onSketchClose,
  calibratePoints = [],
  onCalibratePointAdd,
  interiorWallDraftStart = null,
  onInteriorWallDraftPointAdd,
  onInteriorWallSegmentAdd,
  onInteriorWallChainEnd,
  snapInteriorWalls = true,
  onWallTap,
  selectedEraseWallId = null,
  onOpeningPlace,
  onOpeningDrag,
  onMeasurementRefPick,
  snapWalls = false,
  selectedFittingType,
  onPlaceFitting,
  onFittingDrag,
  onFittingRotate,
  selectedFittingId,
  onFittingSelect,
  layerVisibility,
  linkActiveSwitchId,
  linkActiveGangIndex = 0,
  onSwitchTap,
  onLinkTargetTap,
  onSwitchDoubleTap,
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
  const [panMode, setPanMode] = useState(false);
  const panState = useRef<{ clientX: number; clientY: number; vb: ViewBox; scale: number } | null>(null);
  const dragState = useRef<{ fittingId: string; type: FittingType; clientX: number; clientY: number; scale: number; origin: Point } | null>(null);
  const [dragPreview, setDragPreview] = useState<{ id: string; position: Point } | null>(null);
  const [alignGuides, setAlignGuides] = useState<{ x?: number; y?: number } | null>(null);
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

  const px2scene = useCallback(() => {
    const el = svgRef.current;
    if (!el || el.clientWidth === 0) return viewBox.w / 600;
    return viewBox.w / el.clientWidth;
  }, [viewBox.w]);

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
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    svg.addEventListener("wheel", handleWheel, { passive: false });
    return () => svg.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

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
      const isActivelyPlacing = mode === "place-fittings" && selectedFittingType;
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
      const scene = sceneFromClient(e.clientX, e.clientY);
      if (mode === "sketch-walls") {
        if (isNearFirstPoint(sketchPoints, scene) && onSketchClose) {
          onSketchClose();
          return;
        }
        const last = sketchPoints[sketchPoints.length - 1];
        const point = snapWalls && last ? snapOrthogonal(last, scene) : scene;
        onSketchPointAdd?.(point);
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
          onInteriorWallDraftPointAdd?.(scene);
        } else {
          const end = snapInteriorWalls ? snapOrthogonal(interiorWallDraftStart, scene) : scene;
          onInteriorWallSegmentAdd?.(interiorWallDraftStart, end);
        }
      } else if (mode === "place-opening") {
        const result = nearestWallAndOffset(scene, walls);
        if (result) onOpeningPlace?.(result.wall.id, result.offset);
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

        if (nearestRef) {
          onMeasurementRefPick?.(nearestRef);
        }
      } else if (mode === "place-fittings" && selectedFittingType) {
        // Alignment applies to every ceiling/surface-mounted fitting (not
        // just downlights) — a smoke alarm or exhaust fan lining up with
        // existing downlights (or each other) is just as useful as
        // downlight-to-downlight rows/columns.
        const point = isSingleWallFitting(selectedFittingType)
          ? snapToNearestWall(scene, walls, openings)
          : alignToExistingPoints(
              scene,
              fittings.filter((f) => !isSingleWallFitting(f.type)).map((f) => f.position)
            ).position;
        onPlaceFitting?.(point);
      } else if (mode === "place-fittings") {
        onFittingSelect?.(null);
      } else if (mode === "link-switches") {
        onSwitchTap?.(null);
      } else if (mode === "link-data-cabinet") {
        onCabinetTap?.(null);
      } else if (mode === "place-photo-points") {
        onPhotoPointPlace?.(scene);
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
      snapWalls,
      onSketchPointAdd,
      calibratePoints,
      onCalibratePointAdd,
      interiorWallDraftStart,
      onInteriorWallDraftPointAdd,
      onInteriorWallSegmentAdd,
      onInteriorWallChainEnd,
      snapInteriorWalls,
      onOpeningPlace,
      onMeasurementRefPick,
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
    ]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (panState.current) {
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
        if (isSingleWallFitting(type)) {
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
      }
    },
    [walls, openings, fittings, sceneFromClient]
  );

  const endPan = useCallback(() => {
    panState.current = null;
  }, []);

  const endDrag = useCallback(() => {
    if (dragState.current && dragPreview) {
      onFittingDrag?.(dragState.current.fittingId, dragPreview.position);
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

  const handlePointerUp = useCallback(() => {
    endPan();
    endDrag();
  }, [endPan, endDrag]);

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

  const visiblePhotoPoints = useMemo(() => {
    if (!layerVisibility) return photoPoints;
    return layerVisibility.photoPoints ? photoPoints : [];
  }, [photoPoints, layerVisibility]);

  const lightPools = useMemo(() => {
    if (!layerVisibility?.coverage) return [];
    const downlights = fittings.filter((f) => f.type === "downlight");
    return downlights.map((f) => {
      const pos = dragPreview?.id === f.id ? dragPreview.position : f.position;
      const radius = lightPoolRadius(f.specs);
      const overlapsAnother = downlights.some((other) => {
        if (other.id === f.id) return false;
        const otherPos = dragPreview?.id === other.id ? dragPreview.position : other.position;
        return poolsSignificantlyOverlap(pos, radius, otherPos, lightPoolRadius(other.specs));
      });
      return { id: f.id, position: pos, radius, overlapsAnother };
    });
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
    const lines: { key: string; from: Point; to: Point; label: string; note?: string }[] = [];
    // visibleFittings, not the raw fittings list — a fitting whose category
    // layer is toggled off should have its measurement line disappear too,
    // otherwise a hidden GPO still leaves a dangling wall-measurement line
    // with nothing visibly attached to it.
    for (const f of visibleFittings) {
      if (!f.measurement_lock) continue;
      const pos = dragPreview?.id === f.id ? dragPreview.position : f.position;
      const refs = [f.measurement_lock.refA, f.measurement_lock.refB].filter((r): r is MeasurementRef => !!r);
      for (const ref of refs) {
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
        } else {
          const other = fittingById.get(ref.fittingId);
          if (!other) continue;
          to = dragPreview?.id === other.id ? dragPreview.position : other.position;
        }
        const label = `${ref.distance.toFixed(2)}m`;
        const refKey = ref.kind === "wall" ? ref.wallId : ref.kind === "opening" ? ref.openingId : ref.fittingId;
        lines.push({ key: `${f.id}-${ref.kind}-${refKey}`, from: pos, to, label, note: f.measurement_lock.note });
      }
    }
    return lines;
  }, [visibleFittings, walls, openings, layerVisibility?.measurements, dragPreview]);

  const iconScale = (ICON_SCREEN_PX * px2scene()) / 24;
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

        <g className="text-border">
          {gridLines.vLines.map((x) => (
            <line key={`v${x}`} x1={x} y1={gridLines.startY} x2={x} y2={gridLines.endY} stroke="currentColor" strokeOpacity={0.5} vectorEffect="non-scaling-stroke" />
          ))}
          {gridLines.hLines.map((y) => (
            <line key={`h${y}`} x1={gridLines.startX} y1={y} x2={gridLines.endX} y2={y} stroke="currentColor" strokeOpacity={0.5} vectorEffect="non-scaling-stroke" />
          ))}
        </g>

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
                      <line
                        x1={seg.from.x}
                        y1={seg.from.y}
                        x2={seg.to.x}
                        y2={seg.to.y}
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
                      <line
                        x1={seg.from.x}
                        y1={seg.from.y}
                        x2={seg.to.x}
                        y2={seg.to.y}
                        stroke="currentColor"
                        strokeOpacity={0.35}
                        strokeWidth={wallThickness.interior + 14 * px2scene()}
                        strokeLinecap="round"
                        vectorEffect="non-scaling-stroke"
                        pointerEvents="none"
                      />
                    )}
                    <line
                      x1={seg.from.x}
                      y1={seg.from.y}
                      x2={seg.to.x}
                      y2={seg.to.y}
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
            <polyline
              points={sketchPoints.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeDasharray="0.15 0.1"
              vectorEffect="non-scaling-stroke"
            />
            {sketchPoints.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={CORNER_MARKER_METRES} fill="currentColor" />
            ))}
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
              return (
                <g key={link.key}>
                  <path
                    d={`M ${link.switchPos.x} ${link.switchPos.y} Q ${cx} ${cy} ${link.targetPos.x} ${link.targetPos.y}`}
                    fill="none"
                    className={link.active ? "text-primary" : "text-muted-foreground"}
                    stroke="currentColor"
                    strokeOpacity={link.active ? 0.8 : 0.35}
                    strokeWidth={link.active ? 1.5 : 1}
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
                      className={link.active ? "text-primary" : "text-muted-foreground"}
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

        {measurementLines.length > 0 && (
          <g>
            {measurementLines.map((line) => {
              const midX = (line.from.x + line.to.x) / 2;
              const midY = (line.from.y + line.to.y) / 2;
              const fontSize = 11 * px2scene();
              return (
                <g key={line.key}>
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

        {visibleFittings.map((f) => {
          const Icon = FITTING_SYMBOLS[f.type];
          if (!Icon) return null;
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
              <Icon
                size={24}
                className={selected || isActiveSwitch || isInSelectionGroup || circuitColor ? "text-primary" : "text-foreground"}
                style={circuitColor && !selected && !isActiveSwitch && !isInSelectionGroup ? { color: circuitColor } : undefined}
                strokeWidth={selected || isActiveSwitch || isInSelectionGroup ? 2 : 1.5}
                {...symbolExtraProps}
              />
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

        {visiblePhotoPoints.map((p) => (
          <g
            key={p.id}
            transform={`translate(${p.position.x} ${p.position.y}) scale(${iconScale}) translate(-12 -12)`}
            onPointerDown={(e) => {
              e.stopPropagation();
              onPhotoPointTap?.(p.id);
            }}
            className="cursor-pointer"
          >
            {p.direction_degrees != null && (
              // Triangle tip pointing "up" (plan-north), rotated to the
              // saved heading — same 0deg-is-up, clockwise-positive
              // convention as PhotoPointDialog's direction dial.
              <g transform={`rotate(${p.direction_degrees} 12 12)`}>
                <path d="M 12 -7 L 7 2 L 17 2 Z" className="text-primary" fill="currentColor" />
              </g>
            )}
            <circle cx={12} cy={12} r={13} className="text-primary" fill="hsl(var(--primary))" stroke="hsl(var(--background))" strokeWidth={2} />
            <Camera x={4} y={4} size={16} className="text-primary-foreground" strokeWidth={2} />
          </g>
        ))}
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
          {panMode ? <Hand className="h-4 w-4" /> : <MousePointer2 className="h-4 w-4" />}
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
