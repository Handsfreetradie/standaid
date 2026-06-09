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

    // Look up standard (RLS ensures user can only see their own)
    let standardQuery = supabase
      .from("standards")
      .select("id, file_path, title, standard_code")
      .eq("user_id", user.id)
      .limit(1)
      .single();

    if (standard_id) {
      standardQuery = supabase
        .from("standards")
        .select("id, file_path, title, standard_code")
        .eq("id", standard_id)
        .eq("user_id", user.id)
        .single();
    } else {
      standardQuery = supabase
        .from("standards")
        .select("id, file_path, title, standard_code")
        .eq("user_id", user.id)
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
      const { data: chunk } = await supabase
        .from("standard_chunks")
        .select("page_number, clause_title")
        .eq("standard_id", standard.id)
        .eq("clause_number", clause_number)
        .limit(1)
        .single();

      if (chunk) {
        page_number = chunk.page_number;
        clause_title = chunk.clause_title;
      }
    }

    // Generate 1-hour signed URL
    const { data: signedData, error: signError } = await supabase.storage
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
