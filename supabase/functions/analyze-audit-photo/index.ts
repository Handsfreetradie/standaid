import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAllowedOrigin } from "../_shared/cors.ts";

// Analyses one audit photo against the user's uploaded standards. Pro-only.
// Returns structured findings: what it sees, per-point compliance verdicts with
// clauses, an overall severity, and the questions it needs the tradie to answer
// (the measurements a photo can't show). User answers (user_notes) are fed back
// in on re-analysis — the Q&A loop.

// Duplicated (not imported) from src/lib/trades.ts — Deno edge functions
// don't share a build with the frontend.
const TRADE_PERSONA: Record<string, string> = {
  electrical: "electrician",
  plumbing: "plumber",
  building: "builder",
  carpentry: "carpenter",
  gas: "gas fitter",
  hvac: "HVAC technician",
  health_safety: "health & safety officer",
  engineering: "engineer",
  food_safety: "food safety auditor",
  other: "tradesperson",
};

const TRADE_KEYWORDS: Record<string, string> = {
  electrical: "clearance zone RCD earthing socket outlet switchboard wiring rules",
  plumbing: "backflow prevention pipe fall drainage water supply fixture",
  gas: "gas pipe sizing appliance connection flue isolation valve",
  hvac: "refrigerant line ductwork condensate drain clearance electrical isolation",
  building: "structural connection fixing waterproofing fire acoustic rating",
  carpentry: "framing structural connection fixing fastening span bracing",
  health_safety: "signage PPE controls egress exit hazard risk",
  engineering: "structural member weld connection mechanical fixing",
  food_safety: "food prep surface storage temperature handwash waste pest control",
  other: "compliance clearance installation requirements",
};

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
    const userId = user.id;

    // ── Pro gate ──
    const { data: profile } = await supabase.from("profiles").select("subscription_tier").eq("user_id", userId).single();
    const tier = profile?.subscription_tier || "free";
    if (tier !== "pro" && tier !== "business") {
      return json({ error: "Site Audit is a Pro feature. Upgrade to use it.", upgrade_required: true }, 403);
    }

    // ── Atomic rate limit (shares the AI usage limiter) ──
    const { data: used } = await supabase.rpc("check_and_record_ai_usage", {
      p_user_id: userId, p_kind: "audit", p_max: 60, p_window_seconds: 3600,
    });
    if (typeof used === "number" && used < 0) {
      return json({ error: "Hourly limit reached — please try again later." }, 429);
    }

    const { audit_id, photo_id } = await req.json();
    if (!audit_id || !photo_id) return json({ error: "audit_id and photo_id are required" }, 400);

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!ANTHROPIC_API_KEY || !OPENAI_API_KEY) return json({ error: "Service unavailable" }, 500);

    // ── Load the photo row (scoped to this user) ──
    const { data: photo } = await supabase
      .from("audit_photos").select("*")
      .eq("id", photo_id).eq("audit_id", audit_id).eq("user_id", userId).single();
    if (!photo) return json({ error: "Photo not found" }, 404);

    const { data: auditRow } = await supabase
      .from("audits").select("trade")
      .eq("id", audit_id).eq("user_id", userId).single();
    const trade: string | null = auditRow?.trade ?? null;
    const persona = TRADE_PERSONA[trade ?? ""] ?? "tradesperson";
    const keywords = TRADE_KEYWORDS[trade ?? ""] ?? TRADE_KEYWORDS.other;

    await supabase.from("audit_photos").update({ status: "analyzing" }).eq("id", photo_id);

    // ── Download the image and base64-encode (chunked to avoid stack overflow) ──
    const { data: fileData, error: dlError } = await supabase.storage.from("audit-photos").download(photo.storage_path);
    if (dlError || !fileData) {
      await supabase.from("audit_photos").update({ status: "failed" }).eq("id", photo_id);
      return json({ error: "Could not load photo" }, 500);
    }
    const bytes = new Uint8Array(await fileData.arrayBuffer());
    let binary = "";
    const SLICE = 0x8000;
    for (let i = 0; i < bytes.length; i += SLICE) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + SLICE) as unknown as number[]);
    const imageBase64 = btoa(binary);

    // ── Retrieve relevant clauses from the user's standards ──
    const label = photo.label || "installation";
    const retrievalQuery = `${label} installation compliance ${keywords} ${photo.user_notes || ""}`.trim();
    let contextChunks = "";
    try {
      const embRes = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "text-embedding-3-small", input: retrievalQuery }),
      });
      if (embRes.ok) {
        const emb = (await embRes.json()).data[0].embedding;
        const { data: chunks } = await supabase.rpc("match_chunks", {
          query_embedding: emb, match_user_id: userId, match_threshold: 0.3, match_count: 12,
        });
        if (chunks?.length) {
          contextChunks = chunks.map((c: any, i: number) =>
            `[Source ${i + 1} — ${c.clause_number || "N/A"}]\n${c.content}`).join("\n\n");
        }
      }
    } catch (e) {
      console.error("[analyze-audit-photo] retrieval failed:", e);
    }

    const systemPrompt = `You are assisting a licensed Australian ${persona} auditing an installation from a photo${photo.label ? ` labelled "${photo.label}"` : ""}.

CRITICAL RULES:
- Assess ONLY what is clearly visible. NEVER guess measurements, distances, heights, clearances, cable sizes, or whether something is RCD-protected from a photo — a wrong value is dangerous.
- For anything you cannot determine from the image, put a specific question in "needs_to_know" (e.g. "What is the horizontal distance from the socket to the sink edge?").
- Cite clause numbers ONLY from the retrieved standard extracts below. If the extracts don't cover a point, say so plainly — do not invent clauses.
- This is a reference aid, not a certified inspection.

${photo.user_notes ? `The tradie has provided these answers to earlier questions — use them:\n${photo.user_notes}\n` : ""}
RETRIEVED STANDARD EXTRACTS:
${contextChunks || "(none found — assess visually and flag what to check in the standard)"}`;

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "Content-Type": "application/json", "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-opus-4-8",
        max_tokens: 1500,
        system: systemPrompt,
        tools: [{
          name: "return_assessment",
          description: "Return the structured compliance assessment for this photo",
          input_schema: {
            type: "object",
            properties: {
              what_i_see: { type: "string", description: "Plain description of the installation shown" },
              assessments: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    point: { type: "string" },
                    verdict: { type: "string", enum: ["compliant", "concern", "non_compliant", "cant_tell"] },
                    clause: { type: "string", description: "Clause number from extracts, or empty" },
                  },
                  required: ["point", "verdict"],
                },
              },
              needs_to_know: { type: "array", items: { type: "string" } },
              severity: { type: "string", enum: ["compliant", "concern", "non_compliant", "cant_tell"] },
            },
            required: ["what_i_see", "assessments", "needs_to_know", "severity"],
          },
        }],
        tool_choice: { type: "tool", name: "return_assessment" },
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageBase64 } },
            { type: "text", text: "Assess this installation photo against the standards. Be precise; ask for anything you can't measure from the image." },
          ],
        }],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error("[analyze-audit-photo] AI error:", aiRes.status, errText);
      await supabase.from("audit_photos").update({ status: "failed" }).eq("id", photo_id);
      return json({ error: "Analysis failed — please try again." }, 502);
    }

    const aiData = await aiRes.json();
    const block = aiData.content?.find?.((b: any) => b.type === "tool_use");
    const result = block?.input;
    if (!result) {
      await supabase.from("audit_photos").update({ status: "failed" }).eq("id", photo_id);
      return json({ error: "No assessment generated" }, 502);
    }

    const citations = (result.assessments || [])
      .filter((a: any) => a.clause)
      .map((a: any) => ({ clause_number: a.clause }));

    await supabase.from("audit_photos").update({
      status: "done",
      what_i_see: result.what_i_see ?? null,
      assessments: result.assessments ?? [],
      needs_to_know: result.needs_to_know ?? [],
      severity: result.severity ?? "cant_tell",
      citations,
      updated_at: new Date().toISOString(),
    }).eq("id", photo_id);

    return json({ status: "done", ...result });
  } catch (e) {
    console.error("[analyze-audit-photo] error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
