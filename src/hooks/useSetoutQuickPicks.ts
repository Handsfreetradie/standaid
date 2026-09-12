import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

// profiles' setout_quick_picks column is newer than the generated Supabase
// types — same `as any` escape hatch used elsewhere in this repo.
const sb = supabase as any;

export function useUpdateSetoutQuickPicks() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (keys: string[]) => {
      if (!user) throw new Error("Not signed in");
      const { error } = await sb.from("profiles").update({ setout_quick_picks: keys }).eq("user_id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile", user?.id] });
    },
  });
}
