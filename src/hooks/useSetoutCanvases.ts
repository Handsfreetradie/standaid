import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import {
  DEFAULT_LAYER_VISIBILITY,
  DEFAULT_WALL_THICKNESS,
  type SetoutCanvas,
  type WallSegment,
  type WallOpening,
  type ScaleCalibration,
  type LayerVisibility,
  type WallThickness,
  type PlanSourceType,
} from "@/lib/setoutTypes";

// setout_canvases is newer than the generated Supabase types — same `as any`
// escape hatch used throughout useSetoutPlans.ts for tables ahead of a type
// regen.
const sb = supabase as any;

// One canvas per job, keyed by plan_id — the lowest sort_order (first-
// created) canvas for each plan the signed-in tradie owns. RLS scopes this
// to their own rows with no explicit user_id filter needed. Used on the
// plans list (Setout.tsx) to work out whether a job's first canvas has been
// drawn yet ("Setup incomplete" badge) without an N+1 query per plan, and to
// resume straight into that canvas's setup flow if not.
export function usePrimarySetoutCanvases() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["setout_canvases_primary", user?.id],
    queryFn: async () => {
      if (!user) return new Map<string, SetoutCanvas>();
      const { data, error } = await sb.from("setout_canvases").select("*").order("sort_order", { ascending: true });
      if (error) throw error;
      const byPlan = new Map<string, SetoutCanvas>();
      for (const row of data as SetoutCanvas[]) {
        if (!byPlan.has(row.plan_id)) byPlan.set(row.plan_id, row);
      }
      return byPlan;
    },
    enabled: !!user,
  });
}

export function useSetoutCanvases(planId: string | undefined) {
  return useQuery({
    queryKey: ["setout_canvases", planId],
    queryFn: async () => {
      const { data, error } = await sb
        .from("setout_canvases")
        .select("*")
        .eq("plan_id", planId)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data as SetoutCanvas[];
    },
    enabled: !!planId,
  });
}

export function useCreateSetoutCanvas(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { name: string; source_type: PlanSourceType; sort_order: number }) => {
      const { data, error } = await sb
        .from("setout_canvases")
        .insert({
          plan_id: planId,
          name: input.name,
          sort_order: input.sort_order,
          source_type: input.source_type,
          walls: [],
          layer_visibility: DEFAULT_LAYER_VISIBILITY,
          wall_thickness: DEFAULT_WALL_THICKNESS,
        })
        .select()
        .single();
      if (error) throw error;
      return data as SetoutCanvas;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_canvases", planId] });
    },
  });
}

export function useRenameSetoutCanvas(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { canvasId: string; name: string }) => {
      const { error } = await sb.from("setout_canvases").update({ name: input.name }).eq("id", input.canvasId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_canvases", planId] });
    },
  });
}

// Cascades to that canvas's fittings/photo points via ON DELETE CASCADE.
// Callers must block this when it's the last remaining canvas — a job
// always needs at least one drawing surface.
export function useDeleteSetoutCanvas(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (canvasId: string) => {
      const { error } = await sb.from("setout_canvases").delete().eq("id", canvasId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_canvases", planId] });
      queryClient.invalidateQueries({ queryKey: ["setout_fittings", planId] });
      queryClient.invalidateQueries({ queryKey: ["setout_photo_points", planId] });
    },
  });
}

export function useUpdateSetoutCanvasGeometry(canvasId: string, planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      walls: WallSegment[];
      scale_calibration: ScaleCalibration | null;
      openings?: WallOpening[];
      background_image_path?: string;
      background_image_content_type?: string;
      source_file_path?: string;
      source_file_content_type?: string;
    }) => {
      // background_image_path/content_type are only ever set once, at
      // initial import save (CalibrationImportFlow.tsx) — later geometry-
      // only saves (e.g. EditWallsFlow.tsx) don't pass them, and must not
      // wipe out an already-saved reference image, so they're only
      // included in the update when actually provided.
      const update: Record<string, unknown> = { walls: input.walls, scale_calibration: input.scale_calibration, openings: input.openings ?? [] };
      if (input.background_image_path !== undefined) update.background_image_path = input.background_image_path;
      if (input.background_image_content_type !== undefined) update.background_image_content_type = input.background_image_content_type;
      if (input.source_file_path !== undefined) update.source_file_path = input.source_file_path;
      if (input.source_file_content_type !== undefined) update.source_file_content_type = input.source_file_content_type;
      const { data, error } = await sb
        .from("setout_canvases")
        .update(update)
        .eq("id", canvasId)
        .select()
        .single();
      if (error) throw error;
      return data as SetoutCanvas;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_canvases", planId] });
    },
  });
}

export function useUpdateSetoutCanvasLayerVisibility(canvasId: string, planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (layerVisibility: LayerVisibility) => {
      const { error } = await sb.from("setout_canvases").update({ layer_visibility: layerVisibility }).eq("id", canvasId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_canvases", planId] });
    },
  });
}

export function useUpdateSetoutCanvasWallThickness(canvasId: string, planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (wallThickness: WallThickness) => {
      const { error } = await sb.from("setout_canvases").update({ wall_thickness: wallThickness }).eq("id", canvasId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_canvases", planId] });
    },
  });
}
