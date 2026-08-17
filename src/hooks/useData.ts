import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export function useProfile() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", user.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
  });
}

export function useStandards() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Realtime: auto-refresh cards when extraction_status changes
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("standards-status")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "standards", filter: `user_id=eq.${user.id}` },
        () => { queryClient.invalidateQueries({ queryKey: ["standards", user.id] }); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id, queryClient]);

  return useQuery({
    queryKey: ["standards", user?.id],
    queryFn: async () => {
      if (!user) return [];
      // No client-side .eq("user_id", ...) filter here — RLS is the sole
      // gate, and it now also permits a team member's shared org standards
      // alongside their own. Filtering by user_id here would silently hide
      // teammates' uploads even though RLS would return them.
      const { data, error } = await supabase
        .from("standards")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
  });
}

export function useOrganization() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["organization", user?.id],
    queryFn: async () => {
      if (!user) return null;

      const { data: owned } = await supabase
        .from("organizations")
        .select("*")
        .eq("owner_user_id", user.id)
        .maybeSingle();
      if (owned) return { ...owned, role: "owner" as const };

      const { data: membership } = await supabase
        .from("organization_members")
        .select("role, organizations(*)")
        .eq("user_id", user.id)
        .eq("status", "active")
        .maybeSingle();
      if (membership?.organizations) {
        return { ...(membership.organizations as any), role: (membership.role as string) || "member" };
      }
      return null;
    },
    enabled: !!user,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
  });
}

export function useOrganizationMembers(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["organization-members", organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from("organization_members")
        .select("*")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!organizationId,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
  });
}

export function useProcessingJobs() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Realtime: refresh jobs + standards when job status changes
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("processing-jobs-status")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "processing_jobs", filter: `user_id=eq.${user.id}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ["processing-jobs", user.id] });
          queryClient.invalidateQueries({ queryKey: ["standards", user.id] });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id, queryClient]);

  return useQuery({
    queryKey: ["processing-jobs", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await (supabase as any)
        .from("processing_jobs")
        .select("id, standard_id, status, attempts, error_message, created_at, started_at")
        .eq("user_id", user.id)
        // "failed" included so the library can show the real failure reason
        .in("status", ["pending", "processing", "failed"])
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
    refetchInterval: 5000, // fallback poll every 5s in case realtime drops
  });
}

export function useQueries() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["queries", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("queries")
        .select("*")
        .eq("user_id", user.id)
        .not("question", "like", "explain\\_%") // hide exam-helper explanation cache rows
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
  });
}
