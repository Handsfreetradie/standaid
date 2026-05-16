import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAllowedOrigin } from "../_shared/cors.ts";

declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void } | undefined;

serve(async (req) => {
  const origin = req.headers.get("Origin") || "";
  const corsHeaders = {
    "Access-Control-Allow-Origin": getAllowedOrigin(origin),
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
    const userId = user.id;

    // Check free tier standard limit
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("subscription_tier")
      .eq("user_id", userId)
      .single();

    const tier = profile?.subscription_tier || "free";

    // Parse JSON body — file was uploaded directly to storage by the browser
    const body = await req.json();
    const { title, standard_code: standardCode, version, trade_category: tradeCategory, file_path: filePath, extracted_text: extractedText } = body;

    if (!title || !filePath) {
      return new Response(JSON.stringify({ error: "title and file_path are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Ensure the file_path belongs to this user
    if (!filePath.startsWith(`${userId}/`)) {
      return new Response(JSON.stringify({ error: "Unauthorised file path" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // If the user already has this standard code, delete the old record and its chunks
    // so the new upload replaces it cleanly. Do this BEFORE the tier check so re-uploads
    // of existing standards don't incorrectly count against the limit.
    let isReplacement = false;
    if (standardCode) {
      const { data: existing } = await supabaseAdmin
        .from("standards")
        .select("id")
        .eq("user_id", userId)
        .eq("standard_code", standardCode)
        .maybeSingle();

      if (existing) {
        isReplacement = true;
        await supabaseAdmin.from("standard_chunks").delete().eq("standard_id", existing.id);
        await supabaseAdmin.from("processing_jobs").delete().eq("standard_id", existing.id);
        await supabaseAdmin.from("standards").delete().eq("id", existing.id);
      }
    }

    // Tier limit only applies to brand-new standards (not replacements)
    if (tier === "free" && !isReplacement) {
      const { count } = await supabaseAdmin
        .from("standards")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId);

      if ((count || 0) >= 5) {
        return new Response(JSON.stringify({
          error: "Free tier limit reached. You can upload up to 5 standards on the free plan. Upgrade to Pro for unlimited uploads.",
          upgrade_required: true
        }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Create standard record with the file_path already known
    const { data: standard, error: insertError } = await supabaseAdmin
      .from("standards")
      .insert({
        user_id: userId,
        title,
        standard_code: standardCode || null,
        version: version || null,
        trade_category: tradeCategory || null,
        file_path: filePath,
        extraction_status: "pending",
        is_partial: tier === "free",
      })
      .select()
      .single();

    if (insertError) {
      console.error("Insert error:", insertError);
      return new Response(JSON.stringify({ error: "Failed to create standard record" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Insert processing job (replaces fire-and-forget fetch)
    await supabaseAdmin.from("processing_jobs").insert({
      standard_id: standard.id,
      user_id: userId,
      status: "pending",
    });

    // Trigger processing using service role key so the inter-function call
    // doesn't depend on the user's JWT (which may be rejected for internal calls).
    const processUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/process-standard`;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const processPromise = fetch(processUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceRoleKey}`,
        "x-user-auth": authHeader,
      },
      body: JSON.stringify({ standard_id: standard.id, user_id: userId, extracted_text: extractedText }),
    }).then(r => {
      if (!r.ok) r.text().then(t => console.error("process-standard trigger failed:", r.status, t));
    }).catch(err => console.error("Failed to trigger processing:", err));

    if (typeof EdgeRuntime !== "undefined") {
      EdgeRuntime.waitUntil(processPromise);
    } else {
      await processPromise;
    }

    return new Response(JSON.stringify({ 
      standard_id: standard.id, 
      status: "pending",
      message: "Standard uploaded successfully. Processing will begin shortly." 
    }), { 
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  } catch (e) {
    console.error("Upload error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { 
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }
});
