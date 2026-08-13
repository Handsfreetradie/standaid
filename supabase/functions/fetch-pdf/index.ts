import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAllowedOrigin } from "../_shared/cors.ts";

serve(async (req) => {
  const origin = req.headers.get("Origin") || "";
  const corsHeaders = {
    "Access-Control-Allow-Origin": getAllowedOrigin(origin),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing auth" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorised" }, 401);

    const { standard_id, standard_code, clause_number, page_number: pageOverride } = await req.json();
    if (!standard_id && !standard_code) return json({ error: "standard_id or standard_code required" }, 400);

    // Look up standard. This client uses the caller's own JWT (not service
    // role), so RLS is the actual enforcement here — and RLS on `standards`
    // already allows a user to see their OWN uploads OR any standard shared
    // via an org they're an active member of (is_active_org_member). An
    // explicit .eq("user_id", user.id) on top of that used to narrow every
    // query back down to "only what I personally uploaded" — so a team
    // member clicking a citation whose standard a teammate had uploaded got
    // "Standard not found" -> "Could not load PDF", even though the answer
    // itself (via query/index.ts's org-aware retrieval) correctly cited it.
    let standardQuery = supabase
      .from("standards")
      .select("id, file_path, title, standard_code")
      .limit(1)
      .single();

    if (standard_id) {
      standardQuery = supabase
        .from("standards")
        .select("id, file_path, title, standard_code")
        .eq("id", standard_id)
        .single();
    } else {
      standardQuery = supabase
        .from("standards")
        .select("id, file_path, title, standard_code")
        .ilike("standard_code", `%${standard_code}%`)
        .limit(1)
        .single();
    }

    const { data: standard, error: stdError } = await standardQuery;
    if (stdError || !standard?.file_path) return json({ error: "Standard not found" }, 404);

    // Look up page number for this clause (skip if caller provided a direct page override)
    let page_number: number | null = typeof pageOverride === "number" ? pageOverride : null;
    let clause_title: string | null = null;

    if (page_number === null && clause_number) {
      // Case-insensitive: the frontend sends "Table 8.1"/"Figure 3.2" (title
      // case) for table/figure clicks, but extraction.ts stores clause_number
      // as "TABLE 8.1"/"FIGURE 3.2" (uppercase) — a case-sensitive .eq() here
      // silently matched nothing whenever the page wasn't already resolved
      // upstream, defaulting to page 1 on every such table/figure open.
      const { data: chunks } = await supabase
        .from("standard_chunks")
        .select("page_number, clause_title, content, chunk_index")
        .eq("standard_id", standard.id)
        .ilike("clause_number", clause_number)
        .order("chunk_index", { ascending: true })
        .limit(5);

      // Skip table-of-contents chunks (dotted leaders like "TESTING .... 419")
      // so the viewer opens on the actual clause, not its ToC entry near the
      // front of the document. Fall back to the first match if every candidate
      // looks like a ToC entry.
      const chunk =
        (chunks || []).find((c) => !/\.{4,}/.test(c.content || "")) || (chunks || [])[0];

      if (chunk) {
        page_number = chunk.page_number;
        clause_title = chunk.clause_title;
      }
    }

    // Generate 1-hour signed URL.
    //
    // Signing runs on a SERVICE-ROLE client, deliberately, and deliberately
    // only after the lookup above has already succeeded — that lookup is the
    // access check, and it runs on the caller's own JWT so RLS decides what
    // they may see (own uploads, or a standard shared via an org they're an
    // active member of). Never move this before the lookup.
    //
    // It cannot use the caller's client: storage RLS on the `standards` bucket
    // is `auth.uid() = (storage.foldername(name))[1]` — user-folder only, with
    // no org clause — while the `standards` TABLE policy is org-aware. So a
    // team member opening a standard a colleague uploaded passed the lookup
    // and then failed at signing, returning 500 "Failed to generate PDF link"
    // for every citation, figure and table they clicked. Same pattern the
    // query function already uses to sign figure images.
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: signedData, error: signError } = await supabaseAdmin.storage
      .from("standards")
      .createSignedUrl(standard.file_path, 3600);

    if (signError || !signedData?.signedUrl) {
      console.error("Signed URL error:", signError);
      return json({ error: "Failed to generate PDF link" }, 500);
    }

    return json({
      signed_url: signedData.signedUrl,
      page_number: page_number ?? 1,
      clause_title,
      standard_title: standard.title,
      standard_code: standard.standard_code,
      standard_id: standard.id,
    });
  } catch (e) {
    console.error("[fetch-pdf] error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
