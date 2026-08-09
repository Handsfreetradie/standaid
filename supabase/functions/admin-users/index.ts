import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAllowedOrigin } from "../_shared/cors.ts";

// Owner-only tool: lists every signed-up user with their signup date and
// current tier, for the admin panel in Profile.tsx. Mirrors grant-trial's
// auth pattern (single hardcoded ADMIN_EMAIL, no app-wide roles table).

const ADMIN_EMAIL = "kyledixonelectrical@gmail.com";

serve(async (req) => {
  const origin = req.headers.get("Origin") || "";
  const corsHeaders = {
    "Access-Control-Allow-Origin": getAllowedOrigin(origin),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) return json({ error: "Unauthorized" }, 401);
    if (user.email !== ADMIN_EMAIL) return json({ error: "Forbidden" }, 403);

    const { data: users, error } = await supabaseAdmin
      .from("profiles")
      .select("user_id, email, display_name, subscription_tier, created_at, pro_expires_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw error;

    // Lifetime query count per user, from the `queries` log table (not
    // profiles.daily_query_count, which resets every day).
    const { data: counts, error: countsError } = await supabaseAdmin
      .rpc("admin_query_counts_by_user");
    if (countsError) throw countsError;

    // Lifetime AI cost per user, from token_usage
    // (20260807010000_token_usage_tracking.sql) — every AI call across the
    // app logs here, so this is a real total, not just chat queries.
    const { data: costs, error: costsError } = await supabaseAdmin
      .rpc("admin_cost_by_user");
    if (costsError) throw costsError;

    // Email confirmation status lives on auth.users, not profiles — a
    // profile row is created at signup time (handle_new_user trigger),
    // before the user ever confirms, so this can't come from the profiles
    // select above. Paginate the Auth Admin API rather than a raw SQL join.
    const confirmedByUser = new Map<string, boolean>();
    for (let page = 1; page <= 5; page++) {
      const { data: page_, error: listError } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
      if (listError) throw listError;
      for (const u of page_.users) confirmedByUser.set(u.id, !!u.email_confirmed_at);
      if (page_.users.length < 1000) break;
    }

    const countByUser = new Map<string, number>((counts ?? []).map((r: { user_id: string; total: number }) => [r.user_id, r.total]));
    const costByUser = new Map<string, number>((costs ?? []).map((r: { user_id: string; total_cost_usd: number }) => [r.user_id, r.total_cost_usd]));
    const usersWithCounts = (users ?? []).map((u) => ({
      ...u,
      query_count: countByUser.get(u.user_id) ?? 0,
      total_cost_usd: costByUser.get(u.user_id) ?? 0,
      email_confirmed: confirmedByUser.get(u.user_id) ?? false,
    }));

    return json({ users: usersWithCounts, total_cost_usd: [...costByUser.values()].reduce((a, b) => a + b, 0) });
  } catch (e) {
    console.error("[admin-users] Unexpected error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
