import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

// profiles' setout_quick_picks column is newer than the generated Supabase
// types — same `as any` escape hatch used elsewhere in this repo.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

// Note on offline durability: this mutation's cache key is ["profile",
// user?.id], NOT a "setout_"-prefixed key, so shouldDehydrateSetoutQuery in
// setoutOfflineQueryClient.ts won't persist that query's cache — the
// mutationKey below still makes the queued WRITE itself durable across an
// app restart, same as every other mutation in this file. It's only the
// optimistic UI update (below) that could be lost if the app is killed
// while this one mutation is sitting paused offline; a quick-pick
// preference is low-stakes enough that this is an acceptable edge case, not
// something to work around by inventing a fake "setout_profile" query key
// (that would break the real "profile" query used elsewhere in the app).
export function useUpdateSetoutQuickPicks() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ["setout", "quick_picks", "update"],
    mutationFn: async (keys: string[]) => {
      if (!user) throw new Error("Not signed in");
      const { error } = await sb.from("profiles").update({ setout_quick_picks: keys }).eq("user_id", user.id);
      if (error) throw error;
    },
    onMutate: async (keys) => {
      await queryClient.cancelQueries({ queryKey: ["profile", user?.id] });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const previousProfile = queryClient.getQueryData<any>(["profile", user?.id]);
      if (previousProfile) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        queryClient.setQueryData<any>(["profile", user?.id], { ...previousProfile, setout_quick_picks: keys });
      }
      return { previousProfile };
    },
    onError: (_err, _keys, context) => {
      if (context?.previousProfile) {
        queryClient.setQueryData(["profile", user?.id], context.previousProfile);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["profile", user?.id] });
    },
  });
}
