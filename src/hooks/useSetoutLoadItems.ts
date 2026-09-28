import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { SetoutLoadItem } from "@/lib/setoutTypes";

// setout_* tables are newer than the generated Supabase types — same `as any`
// escape hatch used elsewhere in this repo (e.g. useSetoutCircuits.ts) for
// tables ahead of a type regen.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    mutationKey: ["setout", "load_item", "create"],
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
    // Optimistic: same CREATE recipe as every other list-add in the setout
    // hooks — a client-generated id stands in for the row until onSuccess
    // swaps in the server-confirmed one.
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["setout_load_items", planId] });
      const previousLoadItems = queryClient.getQueryData<SetoutLoadItem[]>(["setout_load_items", planId]);
      const optimisticId = crypto.randomUUID();
      const optimisticLoadItem: SetoutLoadItem = {
        id: optimisticId,
        plan_id: planId,
        label: input.label,
        load_group: input.load_group,
        rating_w: input.rating_w,
        quantity: input.quantity,
        circuit_id: input.circuit_id ?? null,
        created_at: new Date().toISOString(),
      };
      queryClient.setQueryData<SetoutLoadItem[]>(["setout_load_items", planId], (old) => [...(old ?? []), optimisticLoadItem]);
      return { previousLoadItems, optimisticId };
    },
    onError: (_err, _input, context) => {
      if (context?.previousLoadItems) {
        queryClient.setQueryData(["setout_load_items", planId], context.previousLoadItems);
      }
    },
    onSuccess: (data, _input, context) => {
      queryClient.setQueryData<SetoutLoadItem[]>(["setout_load_items", planId], (old) =>
        old?.map((item) => (item.id === context?.optimisticId ? data : item))
      );
      queryClient.invalidateQueries({ queryKey: ["setout_load_items", planId] });
    },
  });
}

export function useUpdateSetoutLoadItem(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ["setout", "load_item", "update"],
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
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["setout_load_items", planId] });
      const previousLoadItems = queryClient.getQueryData<SetoutLoadItem[]>(["setout_load_items", planId]);
      queryClient.setQueryData<SetoutLoadItem[]>(["setout_load_items", planId], (old) =>
        old?.map((item) => {
          if (item.id !== input.loadItemId) return item;
          const next = { ...item };
          if (input.label !== undefined) next.label = input.label;
          if (input.load_group !== undefined) next.load_group = input.load_group;
          if (input.rating_w !== undefined) next.rating_w = input.rating_w;
          if (input.quantity !== undefined) next.quantity = input.quantity;
          if (input.circuit_id !== undefined) next.circuit_id = input.circuit_id;
          return next;
        })
      );
      return { previousLoadItems };
    },
    onError: (_err, _input, context) => {
      if (context?.previousLoadItems) {
        queryClient.setQueryData(["setout_load_items", planId], context.previousLoadItems);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_load_items", planId] });
    },
  });
}

export function useDeleteSetoutLoadItem(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ["setout", "load_item", "delete"],
    mutationFn: async (loadItemId: string) => {
      const { error } = await sb.from("setout_load_items").delete().eq("id", loadItemId);
      if (error) throw error;
    },
    onMutate: async (loadItemId) => {
      await queryClient.cancelQueries({ queryKey: ["setout_load_items", planId] });
      const previousLoadItems = queryClient.getQueryData<SetoutLoadItem[]>(["setout_load_items", planId]);
      queryClient.setQueryData<SetoutLoadItem[]>(["setout_load_items", planId], (old) => old?.filter((item) => item.id !== loadItemId));
      return { previousLoadItems };
    },
    onError: (_err, _loadItemId, context) => {
      if (context?.previousLoadItems) {
        queryClient.setQueryData(["setout_load_items", planId], context.previousLoadItems);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_load_items", planId] });
    },
  });
}
