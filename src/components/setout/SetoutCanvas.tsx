import { useRef, useState, useCallback, useMemo, useEffect } from "react";
import { Hand, Minus, Plus, MousePointer2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { FITTING_SYMBOLS, type FittingType } from "@/components/setout/symbols";
import {
  colorForCircuit,
  distance,
  gangsFor,
  isSingleWallFitting,
  symbolExtraPropsFor,
  type Point,
  type SetoutCircuit,
  type SetoutFitting,
  type WallSegment,
  type WallOpening,
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
  | "place-opening"
  | "place-fittings"
  | "link-switches"
  | "select-multiple"
  | "pick-measurement-ref";

interface SetoutCanvasProps {
  backgroundImage?: BackgroundImage;
  walls: WallSegment[];
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
  // "sketch-interior-wall" mode: first tap sets the draft start point
  // (rendered so the tradie can see it's pending), second tap completes
  // that one segment and reports both points — the parent owns the growing
  // list of interior walls, this component only handles one segment's
  // worth of interaction at a time.
  interiorWallDraftStart?: Point | null;
  onInteriorWallDraftPointAdd?: (point: Point) => void;
  onInteriorWallSegmentAdd?: (start: Point, end: Point) => void;
  // Interior walls default to square (horizontal/vertical off the start
  // point) same as the perimeter's snapWalls — a tradie's rough second tap
  // gets straightened automatically. Set false to let a wall land exactly
  // where tapped (an intentionally angled partition).
  snapInteriorWalls?: boolean;
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
  selectedFittingId?: string | null;
  onFittingSelect?: (fittingId: string | null) => void;
  layerVisibility?: LayerVisibility;
  linkActiveSwitchId?: string | null;
  linkActiveGangIndex?: number;
  onSwitchTap?: (switchId: string | null) => void;
  onLinkTargetTap?: (fittingId: string) => void;
  multiSelectIds?: Set<string>;
  onMultiSelectToggle?: (fittingId: string) => void;
  circuits?: SetoutCircuit[];
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
  snapInteriorWalls = true,
  onOpeningPlace,
  onOpeningDrag,
  onMeasurementRefPick,
  snapWalls = false,
  selectedFittingType,
  onPlaceFitting,
  onFittingDrag,
  selectedFittingId,
  onFittingSelect,
  layerVisibility,
  linkActiveSwitchId,
  linkActiveGangIndex = 0,
  onSwitchTap,
  onLinkTargetTap,
  multiSelectIds,
  onMultiSelectToggle,
  circuits = [],
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
      if (panMode || mode === "view") {
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
        if (!interiorWallDraftStart) onInteriorWallDraftPointAdd?.(scene);
        else {
          const end = snapInteriorWalls ? snapOrthogonal(interiorWallDraftStart, scene) : scene;
          onInteriorWallSegmentAdd?.(interiorWallDraftStart, end);
        }
      } else if (mode === "place-opening") {
        const result = nearestWallAndOffset(scene, walls);
        if (result) onOpeningPlace?.(result.wall.id, result.offset);
      } else if (mode === "pick-measurement-ref") {
        // Background tap = pick a wall, but only if the tap actually landed
        // close to one — walls aren't labelled on the plan, so a tap in
        // open space should do nothing rather than silently snapping to
        // whatever wall happens to be nearest, however far away.
        const TAP_TOLERANCE_PX = 20;
        const tolerance = TAP_TOLERANCE_PX * px2scene();
        let nearestWall: WallSegment | null = null;
        let nearestDistance = Infinity;
        for (const wall of walls) {
          const d = perpendicularDistanceToWall(scene, wall);
          if (d < nearestDistance) {
            nearestDistance = d;
            nearestWall = wall;
          }
        }
        if (nearestWall && nearestDistance <= tolerance) {
          const selectedFitting = fittings.find((f) => f.id === selectedFittingId);
          if (selectedFitting) {
            onMeasurementRefPick?.({ kind: "wall", wallId: nearestWall.id, distance: perpendicularDistanceToWall(selectedFitting.position, nearestWall) });
          }
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
      snapInteriorWalls,
      onOpeningPlace,
      onMeasurementRefPick,
      selectedFittingId,
      selectedFittingType,
      onPlaceFitting,
      onFittingSelect,
      onSwitchTap,
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
          position = snapToNearestWall(raw, walls, openings);
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
      if (mode === "link-switches") {
        if (fitting.type === "switch") {
          onSwitchTap?.(fitting.id === linkActiveSwitchId ? null : fitting.id);
        } else if (linkActiveSwitchId) {
          onLinkTargetTap?.(fitting.id);
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
    [mode, panMode, px2scene, onFittingSelect, linkActiveSwitchId, onSwitchTap, onLinkTargetTap, selectedFittingId, fittings, onMeasurementRefPick]
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
  // icon; a light fed by 2+ gangs (from any switch) is 2-way by definition.
  const switchLinks = useMemo(() => {
    if (layerVisibility && !layerVisibility.switches) return [];
    const switches = fittings.filter((f) => f.type === "switch");
    // A 2-way/3-way/4-way run is one continuous chain that passes through
    // multiple switches (switch A -> lights -> switch B, optionally on to
    // C/D) rather than two switches independently claiming the same light —
    // a gang's chain can include another switch's id as its last stop(s).
    // Every light in that gang shares the same way-count: the owning switch
    // plus however many other switches the chain passes through.
    const wayCountForGang = (gang: string[]) => 1 + gang.filter((id) => switches.some((s) => s.id === id)).length;
    const links: { key: string; switchPos: Point; targetPos: Point; active: boolean; wayCount: number; targetIsSwitch: boolean }[] = [];
    for (const sw of switches) {
      const swPos = dragPreview?.id === sw.id ? dragPreview.position : sw.position;
      const gangs = gangsFor(sw);
      gangs.forEach((gang, gangIndex) => {
        const wayCount = wayCountForGang(gang);
        let fromPos = swPos;
        let fromId = sw.id;
        for (const targetId of gang) {
          const target = fittings.find((f) => f.id === targetId);
          if (!target) continue;
          const targetPos = dragPreview?.id === target.id ? dragPreview.position : target.position;
          links.push({
            key: `${sw.id}-g${gangIndex}-${fromId}-${targetId}`,
            switchPos: fromPos,
            targetPos,
            active: sw.id === linkActiveSwitchId && gangIndex === linkActiveGangIndex,
            wayCount,
            targetIsSwitch: target.type === "switch",
          });
          fromPos = targetPos;
          fromId = targetId;
        }
      });
    }
    return links;
  }, [fittings, layerVisibility?.switches, dragPreview, linkActiveSwitchId, linkActiveGangIndex]);

  const measurementLines = useMemo(() => {
    if (!layerVisibility?.measurements) return [];
    const wallById = new Map(walls.map((w) => [w.id, w]));
    const fittingById = new Map(fittings.map((f) => [f.id, f]));
    const lines: { key: string; from: Point; to: Point; label: string }[] = [];
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
        } else {
          const other = fittingById.get(ref.fittingId);
          if (!other) continue;
          to = dragPreview?.id === other.id ? dragPreview.position : other.position;
        }
        lines.push({ key: `${f.id}-${ref.kind}-${ref.kind === "wall" ? ref.wallId : ref.fittingId}`, from: pos, to, label: `${ref.distance.toFixed(2)}m` });
      }
    }
    return lines;
  }, [visibleFittings, walls, layerVisibility?.measurements, dragPreview]);

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
          {wallRenderData.map(({ wall, segments }) => (
            <g key={wall.id} className={wall.kind === "interior" ? "text-foreground/60" : "text-foreground"}>
              {segments.map((seg, i) => (
                <line
                  key={i}
                  x1={seg.from.x}
                  y1={seg.from.y}
                  x2={seg.to.x}
                  y2={seg.to.y}
                  stroke="currentColor"
                  strokeWidth={wall.kind === "interior" ? 1.25 : 2}
                  vectorEffect="non-scaling-stroke"
                  strokeLinecap="square"
                />
              ))}
            </g>
          ))}
          {wallRenderData.flatMap(({ wall, openings: wallOpenings }) =>
            wallOpenings.map((o) => {
              const len = wallLength(wall);
              const p1 = pointAtOffset(wall, Math.max(0, o.offset));
              const p2 = pointAtOffset(wall, Math.min(len, o.offset + o.width));
              const draggable = mode === "place-opening";
              // A transparent, much fatter line sitting over the same span as
              // the visible glyph — the actual door/window line is only 1px
              // wide, far too thin to reliably grab on a phone screen.
              const hitStroke = (
                <line
                  x1={p1.x}
                  y1={p1.y}
                  x2={p2.x}
                  y2={p2.y}
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
                      x1={p1.x}
                      y1={p1.y}
                      x2={p2.x}
                      y2={p2.y}
                      stroke="currentColor"
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                      className="text-sky-600"
                    />
                  </g>
                );
              }
              // Door: a leaf line from the hinge (p1) swinging into the room,
              // plus a quarter-circle arc tracing the leaf's sweep back to
              // the far jamb (p2) — the standard architectural door glyph.
              const normal = roomFacingNormal(wall, p1, wallCentroid);
              const openEnd = { x: p1.x + normal.x * o.width, y: p1.y + normal.y * o.width };
              return (
                <g
                  key={o.id}
                  className={cn("text-foreground/70", draggable && "cursor-grab active:cursor-grabbing")}
                  onPointerDown={draggable ? (e) => handleOpeningPointerDown(e, o, wall) : undefined}
                >
                  {hitStroke}
                  <line x1={p1.x} y1={p1.y} x2={openEnd.x} y2={openEnd.y} stroke="currentColor" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                  <path
                    d={`M ${openEnd.x} ${openEnd.y} A ${o.width} ${o.width} 0 0 1 ${p2.x} ${p2.y}`}
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
                  {!link.targetIsSwitch && link.wayCount > 1 && (
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
          const pos = dragPreview?.id === f.id ? dragPreview.position : f.position;
          const selected = selectedFittingId === f.id;
          const isActiveSwitch = mode === "link-switches" && f.id === linkActiveSwitchId;
          const isLinkTarget = mode === "link-switches" && !!linkActiveSwitchId;
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
                fill={isActiveSwitch || isMultiSelected ? "hsl(var(--primary) / 0.15)" : "transparent"}
                pointerEvents="all"
                stroke={isActiveSwitch || isMultiSelected ? "hsl(var(--primary))" : "none"}
                strokeWidth={isActiveSwitch || isMultiSelected ? 1.5 : 0}
              />
              <Icon
                size={24}
                className={selected || isActiveSwitch || circuitColor ? "text-primary" : "text-foreground"}
                style={circuitColor && !selected && !isActiveSwitch ? { color: circuitColor } : undefined}
                strokeWidth={selected || isActiveSwitch ? 2 : 1.5}
                {...symbolExtraProps}
              />
              {f.status === "confirmed" && (
                <g transform="translate(15 -3)">
                  <circle r={5} fill="hsl(var(--primary))" />
                  <path d="M-2 0l1.5 1.5L2.5 -2" stroke="hsl(var(--primary-foreground))" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" fill="none" />
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
