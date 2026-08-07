import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAllowedOrigin } from "../_shared/cors.ts";
import { logTokenUsage } from "../_shared/log-usage.ts";

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
  electrical: "clearance zone RCD RCBO earthing socket outlet switchboard wiring rules main switch isolator orientation line load polarity termination conductor size neutral",
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

// Category checklists — steer the model to actively check for the specific
// things an experienced tradesperson checks by trained habit, not just
// describe whatever's most visually obvious. Without this, vision models
// reliably report messy wiring / missing covers but miss quieter defects
// like a reversed RCD or an upside-down isolator.
const TRADE_CHECKLIST: Record<string, string> = {
  electrical: `- Main switch / isolators: correct orientation and mechanical operation (not fitted upside down), clearly labelled
- Terminations: conductor fully inside the terminal with no bare copper exposed outside it, screws/lugs appear tight, no over- or under-stripped insulation
- Conductor sizing: active, neutral and earth consistent in size for each circuit — flag a neutral that looks visibly thinner than its actives
- RCDs/RCBOs: check line and load are not reversed (supply lands on line, circuit conductors on load), and that each device's active is fed from an appropriate upstream supply point — not spurred off another breaker's load/output terminals
- Earthing: earth bar terminals not overloaded with multiple conductors under one screw unless rated for it, visible earth continuity
- Enclosure: cover/door fitted, no exposed live parts, cable entries have grommets/glands (no bare cable over a sharp edge)
- Labelling: circuit directory present and legible`,
  plumbing: `- Pipe falls/grades appear consistent with flow direction (not visibly back-falling)
- Backflow prevention device fitted and orientated correctly (flow-direction arrow)
- Fixture connections fully seated, no visible gaps or cross-threading
- Isolation valves present and accessible`,
  gas: `- Isolation valve present, correct type, and accessible
- Flue/appliance clearances from combustibles look correct
- Pipe joints show no obvious sealant/thread issues
- Appliance connection fittings match the pipe material`,
  hvac: `- Electrical isolation switch present near the unit and correctly labelled
- Condensate drain has a visible fall away from the unit, not pooling
- Refrigerant line insulation intact, no visible kinks or crush points
- Unit mounted level and clearances from walls/obstructions look adequate`,
  building: `- Structural connections/fixings appear complete (no missing fasteners)
- Waterproofing membrane/flashing continuity at penetrations and junctions
- Fire-rated elements not visibly compromised by penetrations
- Bracing/tie-downs present where expected`,
  carpentry: `- Framing connections fully fixed (no missing nails/screws/joist hangers)
- Span/bracing looks adequate for what's visible
- No visible notching/boring that looks excessive for the member size`,
  health_safety: `- Required signage present, correct, and legible
- Egress path clear and exit signage visible
- PPE appropriate for the visible hazard is in use
- Guarding/barriers in place around visible hazards`,
  engineering: `- Weld/connection quality visibly consistent (no obvious undercut, porosity, or missing welds)
- Mechanical fixings fully seated and of a consistent type/size
- No visible corrosion or damage at load-bearing connections`,
  food_safety: `- Food-contact surfaces appear intact, non-porous, and clean
- Raw/cooked separation visible where relevant
- Handwash station accessible and stocked
- No visible pest evidence`,
  other: `- Check for anything visibly incomplete, incorrectly orientated, or inconsistent with the rest of the installation`,
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
    const checklist = TRADE_CHECKLIST[trade ?? ""] ?? TRADE_CHECKLIST.other;

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
        const embJson = await embRes.json();
        if (embJson.usage) {
          logTokenUsage(supabase, {
            userId, kind: "audit_embedding", model: "text-embedding-3-small", refId: photo_id,
            usage: { input_tokens: embJson.usage.prompt_tokens ?? 0, output_tokens: 0 },
          });
        }
        const emb = embJson.data[0].embedding;
        const { data: chunks } = await supabase.rpc("match_chunks", {
          query_embedding: emb, match_user_id: userId, match_threshold: 0.25, match_count: 16,
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
- Use your general trade knowledge to identify issues and explain your reasoning — you are not limited to only what's in the retrieved extracts below.
- However, only put a clause number in "clause" when that exact clause appears in the retrieved standard extracts below. If you're confident something is wrong from general knowledge but no matching clause was retrieved, still raise it (leave "clause" empty) and say plainly that the exact clause should be checked against the standard. NEVER invent or guess a clause number.
- For anything you cannot determine from the image, put a specific question in "needs_to_know" (e.g. "What is the horizontal distance from the socket to the sink edge?").
- This is a reference aid, not a certified inspection.

Don't just describe the most visually obvious things (mess, dust, missing covers). Actively work through this checklist and call out anything wrong, even if subtle — these are the kinds of things an experienced ${persona} checks by habit:
${checklist}

${photo.user_notes ? `The tradie has added the following notes across one or more rounds — this may include answers to your earlier questions, and/or something they've spotted on site that you missed. Treat it as reliable first-hand information: fold it into "what_i_see" and "assessments" (with a clause if the extracts support one), don't just repeat it back:\n${photo.user_notes}\n` : ""}
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
    if (aiData.usage) {
      logTokenUsage(supabase, {
        userId, kind: "audit_photo", model: "claude-opus-4-8", refId: photo_id,
        usage: {
          input_tokens: aiData.usage.input_tokens ?? 0,
          output_tokens: aiData.usage.output_tokens ?? 0,
          cache_read_tokens: aiData.usage.cache_read_input_tokens ?? 0,
          cache_creation_tokens: aiData.usage.cache_creation_input_tokens ?? 0,
        },
      });
    }
    const block = aiData.content?.find?.((b: any) => b.type === "tool_use");
    const result = block?.input;
    if (!result) {
      await supabase.from("audit_photos").update({ status: "failed" }).eq("id", photo_id);
      return json({ error: "No assessment generated" }, 502);
    }

    // ── Second-pass retrieval for flagged issues with no clause ──
    // The first pass runs one generic retrieval before the model even knows
    // what it's going to find. If it flags a concern but the generic query
    // didn't surface the right clause, try again with a query built from the
    // actual flagged points, then a small text-only Haiku call (no image —
    // far cheaper than another vision pass) to match points to clauses. A
    // clause is only ever accepted if it's copied verbatim from a retrieved
    // extract — this never gets to invent one.
    const unclausedFlags = (result.assessments || [])
      .map((a: any, i: number) => ({ ...a, index: i }))
      .filter((a: any) => !a.clause && (a.verdict === "concern" || a.verdict === "non_compliant"))
      .slice(0, 5);

    if (unclausedFlags.length) {
      try {
        const followUpQuery = unclausedFlags.map((a: any) => a.point).join(". ");
        const embRes2 = await fetch("https://api.openai.com/v1/embeddings", {
          method: "POST",
          headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "text-embedding-3-small", input: followUpQuery }),
        });
        if (embRes2.ok) {
          const embJson2 = await embRes2.json();
          if (embJson2.usage) {
            logTokenUsage(supabase, {
              userId, kind: "audit_embedding", model: "text-embedding-3-small", refId: photo_id,
              usage: { input_tokens: embJson2.usage.prompt_tokens ?? 0, output_tokens: 0 },
            });
          }
          const emb2 = embJson2.data[0].embedding;
          const { data: moreChunks } = await supabase.rpc("match_chunks", {
            query_embedding: emb2, match_user_id: userId, match_threshold: 0.2, match_count: 10,
          });
          if (moreChunks?.length) {
            const knownClauses = new Set(moreChunks.map((c: any) => c.clause_number).filter(Boolean));
            const extractsText = moreChunks.map((c: any, i: number) =>
              `[Extract ${i + 1} — ${c.clause_number || "N/A"}]\n${c.content}`).join("\n\n");
            const itemsText = unclausedFlags.map((a: any, i: number) =>
              `${i + 1}. "${a.point}" (verdict: ${a.verdict})`).join("\n");

            const matchRes = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: { "x-api-key": ANTHROPIC_API_KEY, "Content-Type": "application/json", "anthropic-version": "2023-06-01" },
              body: JSON.stringify({
                model: "claude-haiku-4-5-20251001",
                max_tokens: 400,
                system: "Match already-identified issues to specific clauses from the extracts below. Only include an item if one of the extracts clearly supports citing a specific clause for that exact point — copy the clause exactly as shown (never \"N/A\"). Never invent a clause. Omit any item with no clear match.",
                tools: [{
                  name: "return_clause_matches",
                  description: "Return clause matches for the numbered items",
                  input_schema: {
                    type: "object",
                    properties: {
                      matches: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            item_number: { type: "number" },
                            clause: { type: "string" },
                          },
                          required: ["item_number", "clause"],
                        },
                      },
                    },
                    required: ["matches"],
                  },
                }],
                tool_choice: { type: "tool", name: "return_clause_matches" },
                messages: [{
                  role: "user",
                  content: `NUMBERED ITEMS:\n${itemsText}\n\nEXTRACTS:\n${extractsText}`,
                }],
              }),
            });

            if (matchRes.ok) {
              const matchData = await matchRes.json();
              if (matchData.usage) {
                logTokenUsage(supabase, {
                  userId, kind: "audit_clause_match", model: "claude-haiku-4-5", refId: photo_id,
                  usage: {
                    input_tokens: matchData.usage.input_tokens ?? 0,
                    output_tokens: matchData.usage.output_tokens ?? 0,
                    cache_read_tokens: matchData.usage.cache_read_input_tokens ?? 0,
                    cache_creation_tokens: matchData.usage.cache_creation_input_tokens ?? 0,
                  },
                });
              }
              const matchBlock = matchData.content?.find?.((b: any) => b.type === "tool_use");
              const matches = matchBlock?.input?.matches || [];
              for (const m of matches) {
                const flag = unclausedFlags[m.item_number - 1];
                if (flag && m.clause && knownClauses.has(m.clause)) {
                  result.assessments[flag.index].clause = m.clause;
                }
              }
            }
          }
        }
      } catch (e) {
        console.error("[analyze-audit-photo] second-pass clause match failed:", e);
      }
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
