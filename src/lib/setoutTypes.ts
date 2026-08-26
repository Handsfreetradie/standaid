import type { FittingType } from "@/components/setout/symbols";

export type FittingCategory = "lighting" | "power" | "switches" | "data" | "safety";

export const CATEGORY_FOR_TYPE: Record<FittingType, FittingCategory> = {
  downlight: "lighting",
  gpo: "power",
  switch: "switches",
  smoke_detector: "safety",
  data: "data",
  exhaust_fan: "safety",
};

export interface Point {
  x: number;
  y: number;
}

// A wall segment in real-world metres, plan-local coordinate space.
export interface WallSegment {
  id: string;
  start: Point;
  end: Point;
}

export interface ScaleCalibration {
  pointA: Point;
  pointB: Point;
  realDistanceMetres: number;
}

export interface FittingSpecs {
  beamAngle?: number;
  mountingHeight?: number;
  wattage?: number;
}

export interface WallLock {
  wallId: string;
  distance: number;
}

export interface MeasurementLock {
  wallA: WallLock;
  wallB: WallLock;
}

export type FittingStatus = "placed" | "confirmed";

export interface SetoutFitting {
  id: string;
  plan_id: string;
  type: FittingType;
  position: Point;
  category: FittingCategory;
  specs: FittingSpecs;
  measurement_lock: MeasurementLock | null;
  status: FittingStatus;
  circuit_id: string | null;
  linked_to: string[];
  created_at: string;
  updated_at: string;
}

export type PlanSourceType = "import" | "draw";

export interface LayerVisibility {
  lighting: boolean;
  power: boolean;
  switches: boolean;
  data: boolean;
  safety: boolean;
  measurements: boolean;
}

export const DEFAULT_LAYER_VISIBILITY: LayerVisibility = {
  lighting: true,
  power: true,
  switches: true,
  data: true,
  safety: true,
  measurements: true,
};

export interface SetoutPlan {
  id: string;
  user_id: string;
  name: string;
  job_reference: string | null;
  source_type: PlanSourceType;
  scale_calibration: ScaleCalibration | null;
  walls: WallSegment[];
  layer_visibility: LayerVisibility;
  created_at: string;
  updated_at: string;
}

export interface SetoutCircuit {
  id: string;
  plan_id: string;
  label: string;
  description: string | null;
  breaker_rating: string | null;
  created_at: string;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
