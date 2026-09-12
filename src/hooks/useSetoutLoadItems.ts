import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { SetoutLoadItem } from "@/lib/setoutTypes";

// setout_* tables are newer than the generated Supabase types — same `as any`
// escape hatch used elsewhere in this repo (e.g. useSetoutCircuits.ts) for
// tables ahead of a type regen.
const sb = supabase as any;

export function useSetoutLoadItems(planId: string | undefined) {
  return useQuery({
    queryKey: ["setout_load_items", planId],
    queryFn: async () => {
      const { data, error } = await sb
        .from("setout_load_items")
        .select("*")
        .eq("plan_id", planId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as SetoutLoadItem[];
    },
    enabled: !!planId,
  });
}

export function useCreateSetoutLoadItem(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { label: string; load_group: string; rating_w: number; quantity: number; circuit_id?: string | null }) => {
      const { data, error } = await sb
        .from("setout_load_items")
        .insert({
          plan_id: planId,
          label: input.label,
          load_group: input.load_group,
          rating_w: input.rating_w,
          quantity: input.quantity,
          circuit_id: input.circuit_id ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data as SetoutLoadItem;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_load_items", planId] });
    },
  });
}

export function useUpdateSetoutLoadItem(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      loadItemId: string;
      label?: string;
      load_group?: string;
      rating_w?: number;
      quantity?: number;
      circuit_id?: string | null;
    }) => {
      const updates: Record<string, unknown> = {};
      if (input.label !== undefined) updates.label = input.label;
      if (input.load_group !== undefined) updates.load_group = input.load_group;
      if (input.rating_w !== undefined) updates.rating_w = input.rating_w;
      if (input.quantity !== undefined) updates.quantity = input.quantity;
      if (input.circuit_id !== undefined) updates.circuit_id = input.circuit_id;

      const { data, error } = await sb
        .from("setout_load_items")
        .update(updates)
        .eq("id", input.loadItemId)
        .select()
        .single();
      if (error) throw error;
      return data as SetoutLoadItem;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_load_items", planId] });
    },
  });
}

export function useDeleteSetoutLoadItem(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (loadItemId: string) => {
      const { error } = await sb.from("setout_load_items").delete().eq("id", loadItemId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_load_items", planId] });
    },
  });
}
