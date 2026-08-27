import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import {
  DEFAULT_LAYER_VISIBILITY,
  type SetoutFitting,
  type SetoutPlan,
  type WallSegment,
  type ScaleCalibration,
  type PlanSourceType,
  type Point,
  type FittingCategory,
  type LayerVisibility,
  type FittingSpecs,
  type MeasurementLock,
  type WallOpening,
  CATEGORY_FOR_TYPE,
  gangsFor,
} from "@/lib/setoutTypes";
import type { FittingType } from "@/components/setout/symbols";

// setout_* tables are newer than the generated Supabase types — same `as any`
// escape hatch used elsewhere in this repo (e.g. AuditDetail.tsx) for tables
// ahead of a type regen.
const sb = supabase as any;

export function useSetoutPlans() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["setout_plans", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await sb
        .from("setout_plans")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data as SetoutPlan[];
    },
    enabled: !!user,
  });
}

export function useSetoutPlan(planId: string | undefined) {
  return useQuery({
    queryKey: ["setout_plan", planId],
    queryFn: async () => {
      const { data, error } = await sb
        .from("setout_plans")
        .select("*")
        .eq("id", planId)
        .single();
      if (error) throw error;
      return data as SetoutPlan;
    },
    enabled: !!planId,
  });
}

export function useSetoutFittings(planId: string | undefined) {
  return useQuery({
    queryKey: ["setout_fittings", planId],
    queryFn: async () => {
      const { data, error } = await sb
        .from("setout_fittings")
        .select("*")
        .eq("plan_id", planId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as SetoutFitting[];
    },
    enabled: !!planId,
  });
}

export function useCreateSetoutPlan() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { name: string; job_reference?: string; source_type: PlanSourceType }) => {
      if (!user) throw new Error("Not signed in");
      const { data, error } = await sb
        .from("setout_plans")
        .insert({
          user_id: user.id,
          name: input.name,
          job_reference: input.job_reference || null,
          source_type: input.source_type,
          walls: [],
          layer_visibility: DEFAULT_LAYER_VISIBILITY,
        })
        .select()
        .single();
      if (error) throw error;
      return data as SetoutPlan;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_plans"] });
    },
  });
}

export function useUpdateSetoutPlanGeometry(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      walls: WallSegment[];
      scale_calibration: ScaleCalibration | null;
      openings?: WallOpening[];
      background_image_path?: string;
      background_image_content_type?: string;
    }) => {
      // background_image_path/content_type are only ever set once, at
      // initial import save (CalibrationImportFlow.tsx) — later geometry-
      // only saves (e.g. EditWallsFlow.tsx) don't pass them, and must not
      // wipe out an already-saved reference image, so they're only
      // included in the update when actually provided.
      const update: Record<string, unknown> = { walls: input.walls, scale_calibration: input.scale_calibration, openings: input.openings ?? [] };
      if (input.background_image_path !== undefined) update.background_image_path = input.background_image_path;
      if (input.background_image_content_type !== undefined) update.background_image_content_type = input.background_image_content_type;
      const { data, error } = await sb
        .from("setout_plans")
        .update(update)
        .eq("id", planId)
        .select()
        .single();
      if (error) throw error;
      return data as SetoutPlan;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_plan", planId] });
      queryClient.invalidateQueries({ queryKey: ["setout_plans"] });
    },
  });
}

export function useUpdateSetoutPlanLayerVisibility(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (layerVisibility: LayerVisibility) => {
      const { error } = await sb
        .from("setout_plans")
        .update({ layer_visibility: layerVisibility })
        .eq("id", planId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_plan", planId] });
      queryClient.invalidateQueries({ queryKey: ["setout_plans"] });
    },
  });
}

export function useUpdateSetoutFittingSpecs(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { fittingId: string; specs: FittingSpecs }) => {
      const { error } = await sb
        .from("setout_fittings")
        .update({ specs: input.specs })
        .eq("id", input.fittingId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_fittings", planId] });
    },
  });
}

export function useDeleteSetoutPlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (planId: string) => {
      const { error } = await sb.from("setout_plans").delete().eq("id", planId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_plans"] });
    },
  });
}

export function useCreateSetoutFitting(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { type: FittingType; position: Point; measurement_lock?: MeasurementLock | null; specs?: FittingSpecs }) => {
      const category: FittingCategory = CATEGORY_FOR_TYPE[input.type];
      const { data, error } = await sb
        .from("setout_fittings")
        .insert({
          plan_id: planId,
          type: input.type,
          position: input.position,
          category,
          specs: input.specs ?? {},
          measurement_lock: input.measurement_lock ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data as SetoutFitting;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_fittings", planId] });
    },
  });
}

// Bulk variant of useCreateSetoutFitting — a single multi-row insert for
// when a whole batch of fittings lands at once (AI plan-import extraction),
// rather than one round trip per fitting.
export function useCreateSetoutFittingsBulk(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (inputs: { type: FittingType; position: Point; measurement_lock?: MeasurementLock | null; specs?: FittingSpecs }[]) => {
      if (inputs.length === 0) return [] as SetoutFitting[];
      const rows = inputs.map((input) => ({
        plan_id: planId,
        type: input.type,
        position: input.position,
        category: CATEGORY_FOR_TYPE[input.type],
        specs: input.specs ?? {},
        measurement_lock: input.measurement_lock ?? null,
      }));
      const { data, error } = await sb.from("setout_fittings").insert(rows).select();
      if (error) throw error;
      return data as SetoutFitting[];
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_fittings", planId] });
    },
  });
}

// Re-inserts a fitting with its original id and all fields intact — used
// by undo to bring back a just-deleted fitting exactly as it was,
// including any circuit assignment or switch-gang links pointing at it
// (which a fresh insert with a new id would otherwise silently orphan).
export function useRestoreSetoutFitting(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (fitting: SetoutFitting) => {
      const { error } = await sb.from("setout_fittings").insert({
        id: fitting.id,
        plan_id: fitting.plan_id,
        type: fitting.type,
        position: fitting.position,
        category: fitting.category,
        specs: fitting.specs,
        measurement_lock: fitting.measurement_lock,
        status: fitting.status,
        circuit_id: fitting.circuit_id,
        linked_to: fitting.linked_to,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_fittings", planId] });
    },
  });
}

// Toggles a target fitting in/out of one gang of a switch plate. Gangs are
// independent loop-in chains (specs.gangs: string[][]) — a 2-gang plate has
// two separate chains, e.g. gang 1 running 4 downlights and gang 2 running
// an exhaust fan on its own. There's no separate "2-way/3-way" field: a
// light is N-way switched purely because it shows up in N different gangs
// (across any switches), derived the same way regardless of which gang or
// plate each occurrence came from.
export function useToggleGangLink(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { switchFitting: SetoutFitting; gangIndex: number; targetId: string }) => {
      const gangs = gangsFor(input.switchFitting).map((gang) => [...gang]);
      while (gangs.length <= input.gangIndex) gangs.push([]);
      const gang = gangs[input.gangIndex];
      gangs[input.gangIndex] = gang.includes(input.targetId) ? gang.filter((id) => id !== input.targetId) : [...gang, input.targetId];
      const { error } = await sb
        .from("setout_fittings")
        .update({ specs: { ...input.switchFitting.specs, gangs } })
        .eq("id", input.switchFitting.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_fittings", planId] });
    },
  });
}

// Adds a new empty gang to a switch plate (e.g. going from a 1-gang to a
// 2-gang switch) and bumps its `specs.count` to match, since GpoSymbol-style
// count already drives which switch glyph (1/2/3/4-gang) gets drawn.
export function useAddSwitchGang(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (switchFitting: SetoutFitting) => {
      const gangs = [...gangsFor(switchFitting), []];
      const { error } = await sb
        .from("setout_fittings")
        .update({ specs: { ...switchFitting.specs, gangs, count: gangs.length } })
        .eq("id", switchFitting.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_fittings", planId] });
    },
  });
}

// Removes a gang entirely (not just clearing its links) — e.g. undoing an
// accidental "+ Add gang".
export function useRemoveSwitchGang(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { switchFitting: SetoutFitting; gangIndex: number }) => {
      const gangs = gangsFor(input.switchFitting).filter((_, i) => i !== input.gangIndex);
      const { error } = await sb
        .from("setout_fittings")
        .update({ specs: { ...input.switchFitting.specs, gangs, count: Math.max(1, gangs.length) } })
        .eq("id", input.switchFitting.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_fittings", planId] });
    },
  });
}

export function useUpdateSetoutFittingStatus(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { fittingId: string; status: "placed" | "confirmed" }) => {
      const { error } = await sb.from("setout_fittings").update({ status: input.status }).eq("id", input.fittingId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_fittings", planId] });
    },
  });
}

export function useUpdateSetoutFittingPosition(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { fittingId: string; position: Point; measurement_lock: MeasurementLock | null; specs?: FittingSpecs }) => {
      const update: Record<string, unknown> = { position: input.position, measurement_lock: input.measurement_lock };
      if (input.specs) update.specs = input.specs;
      const { error } = await sb.from("setout_fittings").update(update).eq("id", input.fittingId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_fittings", planId] });
    },
  });
}

// Hand-entered correction to a fitting's locked measurement(s) — e.g. the
// laser on site reads slightly different from what the drawn plan implies.
// Does NOT touch position; a later drag still re-locks from geometry and
// overwrites this, which is expected since moving the fitting changes the
// real distance anyway.
export function useUpdateSetoutFittingMeasurementLock(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { fittingId: string; measurement_lock: MeasurementLock }) => {
      const { error } = await sb
        .from("setout_fittings")
        .update({ measurement_lock: input.measurement_lock })
        .eq("id", input.fittingId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_fittings", planId] });
    },
  });
}

export function useDeleteSetoutFitting(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (fittingId: string) => {
      const { error } = await sb.from("setout_fittings").delete().eq("id", fittingId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_fittings", planId] });
    },
  });
}
