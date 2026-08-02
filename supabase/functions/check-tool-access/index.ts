import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAllowedOrigin } from "../_shared/cors.ts";

// Free-tier trade calculators (Tools.tsx) were completely unlimited — this
// caps free users to 1 use per calculator per day, reusing the same atomic
// rate-limit RPC the chat/audit/OCR features already use
// (check_and_record_ai_usage, supabase/migrations/20260704000003_atomic_ai_rate_limit.sql),
// namespaced under kind = "tool:<tool_id>" so it can't collide with those.
// Pro/business users always pass without touching the usage table.

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

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const { tool_id } = await req.json();
    if (typeof tool_id !== "string" || !tool_id) return json({ error: "tool_id is required" }, 400);

    const { data: profile } = await supabase.from("profiles").select("subscription_tier").eq("user_id", user.id).single();
    const tier = profile?.subscription_tier || "free";
    if (tier === "pro" || tier === "business") return json({ allowed: true });

    const { data: used } = await supabase.rpc("check_and_record_ai_usage", {
      p_user_id: user.id, p_kind: `tool:${tool_id}`, p_max: 1, p_window_seconds: 86400,
    });
    return json({ allowed: !(typeof used === "number" && used < 0) });
  } catch (e) {
    console.error("[check-tool-access] Unexpected error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
