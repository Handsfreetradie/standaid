import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAllowedOrigin } from "../_shared/cors.ts";
import { logTokenUsage } from "../_shared/log-usage.ts";

// Reads an uploaded builder's plan (rasterized PDF page or photo) and returns
// the wall outline plus any hand-marked fixture locations on it, all in
// normalized 0-1 image coordinates. Nothing is written to the DB here — the
// frontend owns turning this into walls/fittings (via polygonToWalls,
// computeMeasurementLock etc.) after the tradie confirms scale, same as
// every other Setout mutation is client-driven.
//
// Two earlier approaches to detecting EXISTING electrical symbols on a plan
// (a single whole-image pass, then a tiled multi-pass) both failed real
// testing — asking a vision model to classify which of 39 subtle
// professional CAD symbol conventions a small mark represents is
// inherently unreliable, and tiling made it worse by losing the whole-plan
// context needed to disambiguate an ambiguous mark (e.g. a switch's small
// tick vs a door swing line vs a dimension tick). This replaces that
// entirely: the tradie marks fixture locations themselves with bright
// highlighter/pen marks in whatever colours they choose, and the AI's job
// shrinks to finding high-contrast hand-marks and grouping them by colour —
// a well-understood, reliable vision task. The *meaning* of each colour
// (which fitting type it represents) is a human decision made client-side
// after extraction, not something the AI has to guess.

const MARK_COLORS = ["red", "orange", "yellow", "green", "blue", "purple", "pink", "black"];

const SYSTEM_PROMPT = `You are reading an Australian residential/commercial electrical or architectural floor plan (a builder's PDF page or a site photo of a plan) for a licensed electrician who will use your output to set out the job. Precision matters — the electrician measures from these positions on site.

TASK 1 — Wall outline: trace the outer perimeter of the room/house as an ordered polygon of corner points, walking the perimeter in one direction (clockwise or counterclockwise, either is fine as long as it's consistent). Use normalized image coordinates: x and y each range 0-1, where (0,0) is the top-left corner of the image and (1,1) is the bottom-right. Only trace what is clearly a wall line on the drawing — do not guess at a wall you can't actually see (e.g. because it's obscured or the plan is cropped).

TASK 2 — Scale: if a dimension is legibly labelled on the drawing spanning two of the corners you traced (e.g. "4200", "3.6m", "4200mm"), report which two corners it spans and the real-world length in metres. Only report this if you can actually read a number on the plan — never estimate or guess a scale from typical room sizes. If no legible dimension is visible, omit this field entirely.

TASK 3 — Internal walls: this plan may show internal partition walls dividing rooms (most real house/building plans do), or it may be a single room with no internal walls — both are normal. For every internal wall line you can actually see, report it as its own line segment (two endpoint points, same normalized 0-1 coordinates) — these don't need to connect into a closed shape like the outer perimeter does, each one is independent. Do not include the exterior perimeter walls here, only genuine internal partitions.

TASK 4 — Doors and windows: for every door and window opening you can see cut into ANY wall (exterior or internal), report it as its own short line segment spanning the gap in the wall (two endpoint points, same normalized 0-1 coordinates), plus whether it's a "door" or "window". A door is typically drawn as a gap in the wall with a quarter-circle swing arc; a window is typically a gap with a thin line or double-tick across it, sometimes with sill lines. Only report openings you can actually see — don't guess that a wall has a door just because a room needs one.

TASK 5 — Hand-marked fixture locations: the tradie may have marked up this plan themselves with a highlighter or pen to indicate where electrical fixtures go — bright, hand-drawn dots/circles/ticks that are clearly NOT part of the plan's own printed drawing (which is black/grey/blue CAD linework). Completely ignore the plan's own printed electrical symbols, room labels, and dimension marks for this task — only report the tradie's own added marks. For each hand-mark found, report its position (same normalized 0-1 coordinates) and its colour, picked from exactly this list: ${MARK_COLORS.join(", ")}. Pick whichever colour in the list is the closest match — don't invent a colour name outside this list. If the plan has no hand-marks on it at all, that's a normal, valid result — return an empty array.

Never invent a wall, door, window, or mark that isn't actually visible. Call return_plan_extraction with your findings — interior_walls, openings, and marks can all be empty arrays if the plan genuinely has none.`;

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

    // ── Setout add-on gate (mirrors src/App.tsx's SetoutRoute) ──
    const { data: profile } = await supabase.from("profiles").select("has_setout_addon, trade_type").eq("user_id", userId).single();
    const trades = profile?.trade_type ? String(profile.trade_type).split(",").filter(Boolean) : [];
    if (!trades.includes("electrical") || !profile?.has_setout_addon) {
      return json({ error: "Rough-In Setout is a paid add-on for electrical trades." }, 403);
    }

    // ── Atomic rate limit — lower cap than photo audits since this is a
    // heavier, per-plan action rather than a per-photo one ──
    const { data: used } = await supabase.rpc("check_and_record_ai_usage", {
      p_user_id: userId, p_kind: "setout_import", p_max: 20, p_window_seconds: 3600,
    });
    if (typeof used === "number" && used < 0) {
      return json({ error: "Hourly limit reached — please try again later." }, 429);
    }

    const { storage_path, content_type, plan_id } = await req.json();
    if (!storage_path) return json({ error: "storage_path is required" }, 400);
    // storage_path must be the caller's own folder — belt-and-braces on top
    // of the storage RLS policy, since we're downloading with the service
    // role key here (which bypasses RLS).
    if (!storage_path.startsWith(`${userId}/`)) return json({ error: "Unauthorized" }, 403);

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) return json({ error: "Service unavailable" }, 500);

    // ── Download and base64-encode (chunked to avoid stack overflow on large images) ──
    const { data: fileData, error: dlError } = await supabase.storage.from("setout-plan-uploads").download(storage_path);
    if (dlError || !fileData) return json({ error: "Could not load the uploaded plan" }, 500);
    const bytes = new Uint8Array(await fileData.arrayBuffer());
    let binary = "";
    const SLICE = 0x8000;
    for (let i = 0; i < bytes.length; i += SLICE) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + SLICE) as unknown as number[]);
    const imageBase64 = btoa(binary);
    const mediaType = content_type === "image/jpeg" ? "image/jpeg" : "image/png";

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "Content-Type": "application/json", "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-opus-4-8",
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        tools: [{
          name: "return_plan_extraction",
          description: "Return the extracted wall outline, optional scale suggestion, interior walls, openings, and hand-marked fixture locations",
          input_schema: {
            type: "object",
            properties: {
              corners: {
                type: "array",
                description: "Ordered polygon of the room/house outline, normalized 0-1 image coordinates",
                items: {
                  type: "object",
                  properties: { x: { type: "number" }, y: { type: "number" } },
                  required: ["x", "y"],
                },
              },
              suggested_scale: {
                type: "object",
                description: "Only include if a dimension is legibly labelled on the plan spanning two of the reported corners",
                properties: {
                  corner_a_index: { type: "integer" },
                  corner_b_index: { type: "integer" },
                  real_distance_metres: { type: "number" },
                },
                required: ["corner_a_index", "corner_b_index", "real_distance_metres"],
              },
              interior_walls: {
                type: "array",
                description: "Internal partition walls, each its own independent line segment — empty array if there are none",
                items: {
                  type: "object",
                  properties: { x1: { type: "number" }, y1: { type: "number" }, x2: { type: "number" }, y2: { type: "number" } },
                  required: ["x1", "y1", "x2", "y2"],
                },
              },
              openings: {
                type: "array",
                description: "Doors/windows cut into any wall, each traced as the short segment spanning the gap — empty array if there are none",
                items: {
                  type: "object",
                  properties: {
                    x1: { type: "number" },
                    y1: { type: "number" },
                    x2: { type: "number" },
                    y2: { type: "number" },
                    kind: { type: "string", enum: ["door", "window"] },
                  },
                  required: ["x1", "y1", "x2", "y2", "kind"],
                },
              },
              marks: {
                type: "array",
                description: "Hand-marked fixture locations the tradie added themselves (highlighter/pen dots) — empty array if the plan has none",
                items: {
                  type: "object",
                  properties: {
                    x: { type: "number" },
                    y: { type: "number" },
                    color: { type: "string", enum: MARK_COLORS },
                  },
                  required: ["x", "y", "color"],
                },
              },
            },
            required: ["corners", "interior_walls", "openings", "marks"],
          },
        }],
        tool_choice: { type: "tool", name: "return_plan_extraction" },
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
            { type: "text", text: "Extract the wall outline, scale (if legibly labelled), interior walls, openings, and any hand-marked fixture locations from this plan." },
          ],
        }],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error("[extract-setout-plan] AI error:", aiRes.status, errText);
      return json({ error: "Extraction failed — please try again." }, 502);
    }

    const aiData = await aiRes.json();
    if (aiData.usage) {
      // Awaited (unlike the fire-and-forget style elsewhere) — there's
      // nothing else for this function to do afterward, so an unawaited
      // call here races the response being sent and the edge runtime
      // tearing the isolate down before the insert completes.
      // ref_id is a UUID column — pass the plan id (not storage_path, which
      // isn't a UUID and would fail the insert silently, since logTokenUsage
      // swallows its own errors).
      await logTokenUsage(supabase, {
        userId, kind: "setout_import", model: "claude-opus-4-8", refId: plan_id,
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
    if (!result || !Array.isArray(result.corners) || result.corners.length < 3) {
      return json({ error: "Could not make out a wall outline on that plan — try tracing it manually instead." }, 502);
    }

    return json({
      corners: result.corners,
      suggested_scale: result.suggested_scale ?? null,
      interior_walls: result.interior_walls ?? [],
      openings: result.openings ?? [],
      marks: result.marks ?? [],
    });
  } catch (e) {
    console.error("[extract-setout-plan] error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
