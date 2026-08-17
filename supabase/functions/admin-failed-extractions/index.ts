import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAllowedOrigin } from "../_shared/cors.ts";

// Owner-only tool: surfaces every standard (across every user) with
// permanently-failed figures/tables, so failures get worked on by us in the
// background instead of just sitting behind an amber note on the user's own
// Standards page with no one but them ever seeing it. Same auth pattern as
// admin-users (single hardcoded ADMIN_EMAIL, no app-wide roles table).
//
// Also accepts a retry action: triggers reprocess-standard for that standard,
// so it goes through the real (now-fixed) extraction pipeline again — not
// just a counter reset. A plain index_attempts reset was tried first, but it
// asks the vision model to find a caption on the exact same (page, label) the
// old buggy extraction stored — which was often simply wrong, so retrying
// against unchanged data just fails identically every time. Re-running
// extraction gives it a chance to store the RIGHT (page, label) this time.
// Not free like the old reset: reprocess-standard's own preserveDescribed
// carry-forward keeps already-working tables/figures from being re-billed,
// but genuinely new/changed candidates (including a standard that needs OCR
// re-run) do cost real API spend. Admin-only, same reasoning as the panel
// itself — end users don't see or trigger this.

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

      const { data: standardRow, error: standardLookupError } = await supabaseAdmin
        .from("standards")
        .select("user_id")
        .eq("id", standardId)
        .single();
      if (standardLookupError || !standardRow) return json({ error: "Standard not found" }, 404);

      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      // Targeted fix first: re-reads just the pages around each failed
      // table/figure and re-runs the caption-detection logic there — a few
      // pages of vision input per failed item, not the whole document. Only
      // an item that's still failed afterward (or wasn't a table/figure
      // caption failure at all) needs the full reprocess-standard fallback.
      const recoverUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/recover-failed-chunks`;
      const recoverRes = await fetch(recoverUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
        body: JSON.stringify({ standard_id: standardId, user_id: standardRow.user_id }),
      });
      const recoverResult = await recoverRes.json().catch(() => ({}));
      if (!recoverRes.ok) return json({ error: recoverResult?.error || "Targeted recovery failed to start." }, recoverRes.status);

      return json(recoverResult);
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
