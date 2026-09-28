import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { CircuitCableType, CircuitDeviceType, CircuitSpecs, CircuitType, SetoutCircuit, SetoutFitting } from "@/lib/setoutTypes";

// Structured circuit-schedule fields (20260917020000) shared by create and
// update — all optional so existing callers that only pass label/
// description/breaker_rating keep working unchanged.
interface CircuitScheduleFields {
  device_type?: CircuitDeviceType | null;
  rcd_protected?: boolean | null;
  poles?: 1 | 3 | null;
  cable_csa_mm2?: number | null;
  cable_type?: CircuitCableType | null;
  notes?: string | null;
}

// setout_* tables are newer than the generated Supabase types — same `as any`
// escape hatch used elsewhere in this repo (e.g. useSetoutPlans.ts) for tables
// ahead of a type regen.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export function useSetoutCircuits(planId: string | undefined) {
  return useQuery({
    queryKey: ["setout_circuits", planId],
    queryFn: async () => {
      const { data, error } = await sb
        .from("setout_circuits")
        .select("*")
        .eq("plan_id", planId)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data as SetoutCircuit[];
    },
    enabled: !!planId,
  });
}

export function useCreateSetoutCircuit(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ["setout", "circuit", "create"],
    mutationFn: async (
      input: {
        label: string;
        description?: string;
        breaker_rating?: string;
        circuit_type?: CircuitType;
        specs?: CircuitSpecs;
      } & CircuitScheduleFields,
    ) => {
      // New circuits go to the end of the arranged order — read the current
      // list out of the cache rather than a fresh fetch, since it's already
      // there and this only needs to be roughly right (a concurrent add from
      // another tab landing on the same number just means two circuits tie
      // for last place, which sorts fine either way).
      const existing = queryClient.getQueryData<SetoutCircuit[]>(["setout_circuits", planId]) ?? [];
      const nextOrder = existing.reduce((max, c) => Math.max(max, c.sort_order), -1) + 1;

      const { data, error } = await sb
        .from("setout_circuits")
        .insert({
          plan_id: planId,
          label: input.label,
          description: input.description || null,
          breaker_rating: input.breaker_rating || null,
          sort_order: nextOrder,
          circuit_type: input.circuit_type ?? "standard",
          specs: input.specs ?? {},
          device_type: input.device_type ?? null,
          rcd_protected: input.rcd_protected ?? null,
          poles: input.poles ?? null,
          cable_csa_mm2: input.cable_csa_mm2 ?? null,
          cable_type: input.cable_type ?? null,
          notes: input.notes ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data as SetoutCircuit;
    },
    // Optimistic: same end-of-order sort_order computation the mutationFn
    // itself does, so the temp row lands in the right spot in the list
    // instead of jumping once the real row comes back.
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["setout_circuits", planId] });
      const previousCircuits = queryClient.getQueryData<SetoutCircuit[]>(["setout_circuits", planId]);
      const existing = previousCircuits ?? [];
      const nextOrder = existing.reduce((max, c) => Math.max(max, c.sort_order), -1) + 1;
      const optimisticId = crypto.randomUUID();
      const optimisticCircuit: SetoutCircuit = {
        id: optimisticId,
        plan_id: planId,
        label: input.label,
        description: input.description || null,
        breaker_rating: input.breaker_rating || null,
        sort_order: nextOrder,
        circuit_type: input.circuit_type ?? "standard",
        specs: input.specs ?? {},
        device_type: input.device_type ?? null,
        rcd_protected: input.rcd_protected ?? null,
        poles: input.poles ?? null,
        cable_csa_mm2: input.cable_csa_mm2 ?? null,
        cable_type: input.cable_type ?? null,
        notes: input.notes ?? null,
        created_at: new Date().toISOString(),
      };
      queryClient.setQueryData<SetoutCircuit[]>(["setout_circuits", planId], (old) => [...(old ?? []), optimisticCircuit]);
      return { previousCircuits, optimisticId };
    },
    onError: (_err, _input, context) => {
      if (context?.previousCircuits) {
        queryClient.setQueryData(["setout_circuits", planId], context.previousCircuits);
      }
    },
    onSuccess: (data, _input, context) => {
      queryClient.setQueryData<SetoutCircuit[]>(["setout_circuits", planId], (old) =>
        old?.map((c) => (c.id === context?.optimisticId ? data : c))
      );
      queryClient.invalidateQueries({ queryKey: ["setout_circuits", planId] });
    },
  });
}

// Swaps a circuit with its immediate neighbour in the arranged order — the
// switchboard legend prints circuits in this order, so "arrange" here means
// matching the physical pole layout on the board, not anything to do with
// how they were created.
export function useReorderSetoutCircuit(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ["setout", "circuit", "reorder"],
    mutationFn: async (input: { circuitId: string; direction: "up" | "down" }) => {
      const circuits = queryClient.getQueryData<SetoutCircuit[]>(["setout_circuits", planId]) ?? [];
      const index = circuits.findIndex((c) => c.id === input.circuitId);
      if (index === -1) return;
      const swapIndex = input.direction === "up" ? index - 1 : index + 1;
      if (swapIndex < 0 || swapIndex >= circuits.length) return; // already at an end

      const a = circuits[index];
      const b = circuits[swapIndex];
      const [{ error: errA }, { error: errB }] = await Promise.all([
        sb.from("setout_circuits").update({ sort_order: b.sort_order }).eq("id", a.id),
        sb.from("setout_circuits").update({ sort_order: a.sort_order }).eq("id", b.id),
      ]);
      if (errA) throw errA;
      if (errB) throw errB;
    },
    // Optimistic: swaps the same two rows' sort_order client-side that the
    // mutationFn swaps server-side, so the arranged order re-sorts in place
    // immediately. Snapshots/restores the whole circuits array since two
    // rows change together.
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["setout_circuits", planId] });
      const previousCircuits = queryClient.getQueryData<SetoutCircuit[]>(["setout_circuits", planId]);
      const circuits = previousCircuits ?? [];
      const index = circuits.findIndex((c) => c.id === input.circuitId);
      if (index === -1) return { previousCircuits };
      const swapIndex = input.direction === "up" ? index - 1 : index + 1;
      if (swapIndex < 0 || swapIndex >= circuits.length) return { previousCircuits }; // already at an end

      const a = circuits[index];
      const b = circuits[swapIndex];
      queryClient.setQueryData<SetoutCircuit[]>(["setout_circuits", planId], (old) =>
        old?.map((c) => {
          if (c.id === a.id) return { ...c, sort_order: b.sort_order };
          if (c.id === b.id) return { ...c, sort_order: a.sort_order };
          return c;
        })
      );
      return { previousCircuits };
    },
    onError: (_err, _input, context) => {
      if (context?.previousCircuits) {
        queryClient.setQueryData(["setout_circuits", planId], context.previousCircuits);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_circuits", planId] });
    },
  });
}

export function useUpdateSetoutCircuit(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ["setout", "circuit", "update"],
    mutationFn: async (
      input: {
        circuitId: string;
        label?: string;
        description?: string;
        breaker_rating?: string;
        circuit_type?: CircuitType;
        specs?: CircuitSpecs;
      } & CircuitScheduleFields,
    ) => {
      const updates: Record<string, unknown> = {};
      if (input.label !== undefined) updates.label = input.label;
      if (input.description !== undefined) updates.description = input.description || null;
      if (input.breaker_rating !== undefined) updates.breaker_rating = input.breaker_rating || null;
      if (input.circuit_type !== undefined) updates.circuit_type = input.circuit_type;
      if (input.specs !== undefined) updates.specs = input.specs;
      if (input.device_type !== undefined) updates.device_type = input.device_type;
      if (input.rcd_protected !== undefined) updates.rcd_protected = input.rcd_protected;
      if (input.poles !== undefined) updates.poles = input.poles;
      if (input.cable_csa_mm2 !== undefined) updates.cable_csa_mm2 = input.cable_csa_mm2;
      if (input.cable_type !== undefined) updates.cable_type = input.cable_type;
      if (input.notes !== undefined) updates.notes = input.notes;

      const { data, error } = await sb
        .from("setout_circuits")
        .update(updates)
        .eq("id", input.circuitId)
        .select()
        .single();
      if (error) throw error;
      return data as SetoutCircuit;
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["setout_circuits", planId] });
      const previousCircuits = queryClient.getQueryData<SetoutCircuit[]>(["setout_circuits", planId]);
      queryClient.setQueryData<SetoutCircuit[]>(["setout_circuits", planId], (old) =>
        old?.map((c) => {
          if (c.id !== input.circuitId) return c;
          const next = { ...c };
          if (input.label !== undefined) next.label = input.label;
          if (input.description !== undefined) next.description = input.description || null;
          if (input.breaker_rating !== undefined) next.breaker_rating = input.breaker_rating || null;
          if (input.circuit_type !== undefined) next.circuit_type = input.circuit_type;
          if (input.specs !== undefined) next.specs = input.specs;
          if (input.device_type !== undefined) next.device_type = input.device_type;
          if (input.rcd_protected !== undefined) next.rcd_protected = input.rcd_protected;
          if (input.poles !== undefined) next.poles = input.poles;
          if (input.cable_csa_mm2 !== undefined) next.cable_csa_mm2 = input.cable_csa_mm2;
          if (input.cable_type !== undefined) next.cable_type = input.cable_type;
          if (input.notes !== undefined) next.notes = input.notes;
          return next;
        })
      );
      return { previousCircuits };
    },
    onError: (_err, _input, context) => {
      if (context?.previousCircuits) {
        queryClient.setQueryData(["setout_circuits", planId], context.previousCircuits);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_circuits", planId] });
    },
  });
}

export function useDeleteSetoutCircuit(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ["setout", "circuit", "delete"],
    mutationFn: async (circuitId: string) => {
      const { error } = await sb.from("setout_circuits").delete().eq("id", circuitId);
      if (error) throw error;
    },
    onMutate: async (circuitId) => {
      await queryClient.cancelQueries({ queryKey: ["setout_circuits", planId] });
      const previousCircuits = queryClient.getQueryData<SetoutCircuit[]>(["setout_circuits", planId]);
      queryClient.setQueryData<SetoutCircuit[]>(["setout_circuits", planId], (old) => old?.filter((c) => c.id !== circuitId));
      return { previousCircuits };
    },
    onError: (_err, _circuitId, context) => {
      if (context?.previousCircuits) {
        queryClient.setQueryData(["setout_circuits", planId], context.previousCircuits);
      }
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

// Writes to a FITTING's circuit_id, not a circuit row — the optimistic write
// below touches the ["setout_fittings", planId] cache (owned by
// useSetoutPlans.ts's useSetoutFittings), not ["setout_circuits", planId].
export function useAssignFittingCircuit(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ["setout", "fitting", "assign_circuit"],
    mutationFn: async (input: { fittingId: string; circuitId: string | null }) => {
      const { error } = await sb
        .from("setout_fittings")
        .update({ circuit_id: input.circuitId })
        .eq("id", input.fittingId);
      if (error) throw error;
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["setout_fittings", planId] });
      const previousFittings = queryClient.getQueryData<SetoutFitting[]>(["setout_fittings", planId]);
      queryClient.setQueryData<SetoutFitting[]>(["setout_fittings", planId], (old) =>
        old?.map((f) => (f.id === input.fittingId ? { ...f, circuit_id: input.circuitId } : f))
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
      queryClient.invalidateQueries({ queryKey: ["setout_circuits", planId] });
    },
  });
}
