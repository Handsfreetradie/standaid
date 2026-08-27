import { useRef, useState, useCallback, useMemo, useEffect } from "react";
import { Hand, Minus, Plus, MousePointer2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { FITTING_SYMBOLS, type FittingType } from "@/components/setout/symbols";
import {
  colorForCircuit,
  gangsFor,
  isSingleWallFitting,
  type Point,
  type SetoutCircuit,
  type SetoutFitting,
  type WallSegment,
  type WallLock,
  type LayerVisibility,
} from "@/lib/setoutTypes";
import { snapOrthogonal, isNearFirstPoint, lightPoolRadius, poolsSignificantlyOverlap, closestPointOnWall, snapToNearestWall, alignToExistingPoints } from "@/lib/setoutGeometry";

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MIN_SCENE_SPAN = 1.5;
const MAX_SCENE_SPAN = 200;
const ICON_SCREEN_PX = 28;
const CORNER_MARKER_METRES = 0.09;

function clampSpan(v: number) {
  return Math.min(MAX_SCENE_SPAN, Math.max(MIN_SCENE_SPAN, v));
}

interface BackgroundImage {
  href: string;
  width: number;
  height: number;
}

export type SetoutCanvasMode = "view" | "calibrate" | "sketch-walls" | "place-fittings" | "link-switches" | "select-multiple";

interface SetoutCanvasProps {
  backgroundImage?: BackgroundImage;
  walls: WallSegment[];
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
  fittings = [],
  mode,
  sketchPoints = [],
  onSketchPointAdd,
  onSketchClose,
  calibratePoints = [],
  onCalibratePointAdd,
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
  const [viewBox, setViewBox] = useState<ViewBox>(() => initialViewBox(backgroundImage, walls));
  const [panMode, setPanMode] = useState(false);
  const panState = useRef<{ clientX: number; clientY: number; vb: ViewBox; scale: number } | null>(null);
  const dragState = useRef<{ fittingId: string; type: FittingType; clientX: number; clientY: number; scale: number; origin: Point } | null>(null);
  const [dragPreview, setDragPreview] = useState<{ id: string; position: Point } | null>(null);
  const [alignGuides, setAlignGuides] = useState<{ x?: number; y?: number } | null>(null);

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
  }, []);

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
      if (dragState.current) return;
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
      } else if (mode === "place-fittings" && selectedFittingType) {
        const point = isSingleWallFitting(selectedFittingType)
          ? snapToNearestWall(scene, walls)
          : selectedFittingType === "downlight"
            ? alignToExistingPoints(
                scene,
                fittings.filter((f) => f.type === "downlight").map((f) => f.position)
              ).position
            : scene;
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
      selectedFittingType,
      onPlaceFitting,
      onFittingSelect,
      onSwitchTap,
      walls,
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
          position = snapToNearestWall(raw, walls);
          setAlignGuides(null);
        } else if (type === "downlight") {
          const others = fittings.filter((f) => f.type === "downlight" && f.id !== fittingId).map((f) => f.position);
          const aligned = alignToExistingPoints(raw, others);
          position = aligned.position;
          setAlignGuides({ x: aligned.guideX, y: aligned.guideY });
        } else {
          setAlignGuides(null);
        }
        setDragPreview({ id: fittingId, position });
      }
    },
    [walls, fittings]
  );

  const endPan = useCallback(() => {
    panState.current = null;
  }, []);

  const endDrag = useCallback(() => {
    if (dragState.current && dragPreview) {
      onFittingDrag?.(dragState.current.fittingId, dragPreview.position);
    }
    dragState.current = null;
    setDragPreview(null);
    setAlignGuides(null);
  }, [dragPreview, onFittingDrag]);

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
    [mode, panMode, px2scene, onFittingSelect, linkActiveSwitchId, onSwitchTap, onLinkTargetTap]
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
    const links: { key: string; switchPos: Point; targetPos: Point; active: boolean }[] = [];
    for (const sw of switches) {
      const swPos = dragPreview?.id === sw.id ? dragPreview.position : sw.position;
      const gangs = gangsFor(sw);
      gangs.forEach((gang, gangIndex) => {
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
    const lines: { key: string; from: Point; to: Point; label: string }[] = [];
    for (const f of fittings) {
      if (!f.measurement_lock) continue;
      const pos = dragPreview?.id === f.id ? dragPreview.position : f.position;
      const locks = [f.measurement_lock.wallA, f.measurement_lock.wallB].filter((l): l is WallLock => !!l);
      for (const lock of locks) {
        const wall = wallById.get(lock.wallId);
        if (!wall) continue;
        const to = closestPointOnWall(pos, wall);
        lines.push({ key: `${f.id}-${lock.wallId}`, from: pos, to, label: `${lock.distance.toFixed(2)}m` });
      }
    }
    return lines;
  }, [fittings, walls, layerVisibility?.measurements, dragPreview]);

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

        <g className="text-foreground">
          {walls.map((wall) => (
            <line key={wall.id} x1={wall.start.x} y1={wall.start.y} x2={wall.end.x} y2={wall.end.y} stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinecap="square" />
          ))}
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
            {switchLinks.map((link) => (
              <line
                key={link.key}
                x1={link.switchPos.x}
                y1={link.switchPos.y}
                x2={link.targetPos.x}
                y2={link.targetPos.y}
                className={link.active ? "text-primary" : "text-muted-foreground"}
                stroke="currentColor"
                strokeOpacity={link.active ? 0.8 : 0.35}
                strokeWidth={link.active ? 1.5 : 1}
                strokeDasharray="0.12 0.08"
                vectorEffect="non-scaling-stroke"
              />
            ))}
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
          <g className="text-sky-500" stroke="currentColor" strokeOpacity={0.7} strokeWidth={1} strokeDasharray="0.1 0.08" vectorEffect="non-scaling-stroke">
            {alignGuides.x != null && <line x1={alignGuides.x} y1={viewBox.y} x2={alignGuides.x} y2={viewBox.y + viewBox.h} />}
            {alignGuides.y != null && <line x1={viewBox.x} y1={alignGuides.y} x2={viewBox.x + viewBox.w} y2={alignGuides.y} />}
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
          // GPO/para-flood/1200-fluoro carry a `count` spec and GPO also a
          // `variant`; downlight carries `downlightSizeMm`. The shared
          // FITTING_SYMBOLS map is typed to the common SetoutSymbolProps
          // only, so these per-type extras are passed as a loosely-typed
          // spread here rather than threading a discriminated prop type
          // through the whole map — same "as any" escape hatch already used
          // elsewhere in this repo for similar type-widening spots.
          const symbolExtraProps: Record<string, unknown> =
            f.type === "gpo" || f.type === "para_flood" || f.type === "fluoro_1200"
              ? { count: f.specs.count ?? 1, ...(f.type === "gpo" ? { variant: f.specs.gpoVariant ?? "standard" } : {}) }
              : f.type === "downlight"
                ? { sizeMm: f.specs.downlightSizeMm ?? 90 }
                : f.type === "switch"
                  ? { gangCount: Math.min(4, gangsFor(f).length) }
                  : {};
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
