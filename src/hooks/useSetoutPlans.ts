import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import {
  DEFAULT_LAYER_VISIBILITY,
  DEFAULT_WALL_THICKNESS,
  type SetoutFitting,
  type SetoutPhotoPoint,
  type PhotoPointType,
  type SetoutPlan,
  type SetoutCanvas,
  type PlanSourceType,
  type Point,
  type FittingCategory,
  type FittingSpecs,
  type MeasurementLock,
  type PlanDefaults,
  CATEGORY_FOR_TYPE,
  gangsFor,
} from "@/lib/setoutTypes";
import type { FittingType } from "@/components/setout/symbols";

// setout_* tables are newer than the generated Supabase types — same `as any`
// escape hatch used elsewhere in this repo (e.g. AuditDetail.tsx) for tables
// ahead of a type regen.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

export function useSetoutPhotoPoints(planId: string | undefined) {
  return useQuery({
    queryKey: ["setout_photo_points", planId],
    queryFn: async () => {
      const { data, error } = await sb
        .from("setout_photo_points")
        .select("*")
        .eq("plan_id", planId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as SetoutPhotoPoint[];
    },
    enabled: !!planId,
  });
}

export function useCreateSetoutPhotoPoint(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ["setout", "photo_point", "create"],
    mutationFn: async (input: { canvas_id: string; position: Point; storage_path: string; photo_type?: PhotoPointType }) => {
      const { data, error } = await sb
        .from("setout_photo_points")
        .insert({
          plan_id: planId,
          canvas_id: input.canvas_id,
          position: input.position,
          storage_path: input.storage_path,
          photo_type: input.photo_type ?? "flat",
        })
        .select()
        .single();
      if (error) throw error;
      return data as SetoutPhotoPoint;
    },
    // Optimistic create: build a full row client-side (temp id) so the pin
    // shows up on the plan immediately, whether or not the tradie has
    // signal. onSuccess swaps the temp row for the server-confirmed one.
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["setout_photo_points", planId] });
      const previousPhotoPoints = queryClient.getQueryData<SetoutPhotoPoint[]>(["setout_photo_points", planId]);
      const optimisticId = crypto.randomUUID();
      const now = new Date().toISOString();
      const optimisticPhotoPoint: SetoutPhotoPoint = {
        id: optimisticId,
        plan_id: planId,
        canvas_id: input.canvas_id,
        position: input.position,
        storage_path: input.storage_path,
        direction_degrees: null,
        photo_type: input.photo_type ?? "flat",
        created_at: now,
        updated_at: now,
      };
      queryClient.setQueryData<SetoutPhotoPoint[]>(["setout_photo_points", planId], (old) => [...(old ?? []), optimisticPhotoPoint]);
      return { previousPhotoPoints, optimisticId };
    },
    onError: (_err, _input, context) => {
      if (context?.previousPhotoPoints) {
        queryClient.setQueryData(["setout_photo_points", planId], context.previousPhotoPoints);
      }
    },
    onSuccess: (data, _input, context) => {
      queryClient.setQueryData<SetoutPhotoPoint[]>(["setout_photo_points", planId], (old) =>
        old?.map((p) => (p.id === context?.optimisticId ? data : p))
      );
      queryClient.invalidateQueries({ queryKey: ["setout_photo_points", planId] });
    },
  });
}

export function useUpdateSetoutPhotoPointDirection(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ["setout", "photo_point", "update_direction"],
    mutationFn: async (input: { photoPointId: string; direction_degrees: number | null }) => {
      const { error } = await sb
        .from("setout_photo_points")
        .update({ direction_degrees: input.direction_degrees })
        .eq("id", input.photoPointId);
      if (error) throw error;
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["setout_photo_points", planId] });
      const previousPhotoPoints = queryClient.getQueryData<SetoutPhotoPoint[]>(["setout_photo_points", planId]);
      queryClient.setQueryData<SetoutPhotoPoint[]>(["setout_photo_points", planId], (old) =>
        old?.map((p) => (p.id === input.photoPointId ? { ...p, direction_degrees: input.direction_degrees } : p))
      );
      return { previousPhotoPoints };
    },
    onError: (_err, _input, context) => {
      if (context?.previousPhotoPoints) {
        queryClient.setQueryData(["setout_photo_points", planId], context.previousPhotoPoints);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_photo_points", planId] });
    },
  });
}

// Deletes the row first (source of truth for what shows on the plan), then
// best-effort removes the storage file — an orphaned file left behind by a
// failed remove is harmless, whereas leaving the row behind would show a
// pin with no photo.
export function useDeleteSetoutPhotoPoint(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ["setout", "photo_point", "delete"],
    mutationFn: async (photoPoint: SetoutPhotoPoint) => {
      const { error } = await sb.from("setout_photo_points").delete().eq("id", photoPoint.id);
      if (error) throw error;
      await supabase.storage.from("setout-photo-points").remove([photoPoint.storage_path]);
    },
    onMutate: async (photoPoint) => {
      await queryClient.cancelQueries({ queryKey: ["setout_photo_points", planId] });
      const previousPhotoPoints = queryClient.getQueryData<SetoutPhotoPoint[]>(["setout_photo_points", planId]);
      queryClient.setQueryData<SetoutPhotoPoint[]>(["setout_photo_points", planId], (old) =>
        old?.filter((p) => p.id !== photoPoint.id)
      );
      return { previousPhotoPoints };
    },
    onError: (_err, _photoPoint, context) => {
      if (context?.previousPhotoPoints) {
        queryClient.setQueryData(["setout_photo_points", planId], context.previousPhotoPoints);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_photo_points", planId] });
    },
  });
}

// Creates the job row plus its first canvas ("Ground Floor") in one go — a
// job always needs at least one drawing surface to be usable. Not atomic
// (the JS client has no cross-table transaction), so a canvas-insert failure
// after a successful plan-insert is caught and the plan is still returned
// with canvas: null rather than throwing — the caller can retry creating a
// canvas onto an existing plan rather than being left with nothing at all.
export function useCreateSetoutPlan() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ["setout", "plan", "create"],
    mutationFn: async (input: { name: string; job_reference?: string; source_type: PlanSourceType }) => {
      if (!user) throw new Error("Not signed in");
      const { data: plan, error } = await sb
        .from("setout_plans")
        .insert({
          user_id: user.id,
          name: input.name,
          job_reference: input.job_reference || null,
          source_type: input.source_type,
        })
        .select()
        .single();
      if (error) throw error;

      let canvas: SetoutCanvas | null = null;
      try {
        const { data: canvasData, error: canvasError } = await sb
          .from("setout_canvases")
          .insert({
            plan_id: plan.id,
            name: "Ground Floor",
            sort_order: 0,
            source_type: input.source_type,
            walls: [],
            layer_visibility: DEFAULT_LAYER_VISIBILITY,
            wall_thickness: DEFAULT_WALL_THICKNESS,
          })
          .select()
          .single();
        if (canvasError) throw canvasError;
        canvas = canvasData as SetoutCanvas;
      } catch (canvasError) {
        console.error("Failed to create the plan's first canvas", canvasError);
      }
      return { plan: plan as SetoutPlan, canvas };
    },
    // Optimistic create: build a full SetoutPlan row client-side (temp id,
    // every job-wide field the DB would otherwise default) so a new job
    // shows up in the list immediately even with no signal. Note: the
    // canvas half of this mutation has no cache to update optimistically
    // (canvases aren't read through this file's hooks), so only the plan
    // row is optimistic here.
    onMutate: async (input) => {
      if (!user) return {};
      await queryClient.cancelQueries({ queryKey: ["setout_plans", user.id] });
      const previousPlans = queryClient.getQueryData<SetoutPlan[]>(["setout_plans", user.id]);
      const optimisticId = crypto.randomUUID();
      const now = new Date().toISOString();
      const optimisticPlan: SetoutPlan = {
        id: optimisticId,
        user_id: user.id,
        name: input.name,
        job_reference: input.job_reference || null,
        source_type: input.source_type,
        scale_calibration: null,
        walls: [],
        openings: [],
        layer_visibility: DEFAULT_LAYER_VISIBILITY,
        wall_thickness: DEFAULT_WALL_THICKNESS,
        background_image_path: null,
        source_file_path: null,
        source_file_content_type: null,
        background_image_content_type: null,
        plan_defaults: {},
        export_token: crypto.randomUUID().replace(/-/g, ""),
        created_at: now,
        updated_at: now,
      };
      queryClient.setQueryData<SetoutPlan[]>(["setout_plans", user.id], (old) => [optimisticPlan, ...(old ?? [])]);
      return { previousPlans, optimisticId };
    },
    onError: (_err, _input, context) => {
      if (user && context?.previousPlans) {
        queryClient.setQueryData(["setout_plans", user.id], context.previousPlans);
      }
    },
    onSuccess: (data, _input, context) => {
      if (user) {
        queryClient.setQueryData<SetoutPlan[]>(["setout_plans", user.id], (old) =>
          old?.map((p) => (p.id === context?.optimisticId ? data.plan : p))
        );
      }
      queryClient.invalidateQueries({ queryKey: ["setout_plans"] });
    },
  });
}

// Job-wide seed values (twin downlight spacing, LED watts per metre). Only
// ever read when a fitting is placed — see PlanDefaults — so saving these
// never has to touch the fittings already on the plan.
export function useUpdateSetoutPlanDefaults(planId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ["setout", "plan", "update_defaults"],
    mutationFn: async (planDefaults: PlanDefaults) => {
      const { error } = await sb
        .from("setout_plans")
        .update({ plan_defaults: planDefaults })
        .eq("id", planId);
      if (error) throw error;
    },
    onMutate: async (planDefaults) => {
      await queryClient.cancelQueries({ queryKey: ["setout_plan", planId] });
      await queryClient.cancelQueries({ queryKey: ["setout_plans", user?.id] });
      const previousPlan = queryClient.getQueryData<SetoutPlan>(["setout_plan", planId]);
      const previousPlans = queryClient.getQueryData<SetoutPlan[]>(["setout_plans", user?.id]);
      queryClient.setQueryData<SetoutPlan>(["setout_plan", planId], (old) => (old ? { ...old, plan_defaults: planDefaults } : old));
      queryClient.setQueryData<SetoutPlan[]>(["setout_plans", user?.id], (old) =>
        old?.map((p) => (p.id === planId ? { ...p, plan_defaults: planDefaults } : p))
      );
      return { previousPlan, previousPlans };
    },
    onError: (_err, _planDefaults, context) => {
      if (context?.previousPlan) {
        queryClient.setQueryData(["setout_plan", planId], context.previousPlan);
      }
      if (context?.previousPlans) {
        queryClient.setQueryData(["setout_plans", user?.id], context.previousPlans);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_plan", planId] });
      queryClient.invalidateQueries({ queryKey: ["setout_plans"] });
    },
  });
}

// Revokes the current public export link and mints a fresh one — "Revoke
// and make a new link" in ShareReportDialog. Removing the old PDF first
// (best-effort: a failure there must not block getting a new token, an
// orphaned old file costs nothing but a little storage space) means the old
// link stops resolving even before the plan is re-exported under the new
// token; the caller re-runs the export straight after this resolves so the
// QR code and the new link agree again.
export function useRotateSetoutExportToken(planId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ["setout", "plan", "rotate_export_token"],
    mutationFn: async (currentExportToken: string | null | undefined) => {
      if (!user) throw new Error("Not signed in");
      if (currentExportToken) {
        const { error: removeError } = await supabase.storage
          .from("setout-plan-exports")
          .remove([`${user.id}/${currentExportToken}.pdf`]);
        if (removeError) console.warn("[useRotateSetoutExportToken] Could not remove the old export:", removeError);
      }
      // 32 hex characters (16 random bytes) — same shape as the token every
      // plan already gets on creation (a DB default), just generated
      // client-side here since this is a deliberate rotation, not a fresh row.
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      const nextToken = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      const { data, error } = await sb
        .from("setout_plans")
        .update({ export_token: nextToken })
        .eq("id", planId)
        .select()
        .single();
      if (error) throw error;
      return data as SetoutPlan;
    },
    // Optimistic: generate our own placeholder token (same 32-hex shape as
    // the real one) so the share dialog's link/QR updates immediately;
    // onSuccess below overwrites it with the server-confirmed token once
    // the round trip actually completes.
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["setout_plan", planId] });
      await queryClient.cancelQueries({ queryKey: ["setout_plans", user?.id] });
      const previousPlan = queryClient.getQueryData<SetoutPlan>(["setout_plan", planId]);
      const previousPlans = queryClient.getQueryData<SetoutPlan[]>(["setout_plans", user?.id]);
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      const optimisticToken = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      queryClient.setQueryData<SetoutPlan>(["setout_plan", planId], (old) => (old ? { ...old, export_token: optimisticToken } : old));
      queryClient.setQueryData<SetoutPlan[]>(["setout_plans", user?.id], (old) =>
        old?.map((p) => (p.id === planId ? { ...p, export_token: optimisticToken } : p))
      );
      return { previousPlan, previousPlans };
    },
    onError: (_err, _currentExportToken, context) => {
      if (context?.previousPlan) {
        queryClient.setQueryData(["setout_plan", planId], context.previousPlan);
      }
      if (context?.previousPlans) {
        queryClient.setQueryData(["setout_plans", user?.id], context.previousPlans);
      }
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
    mutationKey: ["setout", "fitting", "update_specs"],
    mutationFn: async (input: { fittingId: string; specs: FittingSpecs }) => {
      const { error } = await sb
        .from("setout_fittings")
        .update({ specs: input.specs })
        .eq("id", input.fittingId);
      if (error) throw error;
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["setout_fittings", planId] });
      const previousFittings = queryClient.getQueryData<SetoutFitting[]>(["setout_fittings", planId]);
      queryClient.setQueryData<SetoutFitting[]>(["setout_fittings", planId], (old) =>
        old?.map((f) => (f.id === input.fittingId ? { ...f, specs: input.specs } : f))
      );
      return { previousFittings };
    },
    onError: (_err, _input, context) => {
      if (context?.previousFittings) {
        queryClient.setQueryData(["setout_fittings", planId], context.previousFittings);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_fittings", planId] });
    },
  });
}

// Every upload flow for this plan (CalibrationImportFlow's background/source
// image, SetoutPlan's photo points, VoiceNotesPanel's recordings) writes its
// files straight under `${user.id}/${planId}/...` in its own bucket — see
// each flow's own upload call — so listing that one folder per bucket finds
// every file belonging to this plan, across every canvas in the job, with
// no need to separately walk setout_canvases. Best-effort only: a storage
// failure here must never block the row delete (an orphaned file left
// behind costs nothing but a little space; a plan stuck undeletable because
// storage hiccupped would be far worse), so every failure is caught and
// logged rather than thrown.
async function cleanupSetoutPlanStorage(planId: string, userId: string): Promise<void> {
  const folder = `${userId}/${planId}`;
  for (const bucket of ["setout-plan-uploads", "setout-photo-points", "setout-voice-notes"] as const) {
    try {
      const { data: files, error } = await supabase.storage.from(bucket).list(folder);
      if (error) {
        console.warn(`[useDeleteSetoutPlan] Could not list ${bucket} for cleanup:`, error);
        continue;
      }
      if (!files || files.length === 0) continue;
      const paths = files.map((f) => `${folder}/${f.name}`);
      const { error: removeError } = await supabase.storage.from(bucket).remove(paths);
      if (removeError) console.warn(`[useDeleteSetoutPlan] Could not remove files from ${bucket}:`, removeError);
    } catch (err) {
      console.warn(`[useDeleteSetoutPlan] Storage cleanup failed for ${bucket}:`, err);
    }
  }
}

// The exported PDF is named by the plan's export_token, not its id (see
// SetoutPlan.export_token) — a separate, best-effort removal since it's a
// single known path rather than a folder listing.
async function cleanupSetoutPlanExport(planId: string, userId: string, queryClient: QueryClient): Promise<void> {
  try {
    let exportToken: string | null | undefined = queryClient
      .getQueryData<SetoutPlan[]>(["setout_plans", userId])
      ?.find((p) => p.id === planId)?.export_token;
    if (exportToken === undefined) {
      const { data, error } = await sb.from("setout_plans").select("export_token").eq("id", planId).single();
      if (error) {
        console.warn("[useDeleteSetoutPlan] Could not look up export_token for cleanup:", error);
        return;
      }
      exportToken = data?.export_token ?? null;
    }
    if (!exportToken) return;
    const { error: removeError } = await supabase.storage.from("setout-plan-exports").remove([`${userId}/${exportToken}.pdf`]);
    if (removeError) console.warn("[useDeleteSetoutPlan] Could not remove exported PDF:", removeError);
  } catch (err) {
    console.warn("[useDeleteSetoutPlan] Export cleanup failed:", err);
  }
}

export function useDeleteSetoutPlan() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ["setout", "plan", "delete"],
    mutationFn: async (planId: string) => {
      if (user) {
        await cleanupSetoutPlanStorage(planId, user.id);
        await cleanupSetoutPlanExport(planId, user.id, queryClient);
      }
      const { error } = await sb.from("setout_plans").delete().eq("id", planId);
      if (error) throw error;
    },
    onMutate: async (planId) => {
      await queryClient.cancelQueries({ queryKey: ["setout_plans", user?.id] });
      const previousPlans = queryClient.getQueryData<SetoutPlan[]>(["setout_plans", user?.id]);
      queryClient.setQueryData<SetoutPlan[]>(["setout_plans", user?.id], (old) => old?.filter((p) => p.id !== planId));
      return { previousPlans };
    },
    onError: (_err, _planId, context) => {
      if (context?.previousPlans) {
        queryClient.setQueryData(["setout_plans", user?.id], context.previousPlans);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_plans"] });
    },
  });
}

export function useCreateSetoutFitting(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ["setout", "fitting", "create"],
    mutationFn: async (input: { canvas_id: string; type: FittingType; position: Point; measurement_lock?: MeasurementLock | null; specs?: FittingSpecs }) => {
      const category: FittingCategory = CATEGORY_FOR_TYPE[input.type];
      const { data, error } = await sb
        .from("setout_fittings")
        .insert({
          plan_id: planId,
          canvas_id: input.canvas_id,
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
    // Optimistic create: a placed fitting should appear on the canvas
    // instantly. Temp id + every DB-defaulted field filled in client-side;
    // onSuccess swaps it for the server-confirmed row.
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["setout_fittings", planId] });
      const previousFittings = queryClient.getQueryData<SetoutFitting[]>(["setout_fittings", planId]);
      const optimisticId = crypto.randomUUID();
      const now = new Date().toISOString();
      const optimisticFitting: SetoutFitting = {
        id: optimisticId,
        plan_id: planId,
        canvas_id: input.canvas_id,
        type: input.type,
        position: input.position,
        category: CATEGORY_FOR_TYPE[input.type],
        specs: input.specs ?? {},
        measurement_lock: input.measurement_lock ?? null,
        status: "placed",
        circuit_id: null,
        linked_to: [],
        created_at: now,
        updated_at: now,
      };
      queryClient.setQueryData<SetoutFitting[]>(["setout_fittings", planId], (old) => [...(old ?? []), optimisticFitting]);
      return { previousFittings, optimisticId };
    },
    onError: (_err, _input, context) => {
      if (context?.previousFittings) {
        queryClient.setQueryData(["setout_fittings", planId], context.previousFittings);
      }
    },
    onSuccess: (data, _input, context) => {
      queryClient.setQueryData<SetoutFitting[]>(["setout_fittings", planId], (old) =>
        old?.map((f) => (f.id === context?.optimisticId ? data : f))
      );
      queryClient.invalidateQueries({ queryKey: ["setout_fittings", planId] });
    },
  });
}

// Bulk variant of useCreateSetoutFitting — a single multi-row insert for
// when a whole batch of fittings lands at once (AI plan-import extraction,
// or re-adding a batch of fittings after a bulk delete elsewhere), rather
// than one round trip per fitting.
export function useBulkCreateSetoutFittings(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ["setout", "fitting", "bulk_create"],
    mutationFn: async (inputs: { canvas_id: string; type: FittingType; position: Point; measurement_lock?: MeasurementLock | null; specs?: FittingSpecs }[]) => {
      if (inputs.length === 0) return [] as SetoutFitting[];
      const rows = inputs.map((input) => ({
        plan_id: planId,
        canvas_id: input.canvas_id,
        type: input.type,
        position: input.position,
        category: CATEGORY_FOR_TYPE[input.type],
        specs: input.specs ?? {},
        measurement_lock: input.measurement_lock ?? null,
      }));
      // A single multi-row insert — Postgres/PostgREST return the inserted
      // rows in the same order as the VALUES list, so onSuccess below can
      // zip the returned rows back onto the optimistic temp ids positionally.
      const { data, error } = await sb.from("setout_fittings").insert(rows).select();
      if (error) throw error;
      return data as SetoutFitting[];
    },
    onMutate: async (inputs) => {
      await queryClient.cancelQueries({ queryKey: ["setout_fittings", planId] });
      const previousFittings = queryClient.getQueryData<SetoutFitting[]>(["setout_fittings", planId]);
      const now = new Date().toISOString();
      const optimisticFittings: SetoutFitting[] = inputs.map((input) => ({
        id: crypto.randomUUID(),
        plan_id: planId,
        canvas_id: input.canvas_id,
        type: input.type,
        position: input.position,
        category: CATEGORY_FOR_TYPE[input.type],
        specs: input.specs ?? {},
        measurement_lock: input.measurement_lock ?? null,
        status: "placed",
        circuit_id: null,
        linked_to: [],
        created_at: now,
        updated_at: now,
      }));
      queryClient.setQueryData<SetoutFitting[]>(["setout_fittings", planId], (old) => [...(old ?? []), ...optimisticFittings]);
      return { previousFittings, optimisticIds: optimisticFittings.map((f) => f.id) };
    },
    onError: (_err, _inputs, context) => {
      if (context?.previousFittings) {
        queryClient.setQueryData(["setout_fittings", planId], context.previousFittings);
      }
    },
    onSuccess: (data, _inputs, context) => {
      if (!context) return;
      const realById = new Map(context.optimisticIds.map((id, i) => [id, data[i]]));
      queryClient.setQueryData<SetoutFitting[]>(["setout_fittings", planId], (old) => old?.map((f) => realById.get(f.id) ?? f));
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
    mutationKey: ["setout", "fitting", "restore"],
    mutationFn: async (fitting: SetoutFitting) => {
      const { error } = await sb.from("setout_fittings").insert({
        id: fitting.id,
        plan_id: fitting.plan_id,
        canvas_id: fitting.canvas_id,
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
    // Optimistic create, but no id generation — the fitting being restored
    // already carries its original id/fields, so that's the "optimistic" row.
    onMutate: async (fitting) => {
      await queryClient.cancelQueries({ queryKey: ["setout_fittings", planId] });
      const previousFittings = queryClient.getQueryData<SetoutFitting[]>(["setout_fittings", planId]);
      queryClient.setQueryData<SetoutFitting[]>(["setout_fittings", planId], (old) => [...(old ?? []), fitting]);
      return { previousFittings };
    },
    onError: (_err, _fitting, context) => {
      if (context?.previousFittings) {
        queryClient.setQueryData(["setout_fittings", planId], context.previousFittings);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_fittings", planId] });
    },
  });
}

// Bulk variant of useRestoreSetoutFitting — undoing a bulk delete brings
// back a whole batch of fittings in one round trip, each with its original
// id intact so any switch-gang link or circuit assignment pointing at it
// re-attaches automatically rather than being left dangling.
export function useBulkRestoreSetoutFittings(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ["setout", "fitting", "bulk_restore"],
    mutationFn: async (fittings: SetoutFitting[]) => {
      if (fittings.length === 0) return;
      const rows = fittings.map((fitting) => ({
        id: fitting.id,
        plan_id: fitting.plan_id,
        canvas_id: fitting.canvas_id,
        type: fitting.type,
        position: fitting.position,
        category: fitting.category,
        specs: fitting.specs,
        measurement_lock: fitting.measurement_lock,
        status: fitting.status,
        circuit_id: fitting.circuit_id,
        linked_to: fitting.linked_to,
      }));
      const { error } = await sb.from("setout_fittings").insert(rows);
      if (error) throw error;
    },
    // Same as useRestoreSetoutFitting — the fittings being restored already
    // carry their original ids/fields, so they ARE the optimistic rows.
    onMutate: async (fittings) => {
      await queryClient.cancelQueries({ queryKey: ["setout_fittings", planId] });
      const previousFittings = queryClient.getQueryData<SetoutFitting[]>(["setout_fittings", planId]);
      queryClient.setQueryData<SetoutFitting[]>(["setout_fittings", planId], (old) => [...(old ?? []), ...fittings]);
      return { previousFittings };
    },
    onError: (_err, _fittings, context) => {
      if (context?.previousFittings) {
        queryClient.setQueryData(["setout_fittings", planId], context.previousFittings);
      }
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
    mutationKey: ["setout", "fitting", "toggle_gang_link"],
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
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["setout_fittings", planId] });
      const previousFittings = queryClient.getQueryData<SetoutFitting[]>(["setout_fittings", planId]);
      const gangs = gangsFor(input.switchFitting).map((gang) => [...gang]);
      while (gangs.length <= input.gangIndex) gangs.push([]);
      const gang = gangs[input.gangIndex];
      gangs[input.gangIndex] = gang.includes(input.targetId) ? gang.filter((id) => id !== input.targetId) : [...gang, input.targetId];
      queryClient.setQueryData<SetoutFitting[]>(["setout_fittings", planId], (old) =>
        old?.map((f) => (f.id === input.switchFitting.id ? { ...f, specs: { ...f.specs, gangs } } : f))
      );
      return { previousFittings };
    },
    onError: (_err, _input, context) => {
      if (context?.previousFittings) {
        queryClient.setQueryData(["setout_fittings", planId], context.previousFittings);
      }
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
    mutationKey: ["setout", "fitting", "add_switch_gang"],
    mutationFn: async (switchFitting: SetoutFitting) => {
      const gangs = [...gangsFor(switchFitting), []];
      const { error } = await sb
        .from("setout_fittings")
        .update({ specs: { ...switchFitting.specs, gangs, count: gangs.length } })
        .eq("id", switchFitting.id);
      if (error) throw error;
    },
    onMutate: async (switchFitting) => {
      await queryClient.cancelQueries({ queryKey: ["setout_fittings", planId] });
      const previousFittings = queryClient.getQueryData<SetoutFitting[]>(["setout_fittings", planId]);
      const gangs = [...gangsFor(switchFitting), []];
      // count is typed as the discrete glyph count (1 | 2 | 4); gangs.length
      // is a plain number here, same as the untyped Supabase update payload
      // above — cast to line up with FittingSpecs for this typed cache write.
      queryClient.setQueryData<SetoutFitting[]>(["setout_fittings", planId], (old) =>
        old?.map((f) => (f.id === switchFitting.id ? { ...f, specs: { ...f.specs, gangs, count: gangs.length as 1 | 2 | 4 } } : f))
      );
      return { previousFittings };
    },
    onError: (_err, _switchFitting, context) => {
      if (context?.previousFittings) {
        queryClient.setQueryData(["setout_fittings", planId], context.previousFittings);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_fittings", planId] });
    },
  });
}

// Removes a gang entirely (not just clearing its links) — e.g. undoing an
// accidental "+ Add switch".
export function useRemoveSwitchGang(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ["setout", "fitting", "remove_switch_gang"],
    mutationFn: async (input: { switchFitting: SetoutFitting; gangIndex: number }) => {
      const gangs = gangsFor(input.switchFitting).filter((_, i) => i !== input.gangIndex);
      const { error } = await sb
        .from("setout_fittings")
        .update({ specs: { ...input.switchFitting.specs, gangs, count: Math.max(1, gangs.length) } })
        .eq("id", input.switchFitting.id);
      if (error) throw error;
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["setout_fittings", planId] });
      const previousFittings = queryClient.getQueryData<SetoutFitting[]>(["setout_fittings", planId]);
      const gangs = gangsFor(input.switchFitting).filter((_, i) => i !== input.gangIndex);
      // Same cast as useAddSwitchGang's onMutate — count is 1 | 2 | 4.
      queryClient.setQueryData<SetoutFitting[]>(["setout_fittings", planId], (old) =>
        old?.map((f) =>
          f.id === input.switchFitting.id
            ? { ...f, specs: { ...f.specs, gangs, count: Math.max(1, gangs.length) as 1 | 2 | 4 } }
            : f
        )
      );
      return { previousFittings };
    },
    onError: (_err, _input, context) => {
      if (context?.previousFittings) {
        queryClient.setQueryData(["setout_fittings", planId], context.previousFittings);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_fittings", planId] });
    },
  });
}

export function useUpdateSetoutFittingStatus(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ["setout", "fitting", "update_status"],
    mutationFn: async (input: { fittingId: string; status: "placed" | "confirmed" }) => {
      const { error } = await sb.from("setout_fittings").update({ status: input.status }).eq("id", input.fittingId);
      if (error) throw error;
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["setout_fittings", planId] });
      const previousFittings = queryClient.getQueryData<SetoutFitting[]>(["setout_fittings", planId]);
      queryClient.setQueryData<SetoutFitting[]>(["setout_fittings", planId], (old) =>
        old?.map((f) => (f.id === input.fittingId ? { ...f, status: input.status } : f))
      );
      return { previousFittings };
    },
    onError: (_err, _input, context) => {
      if (context?.previousFittings) {
        queryClient.setQueryData(["setout_fittings", planId], context.previousFittings);
      }
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
    // Optimistic: a drag should visibly settle at its new spot immediately
    // rather than snapping back-and-forth while the round trip is in
    // flight. Standard TanStack Query optimistic-update shape — cancel any
    // in-flight refetch so it can't clobber this write with stale data,
    // snapshot the previous cache to roll back to on failure, then write
    // the new position/measurement lock/specs straight into the cache
    // (rotation lives in specs.rotation, so the `specs` branch covers it
    // too, same as the real update above).
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["setout_fittings", planId] });
      const previousFittings = queryClient.getQueryData<SetoutFitting[]>(["setout_fittings", planId]);
      queryClient.setQueryData<SetoutFitting[]>(["setout_fittings", planId], (old) =>
        old?.map((f) =>
          f.id === input.fittingId
            ? {
                ...f,
                position: input.position,
                measurement_lock: input.measurement_lock,
                ...(input.specs ? { specs: input.specs } : {}),
              }
            : f
        )
      );
      return { previousFittings };
    },
    onError: (_err, _input, context) => {
      if (context?.previousFittings) {
        queryClient.setQueryData(["setout_fittings", planId], context.previousFittings);
      }
    },
    onSettled: () => {
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
    mutationKey: ["setout", "fitting", "update_measurement_lock"],
    mutationFn: async (input: { fittingId: string; measurement_lock: MeasurementLock }) => {
      const { error } = await sb
        .from("setout_fittings")
        .update({ measurement_lock: input.measurement_lock })
        .eq("id", input.fittingId);
      if (error) throw error;
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["setout_fittings", planId] });
      const previousFittings = queryClient.getQueryData<SetoutFitting[]>(["setout_fittings", planId]);
      queryClient.setQueryData<SetoutFitting[]>(["setout_fittings", planId], (old) =>
        old?.map((f) => (f.id === input.fittingId ? { ...f, measurement_lock: input.measurement_lock } : f))
      );
      return { previousFittings };
    },
    onError: (_err, _input, context) => {
      if (context?.previousFittings) {
        queryClient.setQueryData(["setout_fittings", planId], context.previousFittings);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_fittings", planId] });
    },
  });
}

// After deleting one or more fittings, anything else on the plan can be left
// holding a "ghost" id — a switch gang (specs.gangs: string[][]) that looped
// through the now-gone fitting, or a data outlet's specs.dataCabinetId
// pointing at a now-gone cabinet. Left alone these show up as broken links
// (SwitchLinksPanel) or, worse, as false switch-run merges — see the
// liveIds param computeRunGroups/wayCountForTarget/runGroupFittingIds gained
// in setoutTypes.ts as a second line of defence for data that slips past
// this. Reads the plan's fittings from the query cache first (already there
// in the normal delete-from-canvas flow) and only falls back to a fresh
// select when the cache is empty (e.g. this mutation used outside the
// canvas page).
async function pruneDeletedFittingReferences(planId: string, deletedIds: string[], queryClient: QueryClient): Promise<void> {
  if (deletedIds.length === 0) return;
  const deleted = new Set(deletedIds);

  let fittings = queryClient.getQueryData<SetoutFitting[]>(["setout_fittings", planId]);
  if (!fittings) {
    const { data, error } = await sb.from("setout_fittings").select("*").eq("plan_id", planId);
    if (error) {
      console.warn("[pruneDeletedFittingReferences] could not load fittings to prune references", error);
      return;
    }
    fittings = data as SetoutFitting[];
  }

  for (const fitting of fittings) {
    if (deleted.has(fitting.id)) continue;
    let changed = false;
    const specs: FittingSpecs = { ...fitting.specs };

    if (specs.gangs) {
      const nextGangs = specs.gangs.map((gang) => gang.filter((id) => !deleted.has(id)));
      if (nextGangs.some((gang, i) => gang.length !== specs.gangs![i].length)) {
        specs.gangs = nextGangs;
        changed = true;
      }
    }
    if (specs.dataCabinetId && deleted.has(specs.dataCabinetId)) {
      specs.dataCabinetId = null;
      changed = true;
    }

    if (changed) {
      const { error } = await sb.from("setout_fittings").update({ specs }).eq("id", fitting.id);
      if (error) console.warn("[pruneDeletedFittingReferences] could not prune references on fitting", fitting.id, error);
    }
  }
}

export function useDeleteSetoutFitting(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ["setout", "fitting", "delete"],
    mutationFn: async (fittingId: string) => {
      const { error } = await sb.from("setout_fittings").delete().eq("id", fittingId);
      if (error) throw error;
      await pruneDeletedFittingReferences(planId, [fittingId], queryClient);
    },
    onMutate: async (fittingId) => {
      await queryClient.cancelQueries({ queryKey: ["setout_fittings", planId] });
      const previousFittings = queryClient.getQueryData<SetoutFitting[]>(["setout_fittings", planId]);
      queryClient.setQueryData<SetoutFitting[]>(["setout_fittings", planId], (old) => old?.filter((f) => f.id !== fittingId));
      return { previousFittings };
    },
    onError: (_err, _fittingId, context) => {
      if (context?.previousFittings) {
        queryClient.setQueryData(["setout_fittings", planId], context.previousFittings);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_fittings", planId] });
    },
  });
}

// Bulk variant of useDeleteSetoutFitting — one multi-row delete plus the
// same ghost-reference pruning, for a multi-select delete instead of one
// round trip (and one prune pass) per fitting.
export function useBulkDeleteSetoutFittings(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ["setout", "fitting", "bulk_delete"],
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return;
      const { error } = await sb.from("setout_fittings").delete().in("id", ids);
      if (error) throw error;
      await pruneDeletedFittingReferences(planId, ids, queryClient);
    },
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: ["setout_fittings", planId] });
      const previousFittings = queryClient.getQueryData<SetoutFitting[]>(["setout_fittings", planId]);
      const idSet = new Set(ids);
      queryClient.setQueryData<SetoutFitting[]>(["setout_fittings", planId], (old) => old?.filter((f) => !idSet.has(f.id)));
      return { previousFittings };
    },
    onError: (_err, _ids, context) => {
      if (context?.previousFittings) {
        queryClient.setQueryData(["setout_fittings", planId], context.previousFittings);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_fittings", planId] });
    },
  });
}

// Bulk-assigns (or clears, with circuitId: null) a circuit across a
// multi-select of fittings in one round trip.
export function useBulkAssignSetoutFittingCircuit(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ["setout", "fitting", "bulk_assign_circuit"],
    mutationFn: async (input: { ids: string[]; circuitId: string | null }) => {
      if (input.ids.length === 0) return;
      const { error } = await sb.from("setout_fittings").update({ circuit_id: input.circuitId }).in("id", input.ids);
      if (error) throw error;
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["setout_fittings", planId] });
      const previousFittings = queryClient.getQueryData<SetoutFitting[]>(["setout_fittings", planId]);
      const idSet = new Set(input.ids);
      queryClient.setQueryData<SetoutFitting[]>(["setout_fittings", planId], (old) =>
        old?.map((f) => (idSet.has(f.id) ? { ...f, circuit_id: input.circuitId } : f))
      );
      return { previousFittings };
    },
    onError: (_err, _input, context) => {
      if (context?.previousFittings) {
        queryClient.setQueryData(["setout_fittings", planId], context.previousFittings);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_fittings", planId] });
    },
  });
}
