import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { SetoutCircuit } from "@/lib/setoutTypes";

// setout_* tables are newer than the generated Supabase types — same `as any`
// escape hatch used elsewhere in this repo (e.g. useSetoutPlans.ts) for tables
// ahead of a type regen.
const sb = supabase as any;

export function useSetoutCircuits(planId: string | undefined) {
  return useQuery({
    queryKey: ["setout_circuits", planId],
    queryFn: async () => {
      const { data, error } = await sb
        .from("setout_circuits")
        .select("*")
        .eq("plan_id", planId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as SetoutCircuit[];
    },
    enabled: !!planId,
  });
}

export function useCreateSetoutCircuit(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { label: string; description?: string; breaker_rating?: string }) => {
      const { data, error } = await sb
        .from("setout_circuits")
        .insert({
          plan_id: planId,
          label: input.label,
          description: input.description || null,
          breaker_rating: input.breaker_rating || null,
        })
        .select()
        .single();
      if (error) throw error;
      return data as SetoutCircuit;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_circuits", planId] });
    },
  });
}

export function useUpdateSetoutCircuit(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { circuitId: string; label?: string; description?: string; breaker_rating?: string }) => {
      const updates: Record<string, unknown> = {};
      if (input.label !== undefined) updates.label = input.label;
      if (input.description !== undefined) updates.description = input.description || null;
      if (input.breaker_rating !== undefined) updates.breaker_rating = input.breaker_rating || null;

      const { data, error } = await sb
        .from("setout_circuits")
        .update(updates)
        .eq("id", input.circuitId)
        .select()
        .single();
      if (error) throw error;
      return data as SetoutCircuit;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_circuits", planId] });
    },
  });
}

export function useDeleteSetoutCircuit(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (circuitId: string) => {
      const { error } = await sb.from("setout_circuits").delete().eq("id", circuitId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_circuits", planId] });
      // setout_fittings.circuit_id has ON DELETE SET NULL, so deleting a
      // circuit un-assigns its fittings server-side automatically — but the
      // cached fittings list still shows the old circuit_id until refetched.
      queryClient.invalidateQueries({ queryKey: ["setout_fittings", planId] });
    },
  });
}

export function useAssignFittingCircuit(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { fittingId: string; circuitId: string | null }) => {
      const { error } = await sb
        .from("setout_fittings")
        .update({ circuit_id: input.circuitId })
        .eq("id", input.fittingId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_fittings", planId] });
      queryClient.invalidateQueries({ queryKey: ["setout_circuits", planId] });
    },
  });
}
