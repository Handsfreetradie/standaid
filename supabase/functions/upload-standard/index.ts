import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGIN") || "http://localhost:8080")
  .split(",").map((o: string) => o.trim());

function getAllowedOrigin(origin: string): string {
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  if (origin.endsWith(".lovable.app") || origin.startsWith("http://localhost")) return origin;
  return ALLOWED_ORIGINS[0];
}

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

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
    const userId = user.id;

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

    // Validate PDF — size, MIME type, then magic bytes (%PDF)
    if (file.size > 50 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: "File must be under 50MB" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (file.type !== "application/pdf") {
      return new Response(JSON.stringify({ error: "Only PDF files are accepted" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const fileBuffer = await file.arrayBuffer();
    const magic = new Uint8Array(fileBuffer.slice(0, 4));
    if (magic[0] !== 0x25 || magic[1] !== 0x50 || magic[2] !== 0x44 || magic[3] !== 0x46) {
      return new Response(JSON.stringify({ error: "Invalid file format. Only PDF files are accepted." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
      .upload(filePath, fileBuffer, { contentType: "application/pdf" });

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

    // Insert processing job (replaces fire-and-forget fetch)
    await supabase.from("processing_jobs").insert({
      standard_id: standard.id,
      user_id: userId,
      status: "pending",
    });

    // Still trigger processing immediately for responsiveness (fire-and-forget)
    // but now we have a job record for status tracking
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
