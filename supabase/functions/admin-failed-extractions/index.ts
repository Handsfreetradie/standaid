import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAllowedOrigin } from "../_shared/cors.ts";

// Owner-only tool: surfaces every standard (across every user) with
// permanently-failed figures/tables, so failures get worked on by us in the
// background instead of just sitting behind an amber note on the user's own
// Standards page with no one but them ever seeing it. Same auth pattern as
// admin-users (single hardcoded ADMIN_EMAIL, no app-wide roles table).
//
// Also accepts a retry action: resets index_attempts back to 0 for a
// standard's stuck items (embedding IS NULL AND index_attempts >= 3) so the
// existing resume-stalled-indexing cron picks them up again within ~10 min.
// This is the exact mechanism a user-facing "Retry" button would have used —
// kept here instead, admin-only, per the call to keep end users out of it.

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

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    if (body.action === "retry") {
      const standardId = body.standard_id;
      if (!standardId || typeof standardId !== "string") return json({ error: "standard_id required" }, 400);

      const { data: retried, error: retryError } = await supabaseAdmin
        .from("standard_chunks")
        .update({ index_attempts: 0 })
        .eq("standard_id", standardId)
        .is("embedding", null)
        .gte("index_attempts", 3)
        .select("id");
      if (retryError) throw retryError;

      return json({ retried: retried?.length || 0 });
    }

    const { data: failedStandards, error } = await supabaseAdmin
      .from("standards")
      .select("id, title, standard_code, user_id, failed_chunks_count, failed_chunks_labels, extraction_quality_score, total_chunks, indexed_chunks, created_at")
      .gt("failed_chunks_count", 0)
      .order("failed_chunks_count", { ascending: false })
      .limit(200);
    if (error) throw error;

    const userIds = [...new Set((failedStandards || []).map((s) => s.user_id))];
    const { data: profiles, error: profilesError } = userIds.length > 0
      ? await supabaseAdmin.from("profiles").select("user_id, email, display_name").in("user_id", userIds)
      : { data: [], error: null };
    if (profilesError) throw profilesError;
    const profileByUser = new Map((profiles || []).map((p) => [p.user_id, p]));

    const rows = (failedStandards || []).map((s) => {
      const profile = profileByUser.get(s.user_id);
      return { ...s, email: profile?.email || profile?.display_name || "Unknown user" };
    });

    return json({ standards: rows });
  } catch (e) {
    console.error("[admin-failed-extractions] Unexpected error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
