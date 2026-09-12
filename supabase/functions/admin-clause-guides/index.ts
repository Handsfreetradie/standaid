import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAllowedOrigin } from "../_shared/cors.ts";

// Owner-only review tool for clause guides (Phase 2 of the content plan).
// Lists every guide including drafts, lets the SME edit the wording and
// flip is_live. Mirrors admin-users' auth pattern (single hardcoded
// ADMIN_EMAIL). Live guides are readable by everyone via RLS; drafts and all
// writes go through here with the service role.
//
// body: { action: "list" }
//       { action: "update", id, patch: { summary?, title?, key_values?, keywords?, related_ncc?, clause_ref?, source_notes? } }
//       { action: "set_live", id, is_live }

const ADMIN_EMAIL = "kyledixonelectrical@gmail.com";
const EDITABLE = new Set(["summary", "title", "key_values", "keywords", "related_ncc", "clause_ref", "source_notes", "topic"]);

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
    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userError || !user) return json({ error: "Unauthorized" }, 401);
    if (user.email !== ADMIN_EMAIL) return json({ error: "Forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const action = body?.action;

    if (action === "list") {
      const { data, error } = await supabaseAdmin
        .from("clause_guides")
        .select("id, standard_code, clause_ref, title, trade, topic, summary, key_values, related_ncc, keywords, source_notes, is_live, reviewed_at, updated_at, embedding")
        .order("standard_code").order("clause_ref");
      if (error) throw error;
      return json({
        guides: (data || []).map((g: any) => ({ ...g, embedded: g.embedding != null, embedding: undefined })),
      });
    }

    if (action === "update") {
      const id = String(body?.id || "");
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(body?.patch || {})) if (EDITABLE.has(k)) patch[k] = v;
      if (!id || Object.keys(patch).length === 0) return json({ error: "id and a patch of editable fields required" }, 400);
      // Any wording change means the SME needs to look again before it's live.
      const { data, error } = await supabaseAdmin
        .from("clause_guides")
        .update({ ...patch, is_live: false, reviewed_by: null, reviewed_at: null })
        .eq("id", id)
        .select("id, is_live, updated_at")
        .single();
      if (error) throw error;
      return json({ guide: data, note: "wording changed — guide set back to draft; embedding will refresh on the next embed-ncc run" });
    }

    if (action === "set_live") {
      const id = String(body?.id || "");
      const live = body?.is_live === true;
      if (!id) return json({ error: "id required" }, 400);
      if (live) {
        // Don't let an unembedded guide go live — it would be invisible to search anyway.
        const { data: row } = await supabaseAdmin.from("clause_guides").select("embedding").eq("id", id).single();
        if (!row || row.embedding == null) return json({ error: "Guide isn't embedded yet — run embed-ncc for clause_guides first" }, 409);
      }
      const { data, error } = await supabaseAdmin
        .from("clause_guides")
        .update(live ? { is_live: true, reviewed_by: user.id, reviewed_at: new Date().toISOString() } : { is_live: false })
        .eq("id", id)
        .select("id, is_live, reviewed_at")
        .single();
      if (error) throw error;
      return json({ guide: data });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error("[admin-clause-guides]", e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
