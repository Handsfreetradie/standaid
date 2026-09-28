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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    mutationKey: ["setout", "canvas", "create"],
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
    // Optimistic: a new tab should appear the instant it's tapped, offline or
    // not — a client-generated id stands in for the real row until onSuccess
    // swaps it out (see the CREATE recipe in useSetoutPlans.ts's
    // useUpdateSetoutFittingPosition comment for the general shape this and
    // every other optimistic mutation in this file follows).
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["setout_canvases", planId] });
      const previousCanvases = queryClient.getQueryData<SetoutCanvas[]>(["setout_canvases", planId]);
      const optimisticId = crypto.randomUUID();
      const now = new Date().toISOString();
      const optimisticCanvas: SetoutCanvas = {
        id: optimisticId,
        plan_id: planId,
        name: input.name,
        sort_order: input.sort_order,
        source_type: input.source_type,
        scale_calibration: null,
        walls: [],
        openings: [],
        wall_thickness: DEFAULT_WALL_THICKNESS,
        layer_visibility: DEFAULT_LAYER_VISIBILITY,
        background_image_path: null,
        background_image_content_type: null,
        source_file_path: null,
        source_file_content_type: null,
        created_at: now,
        updated_at: now,
      };
      queryClient.setQueryData<SetoutCanvas[]>(["setout_canvases", planId], (old) => [...(old ?? []), optimisticCanvas]);
      return { previousCanvases, optimisticId };
    },
    onError: (_err, _input, context) => {
      if (context?.previousCanvases) {
        queryClient.setQueryData(["setout_canvases", planId], context.previousCanvases);
      }
    },
    onSuccess: (data, _input, context) => {
      queryClient.setQueryData<SetoutCanvas[]>(["setout_canvases", planId], (old) =>
        old?.map((c) => (c.id === context?.optimisticId ? data : c))
      );
      queryClient.invalidateQueries({ queryKey: ["setout_canvases", planId] });
    },
  });
}

export function useRenameSetoutCanvas(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ["setout", "canvas", "rename"],
    mutationFn: async (input: { canvasId: string; name: string }) => {
      const { error } = await sb.from("setout_canvases").update({ name: input.name }).eq("id", input.canvasId);
      if (error) throw error;
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["setout_canvases", planId] });
      const previousCanvases = queryClient.getQueryData<SetoutCanvas[]>(["setout_canvases", planId]);
      queryClient.setQueryData<SetoutCanvas[]>(["setout_canvases", planId], (old) =>
        old?.map((c) => (c.id === input.canvasId ? { ...c, name: input.name } : c))
      );
      return { previousCanvases };
    },
    onError: (_err, _input, context) => {
      if (context?.previousCanvases) {
        queryClient.setQueryData(["setout_canvases", planId], context.previousCanvases);
      }
    },
    onSettled: () => {
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
    mutationKey: ["setout", "canvas", "delete"],
    mutationFn: async (canvasId: string) => {
      const { error } = await sb.from("setout_canvases").delete().eq("id", canvasId);
      if (error) throw error;
    },
    onMutate: async (canvasId) => {
      await queryClient.cancelQueries({ queryKey: ["setout_canvases", planId] });
      const previousCanvases = queryClient.getQueryData<SetoutCanvas[]>(["setout_canvases", planId]);
      queryClient.setQueryData<SetoutCanvas[]>(["setout_canvases", planId], (old) => old?.filter((c) => c.id !== canvasId));
      return { previousCanvases };
    },
    onError: (_err, _canvasId, context) => {
      if (context?.previousCanvases) {
        queryClient.setQueryData(["setout_canvases", planId], context.previousCanvases);
      }
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
    mutationKey: ["setout", "canvas", "update_geometry"],
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
    // Optimistic: the walls/openings drawing save — arguably the single most
    // important one in this file to get right offline, since a tradie
    // tracing walls on site needs to see them stick immediately, not sit
    // frozen until a bar of signal shows up.
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["setout_canvases", planId] });
      const previousCanvases = queryClient.getQueryData<SetoutCanvas[]>(["setout_canvases", planId]);
      queryClient.setQueryData<SetoutCanvas[]>(["setout_canvases", planId], (old) =>
        old?.map((c) =>
          c.id === canvasId
            ? {
                ...c,
                walls: input.walls,
                scale_calibration: input.scale_calibration,
                openings: input.openings ?? [],
                ...(input.background_image_path !== undefined ? { background_image_path: input.background_image_path } : {}),
                ...(input.background_image_content_type !== undefined ? { background_image_content_type: input.background_image_content_type } : {}),
                ...(input.source_file_path !== undefined ? { source_file_path: input.source_file_path } : {}),
                ...(input.source_file_content_type !== undefined ? { source_file_content_type: input.source_file_content_type } : {}),
              }
            : c
        )
      );
      return { previousCanvases };
    },
    onError: (_err, _input, context) => {
      if (context?.previousCanvases) {
        queryClient.setQueryData(["setout_canvases", planId], context.previousCanvases);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_canvases", planId] });
    },
  });
}

export function useUpdateSetoutCanvasLayerVisibility(canvasId: string, planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ["setout", "canvas", "update_layer_visibility"],
    mutationFn: async (layerVisibility: LayerVisibility) => {
      const { error } = await sb.from("setout_canvases").update({ layer_visibility: layerVisibility }).eq("id", canvasId);
      if (error) throw error;
    },
    onMutate: async (layerVisibility) => {
      await queryClient.cancelQueries({ queryKey: ["setout_canvases", planId] });
      const previousCanvases = queryClient.getQueryData<SetoutCanvas[]>(["setout_canvases", planId]);
      queryClient.setQueryData<SetoutCanvas[]>(["setout_canvases", planId], (old) =>
        old?.map((c) => (c.id === canvasId ? { ...c, layer_visibility: layerVisibility } : c))
      );
      return { previousCanvases };
    },
    onError: (_err, _layerVisibility, context) => {
      if (context?.previousCanvases) {
        queryClient.setQueryData(["setout_canvases", planId], context.previousCanvases);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_canvases", planId] });
    },
  });
}

export function useUpdateSetoutCanvasWallThickness(canvasId: string, planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ["setout", "canvas", "update_wall_thickness"],
    mutationFn: async (wallThickness: WallThickness) => {
      const { error } = await sb.from("setout_canvases").update({ wall_thickness: wallThickness }).eq("id", canvasId);
      if (error) throw error;
    },
    onMutate: async (wallThickness) => {
      await queryClient.cancelQueries({ queryKey: ["setout_canvases", planId] });
      const previousCanvases = queryClient.getQueryData<SetoutCanvas[]>(["setout_canvases", planId]);
      queryClient.setQueryData<SetoutCanvas[]>(["setout_canvases", planId], (old) =>
        old?.map((c) => (c.id === canvasId ? { ...c, wall_thickness: wallThickness } : c))
      );
      return { previousCanvases };
    },
    onError: (_err, _wallThickness, context) => {
      if (context?.previousCanvases) {
        queryClient.setQueryData(["setout_canvases", planId], context.previousCanvases);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_canvases", planId] });
    },
  });
}
