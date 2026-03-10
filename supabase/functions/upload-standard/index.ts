import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
    const userId = claimsData.claims.sub as string;

    // Check free tier standard limit
    const { data: profile } = await supabase
      .from("profiles")
      .select("subscription_tier")
      .eq("user_id", userId)
      .single();

    const tier = profile?.subscription_tier || "free";

    if (tier === "free") {
      const { count } = await supabase
        .from("standards")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId);

      if ((count || 0) >= 1) {
        return new Response(JSON.stringify({ 
          error: "Free tier limit reached. You can only upload 1 standard on the free plan. Upgrade to Pro for unlimited uploads.",
          upgrade_required: true
        }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Parse multipart form data
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const title = formData.get("title") as string;
    const standardCode = formData.get("standard_code") as string;
    const version = formData.get("version") as string;
    const tradeCategory = formData.get("trade_category") as string;

    if (!file || !title) {
      return new Response(JSON.stringify({ error: "File and title are required" }), { 
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    // Validate PDF
    if (file.type !== "application/pdf") {
      return new Response(JSON.stringify({ error: "Only PDF files are accepted" }), { 
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    if (file.size > 50 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: "File must be under 50MB" }), { 
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    // Create standard record
    const { data: standard, error: insertError } = await supabase
      .from("standards")
      .insert({
        user_id: userId,
        title,
        standard_code: standardCode || null,
        version: version || null,
        trade_category: tradeCategory || null,
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

    // Upload file to storage
    const filePath = `${userId}/${standard.id}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from("standards")
      .upload(filePath, file, { contentType: "application/pdf" });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      await supabase.from("standards").delete().eq("id", standard.id);
      return new Response(JSON.stringify({ error: "Failed to upload file" }), { 
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    // Update standard with file path
    await supabase
      .from("standards")
      .update({ file_path: filePath })
      .eq("id", standard.id);

    // Trigger processing via the process-standard function
    const processUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/process-standard`;
    fetch(processUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({ standard_id: standard.id }),
    }).catch(err => console.error("Failed to trigger processing:", err));

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
