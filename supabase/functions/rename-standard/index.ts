import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAllowedOrigin } from "../_shared/cors.ts";
import { isAiAllowed } from "../_shared/standard-licence.ts";

// Lets a user rename their own standard's title/standard_code. This is the
// only writer for the standards table now that direct client UPDATEs are
// revoked (see 20260820130000_lock_standards_updates.sql) — a raw client
// update was the actual bypass for the Standards Australia AI block, not
// just a UX gap.
//
// One-way ratchet, confirmed with Kyle: a rename can only tighten the AI
// block, never loosen it. (Full auto-unblock-on-rename was tried and
// deliberately reverted — the lie alone being sufficient to restore AI
// access was a real bypass, not just a UX gap; see git history if that
// tradeoff needs revisiting.)
//   - If the new title/code now matches AS/AS-NZS/NZS, the standard is
//     locked (ai_disabled) regardless of what it was before.
//   - If the new title/code looks fine, an already-locked standard STAYS
//     locked — renaming alone never restores AI features. Unblocking a
//     standard is a separate, manual, reviewed action (see
//     scripts/list-ai-disabled-standards.mjs).

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

    const { standard_id, title, standard_code } = await req.json();
    if (!standard_id || typeof standard_id !== "string") {
      return json({ error: "standard_id is required" }, 400);
    }
    const cleanTitle = typeof title === "string" ? title.trim() : "";
    if (!cleanTitle) return json({ error: "Title can't be empty" }, 400);
    const cleanCode = typeof standard_code === "string" ? standard_code.trim() : null;

    const { data: standard, error: fetchError } = await supabaseAdmin
      .from("standards")
      .select("id, user_id, extraction_status")
      .eq("id", standard_id)
      .single();
    if (fetchError || !standard) return json({ error: "Standard not found" }, 404);
    if (standard.user_id !== user.id) return json({ error: "Forbidden" }, 403);

    const nowAllowed = isAiAllowed(cleanCode, cleanTitle);
    const wasDisabled = standard.extraction_status === "ai_disabled";

    // Tighten if the new text looks like AS/AS-NZS/NZS; otherwise never
    // touch extraction_status here — an already-disabled standard stays
    // disabled no matter how it's renamed.
    const newStatus = !nowAllowed ? "ai_disabled" : standard.extraction_status;

    const { error: updateError } = await supabaseAdmin
      .from("standards")
      .update({ title: cleanTitle, standard_code: cleanCode, extraction_status: newStatus })
      .eq("id", standard_id);
    if (updateError) throw updateError;

    return json({
      title: cleanTitle,
      standard_code: cleanCode,
      extraction_status: newStatus,
      newlyLocked: !nowAllowed && !wasDisabled,
      stillLocked: nowAllowed && wasDisabled,
    });
  } catch (e) {
    console.error("[rename-standard] error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
