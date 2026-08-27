import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAllowedOrigin } from "../_shared/cors.ts";
import { logTokenUsage } from "../_shared/log-usage.ts";

// Reads an uploaded builder's plan (rasterized PDF page or photo) and returns
// the wall outline plus any electrical symbols already drawn on it, all in
// normalized 0-1 image coordinates. Nothing is written to the DB here — the
// frontend owns turning this into walls/fittings (via polygonToWalls,
// computeMeasurementLock etc.) after the tradie confirms scale, same as
// every other Setout mutation is client-driven.

// Duplicated from src/components/setout/symbols/types.ts — Deno edge
// functions don't share a build with the frontend. Keep in sync if the
// FittingType union changes.
const FITTING_TYPES = [
  "downlight", "batten_holder", "wall_batten_holder", "wall_stair_light", "external_light",
  "heater_fan_light_2", "heater_fan_light_4", "junction_box", "ceiling_fan", "ceiling_fan_light",
  "para_flood", "round_fluoro", "fluoro_1200", "motion_sensor", "exhaust_fan", "exhaust_fan_light",
  "pendant", "switch", "gpo", "tv_point", "phone_point", "meter_box", "nbn_box", "ubo_rhood", "data",
  "smoke_detector", "heating_duct", "ducted_heating_unit", "heat_cool_duct", "rev_cycle_unit",
  "thermostat", "return_air", "evap_cooling_duct", "evap_cooling_unit", "ac_condenser",
  "ac_head_unit", "cooling_unit", "vacuum_unit", "vacuum_outlet",
];

const SYSTEM_PROMPT = `You are reading an Australian residential/commercial electrical or architectural floor plan (a builder's PDF page or a site photo of a plan) for a licensed electrician who will use your output to set out the job. Precision matters — the electrician measures from these positions on site.

TASK 1 — Wall outline: trace the outer perimeter of the room/house as an ordered polygon of corner points, walking the perimeter in one direction (clockwise or counterclockwise, either is fine as long as it's consistent). Use normalized image coordinates: x and y each range 0-1, where (0,0) is the top-left corner of the image and (1,1) is the bottom-right. Only trace what is clearly a wall line on the drawing — do not guess at a wall you can't actually see (e.g. because it's obscured or the plan is cropped).

TASK 2 — Scale: if a dimension is legibly labelled on the drawing spanning two of the corners you traced (e.g. "4200", "3.6m", "4200mm"), report which two corners it spans and the real-world length in metres. Only report this if you can actually read a number on the plan — never estimate or guess a scale from typical room sizes. If no legible dimension is visible, omit this field entirely.

TASK 3 — Internal walls: this plan may show internal partition walls dividing rooms (most real house/building plans do), or it may be a single room with no internal walls — both are normal. For every internal wall line you can actually see, report it as its own line segment (two endpoint points, same normalized 0-1 coordinates) — these don't need to connect into a closed shape like the outer perimeter does, each one is independent. Do not include the exterior perimeter walls here, only genuine internal partitions.

TASK 4 — Doors and windows: for every door and window opening you can see cut into ANY wall (exterior or internal), report it as its own short line segment spanning the gap in the wall (two endpoint points, same normalized 0-1 coordinates), plus whether it's a "door" or "window". A door is typically drawn as a gap in the wall with a quarter-circle swing arc; a window is typically a gap with a thin line or double-tick across it, sometimes with sill lines. Only report openings you can actually see — don't guess that a wall has a door just because a room needs one.

TASK 5 — Existing electrical symbols: this plan may already have electrical fittings marked on it (a switchboard-designer's plan, or a plan the electrician has already marked up), or it may have none at all — both are normal. For every electrical symbol you can actually see already drawn on the plan, report its position (same normalized 0-1 coordinates) and classify it into exactly one of these types:
${FITTING_TYPES.join(", ")}

Common AS/NZS-convention symbols to recognise: a downlight is usually a small circle with a cross or dot inside; a GPO (power point) is a circle with two short parallel marks; a switch is a small flick/tick mark on or near a wall line, sometimes with a letter subscript for multi-gang; a smoke detector is often a circle with "SD" or a distinctive hatched circle; an exhaust fan is a circle with an "X" or fan-blade hatching; a ceiling fan is a larger circle, sometimes with blade lines; a TV/data point is a circle with "TV" or "D" lettering.

Classification rules:
- Only report a symbol you can actually see drawn on the plan — never invent fittings, walls, doors, or windows that aren't there.
- If you can see a symbol clearly but aren't confident which of the listed types it is, still report its position but use type "unclassified" and set confidence to "low" rather than guessing a specific type. A wrong classification is worse than an honest "unclassified".
- Set confidence to "high" only when the symbol convention is unambiguous.

Call return_plan_extraction with your findings. Any of interior_walls, openings, or fittings can be an empty array if the plan genuinely has none — that's a normal, valid result.`;

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
          description: "Return the extracted wall outline, optional scale suggestion, and any existing electrical symbols",
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
              fittings: {
                type: "array",
                description: "Every existing electrical symbol already drawn on the plan — empty array if there are none",
                items: {
                  type: "object",
                  properties: {
                    x: { type: "number" },
                    y: { type: "number" },
                    type: { type: "string", enum: [...FITTING_TYPES, "unclassified"] },
                    confidence: { type: "string", enum: ["high", "medium", "low"] },
                  },
                  required: ["x", "y", "type", "confidence"],
                },
              },
            },
            required: ["corners", "interior_walls", "openings", "fittings"],
          },
        }],
        tool_choice: { type: "tool", name: "return_plan_extraction" },
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
            { type: "text", text: "Extract the wall outline, scale (if legibly labelled), and any existing electrical symbols from this plan." },
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
      fittings: result.fittings ?? [],
    });
  } catch (e) {
    console.error("[extract-setout-plan] error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
