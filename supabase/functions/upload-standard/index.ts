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

    const tier = profile?.subscription_tier || "free"; // least privilege — a missing profile must never grant pro

    // A team member contributing to a paid team library shouldn't be gated
    // by their own personal tier — the org's paid seats are what's being
    // billed for, not this individual's subscription.
    const { data: membership } = await supabaseAdmin
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    const organizationId = membership?.organization_id ?? null;

    // Parse JSON body — file was uploaded directly to storage by the browser
    const body = await req.json();
    const { title, standard_code: standardCode, version, trade_category: tradeCategory, file_path: filePath, extracted_text: extractedText, extracted_text_path: extractedTextPath, amends_standard_id: amendsStandardId } = body;

    if (!title || !filePath) {
      return new Response(JSON.stringify({ error: "title and file_path are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Ensure the file paths belong to this user
    if (!filePath.startsWith(`${userId}/`) || (extractedTextPath && !extractedTextPath.startsWith(`${userId}/`))) {
      return new Response(JSON.stringify({ error: "Unauthorised file path" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // An amendment must point at a standard the caller (or their team) actually owns —
    // otherwise a crafted amends_standard_id could link onto someone else's library.
    if (amendsStandardId) {
      const targetQuery = supabaseAdmin.from("standards").select("id").eq("id", amendsStandardId);
      const { data: target } = await (
        organizationId ? targetQuery.eq("organization_id", organizationId) : targetQuery.eq("user_id", userId)
      ).maybeSingle();
      if (!target) {
        return new Response(JSON.stringify({ error: "The standard this amends could not be found in your library" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // If the user already has this exact document, delete the old record and its chunks
    // so the new upload replaces it cleanly. Do this BEFORE the tier check so re-uploads
    // of existing standards don't incorrectly count against the limit.
    // Base standards and amendments are scoped separately: a base upload only replaces
    // another base with the same code, and an amendment only replaces a PREVIOUS
    // amendment of the SAME base standard with the same code — so uploading "AS/NZS
    // 3000 Amendment 2" never wipes out the base "AS/NZS 3000" standard it amends, but
    // re-uploading the same amendment twice still gets deduplicated instead of piling up.
    let isReplacement = false;
    if (standardCode) {
      // Team members share one library — match on the org's copy (any
      // member's upload), not just this caller's own, so re-uploading an
      // existing team standard replaces it rather than duplicating it.
      let existingQuery = supabaseAdmin
        .from("standards")
        .select("id, file_path")
        .eq("standard_code", standardCode);
      existingQuery = amendsStandardId
        ? existingQuery.eq("amends_standard_id", amendsStandardId)
        : existingQuery.is("amends_standard_id", null);
      const { data: existing } = await (
        organizationId ? existingQuery.eq("organization_id", organizationId) : existingQuery.eq("user_id", userId)
      ).maybeSingle();

      if (existing) {
        isReplacement = true;
        await supabaseAdmin.from("standard_chunks").delete().eq("standard_id", existing.id);
        await supabaseAdmin.from("standard_figures").delete().eq("standard_id", existing.id);
        await supabaseAdmin.from("standard_tables").delete().eq("standard_id", existing.id);
        await supabaseAdmin.from("processing_jobs").delete().eq("standard_id", existing.id);
        await supabaseAdmin.from("standards").delete().eq("id", existing.id);

        // Remove the replaced standard's storage too — PDFs are 20-50MB each
        // and were previously orphaned forever on every re-upload.
        try {
          if (existing.file_path) {
            const oldTxt = (existing.file_path as string).replace(/\.pdf$/i, ".txt");
            await supabaseAdmin.storage.from("standards").remove([existing.file_path, oldTxt]);
          }
          const figureFolder = `${userId}/${existing.id}`;
          const { data: figureFiles } = await supabaseAdmin.storage.from("standard-figures").list(figureFolder);
          if (figureFiles && figureFiles.length > 0) {
            await supabaseAdmin.storage.from("standard-figures").remove(
              figureFiles.map((f) => `${figureFolder}/${f.name}`),
            );
          }
        } catch (cleanupErr) {
          console.warn(`[upload-standard] Storage cleanup for replaced standard ${existing.id} failed:`, cleanupErr);
        }
      }
    }

    // Tier limit only applies to brand-new standards (not replacements or
    // amendments to a standard the user already has counted), and only to
    // individual users — an active team member is covered by the org's paid
    // seats instead.
    // Failed uploads don't count — a few doomed retries of a bad PDF used to
    // fill all 5 slots and lock the user out behind an upgrade prompt.
    if (tier === "free" && !isReplacement && !amendsStandardId && !organizationId) {
      const { count } = await supabaseAdmin
        .from("standards")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .neq("extraction_status", "failed");

      if ((count || 0) >= 1) {
        return new Response(JSON.stringify({
          error: "Free tier limit reached. The free plan includes 1 standard. Upgrade to Pro for unlimited uploads.",
          upgrade_required: true
        }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Create standard record with the file_path already known
    const { data: standard, error: insertError } = await supabaseAdmin
      .from("standards")
      .insert({
        user_id: userId,
        organization_id: organizationId,
        title,
        standard_code: standardCode || null,
        version: version || null,
        trade_category: tradeCategory || null,
        file_path: filePath,
        amends_standard_id: amendsStandardId || null,
        extraction_status: "pending",
        is_partial: tier === "free" && !organizationId,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Insert error:", JSON.stringify(insertError));
      return new Response(JSON.stringify({ error: "Failed to create standard record", details: insertError.message }), {
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
    console.log(`[upload-standard] Triggering process-standard for standard ${standard.id}`);
    const processPromise = fetch(processUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceRoleKey}`,
        "x-user-auth": authHeader,
      },
      body: JSON.stringify({ standard_id: standard.id, user_id: userId, extracted_text: extractedText, extracted_text_path: extractedTextPath }),
    }).then(async r => {
      if (!r.ok) {
        const text = await r.text();
        console.error(`[upload-standard] process-standard trigger failed: ${r.status}`, text);
      } else {
        console.log(`[upload-standard] process-standard triggered successfully`);
      }
    }).catch(err => console.error("[upload-standard] Failed to trigger processing:", err));

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
    console.error("[upload-standard] Unexpected error:", JSON.stringify(e));
    const errorMsg = e instanceof Error ? e.message : String(e);
    console.error("[upload-standard] Error details:", errorMsg);
    return new Response(JSON.stringify({ error: errorMsg, code: "UPLOAD_ERROR" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
