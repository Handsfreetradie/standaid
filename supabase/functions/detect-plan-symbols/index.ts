import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Inlined from _shared/cors.ts and _shared/log-usage.ts — the MCP single-
// function deploy path doesn't resolve a `../_shared/...` relative import
// outside the function's own folder (only the standard `supabase functions
// deploy` CLI/CI path, which uploads the whole supabase/functions tree,
// does). Keep these two in sync with their _shared originals by hand if
// either changes.
const APP_URL = "https://app.standaid.ai";
const PRODUCTION_ORIGINS = [
  APP_URL,
  "https://standaid.com.au",
  "https://standaid.ai",
  "https://www.standaid.ai",
  "https://standaid.vercel.app",
  "https://standaid-9mas.vercel.app",
];
const ENV_ORIGINS = (Deno.env.get("ALLOWED_ORIGIN") || "").split(",").map((o: string) => o.trim()).filter(Boolean);
const ALLOWED_ORIGINS = [...new Set([...PRODUCTION_ORIGINS, ...ENV_ORIGINS])];
function getAllowedOrigin(origin: string): string {
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return origin;
  return ALLOWED_ORIGINS[0];
}

const PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "text-embedding-3-small": { input: 0.02, output: 0 },
};
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;
interface NormalizedUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens?: number;
  cache_creation_tokens?: number;
}
function estimateCostUsd(model: string, usage: NormalizedUsage): number {
  const price = PRICING[model];
  if (!price) return 0;
  const inputCost = (usage.input_tokens / 1_000_000) * price.input;
  const outputCost = (usage.output_tokens / 1_000_000) * price.output;
  const cacheWriteCost = ((usage.cache_creation_tokens ?? 0) / 1_000_000) * price.input * CACHE_WRITE_MULTIPLIER;
  const cacheReadCost = ((usage.cache_read_tokens ?? 0) / 1_000_000) * price.input * CACHE_READ_MULTIPLIER;
  return inputCost + outputCost + cacheWriteCost + cacheReadCost;
}
async function logTokenUsage(
  supabaseAdmin: SupabaseClient,
  params: { userId: string | null | undefined; kind: string; model: string; usage: NormalizedUsage; refId?: string },
): Promise<void> {
  try {
    const cost = estimateCostUsd(params.model, params.usage);
    const { error } = await supabaseAdmin.from("token_usage").insert({
      user_id: params.userId ?? null,
      kind: params.kind,
      model: params.model,
      input_tokens: params.usage.input_tokens,
      output_tokens: params.usage.output_tokens,
      cache_read_tokens: params.usage.cache_read_tokens ?? 0,
      cache_creation_tokens: params.usage.cache_creation_tokens ?? 0,
      estimated_cost_usd: cost,
      ref_id: params.refId ?? null,
    });
    if (error) console.error("[log-usage] insert failed:", error);
  } catch (e) {
    console.error("[log-usage] unexpected error:", e);
  }
}

// Reads the LEGEND on an uploaded plan that already has someone else's
// electrical symbols drawn on it, then (once the tradie has confirmed/fixed
// that reading) finds every place those symbols recur on the sheet. Nothing
// is written to the DB here — same split as extract-setout-plan: the
// frontend turns a confirmed result into real fittings (via
// snapToNearestWall/offsetSymbolIntoRoom/autoRotationForWallMount/
// computeMeasurementLock, same pipeline a manual tap already goes through)
// only after the tradie has looked at every row.
//
// Two separate calls rather than one "find everything" pass, on purpose: a
// misread legend entry would otherwise silently poison every instance of
// that symbol found later, and the legend is a short list (typically 5-15
// rows) that's cheap for the tradie to check before the more expensive
// whole-sheet search runs.
//
// This is a second attempt at something tried before (see extract-setout-
// plan's own header comment, and memory: "existing-symbol classification...
// proved unreliable"). Using the PLAN'S OWN legend as the reference, rather
// than a generic "universal AU symbols" model, is the thing that's actually
// different this time — symbol conventions vary a lot between drafters, so
// the one thing worth trusting on a given sheet is what that sheet's own
// legend says its own symbols mean. The underlying risk (a vision model
// misreading a real, messy, scanned plan) hasn't gone away, just been
// narrowed — hence the mandatory confirm-the-legend step before any search,
// and why nothing here ever auto-commits a fitting.

// Keep in sync with FITTING_LABELS in
// src/components/setout/symbols/fittingSymbolMap.ts — same manual-sync
// burden as MARK_COLORS above already carries in extract-setout-plan.
const FITTING_LABELS: Record<string, string> = {
  downlight: "Downlight",
  batten_holder: "Batten holder",
  wall_batten_holder: "Wall light",
  wall_stair_light: "Wall stair light",
  external_light: "External light point",
  heater_fan_light_2: "Heater/fan/light (2 globe)",
  heater_fan_light_4: "Heater/fan/light (4 globe)",
  junction_box: "Junction box",
  ceiling_fan: "Ceiling fan",
  ceiling_fan_light: "Ceiling fan with light",
  para_flood: "Para flood light",
  round_fluoro: "Round fluoro",
  fluoro_1200: "1200mm fluoro",
  motion_sensor: "Motion sensor",
  exhaust_fan: "Exhaust fan",
  exhaust_fan_light: "Exhaust fan with light",
  pendant: "Suspended pendant",
  led_strip: "LED strip",
  switch: "Light switch",
  cooktop_isolator: "Cooktop isolating switch",
  gpo: "GPO",
  gpo_switch_combo: "Double GPO + switch (25XA)",
  tv_point: "TV point",
  phone_point: "Telephone point",
  meter_box: "Meter box",
  nbn_box: "NBN box",
  ubo_rhood: "UBO/RHOOD connection",
  switchboard: "MSB",
  cooktop: "Cooktop",
  oven: "Oven",
  hot_water_unit: "Hot water system",
  spa_pool_heater: "Spa/pool heater",
  other_appliance: "Other appliance",
  solar_inverter: "Solar inverter",
  data: "Data outlet",
  data_cabinet: "Data cabinet",
  smoke_detector: "Smoke alarm",
  heating_duct: "Heating duct",
  ducted_heating_unit: "Ducted heating unit",
  heat_cool_duct: "Heat/cool duct",
  rev_cycle_unit: "Rev-cycle unit",
  thermostat: "Thermostat",
  return_air: "Return air",
  evap_cooling_duct: "Evap cooling duct",
  evap_cooling_unit: "Evap cooling unit",
  ac_condenser: "AC condenser",
  ac_head_unit: "AC head unit",
  cooling_unit: "Cooling unit",
  heated_towel_rail: "Heated towel rail",
  underfloor_heating_stat: "Underfloor heating stat",
  wifi_ap: "WiFi access point",
};
// "unknown" is a valid match too — forcing a pick from the real list on
// something genuinely unrecognisable would just invent a wrong answer.
const MATCH_TYPES = [...Object.keys(FITTING_LABELS), "unknown"];
const CONFIDENCES = ["high", "medium", "low"];

const FITTING_LIST_TEXT = Object.entries(FITTING_LABELS)
  .map(([type, label]) => `${type} — ${label}`)
  .join("\n");

const LEGEND_SYSTEM_PROMPT = `You are reading the LEGEND/symbol schedule on an Australian electrical or architectural floor plan, for a licensed electrician who will use your output to avoid re-drawing fixtures that are already on this plan.

Find the legend/symbol schedule on this sheet (it may be labelled "LEGEND", "SYMBOLS", "SCHEDULE", or similar — or have no heading at all, just a boxed list of symbol-to-meaning pairs). For each entry in it, match it to the single closest fitting type from this list:

${FITTING_LIST_TEXT}

If an entry genuinely doesn't match anything on the list, report "unknown" for it rather than forcing a wrong match — never invent a fitting type that isn't in the list above. Report your own confidence (high/medium/low) per entry — low confidence is a normal, honest answer when the drawing is unclear, not a failure.

If this plan has no legend at all, return an empty array — that's a normal, valid result.

Call return_legend with your findings.`;

const INSTANCES_SYSTEM_PROMPT = `You are searching an Australian electrical or architectural floor plan for every place a specific set of already-confirmed symbols appears, for a licensed electrician who will place real fittings at the positions you report — precision matters, they measure from these on site.

The tradie has already confirmed exactly what each of the following legend entries means (you read the legend correctly earlier — trust this mapping, don't re-interpret the symbols):

{{CONFIRMED_LEGEND}}

For each legend entry above, find every place its symbol appears elsewhere on this sheet (not inside the legend box itself). Report each instance's position in normalized image coordinates (x and y each range 0-1, where (0,0) is the top-left corner and (1,1) is the bottom-right), which legend entry it matched (by its exact label text as given above), and your confidence (high/medium/low) for that specific match. Only report a symbol you can actually see — never guess at one that might be obscured or assume a room "should" have one. If a legend entry has no visible instances anywhere on the sheet, that's fine — just don't report any for it.

Call return_instances with your findings — an empty array is a normal, valid result if nothing matched.`;

interface ConfirmedLegendEntry {
  legend_label: string;
  matched_type: string;
}

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

    // ── Setout add-on gate (mirrors extract-setout-plan / src/App.tsx's SetoutRoute) ──
    const { data: profile } = await supabase.from("profiles").select("has_setout_addon, trade_type").eq("user_id", userId).single();
    const trades = profile?.trade_type ? String(profile.trade_type).split(",").filter(Boolean) : [];
    if (!trades.includes("electrical") || !profile?.has_setout_addon) {
      return json({ error: "Rough-In Setout is a paid add-on for electrical trades." }, 403);
    }

    const { storage_path, content_type, plan_id, stage, confirmed_legend } = await req.json();
    if (!storage_path) return json({ error: "storage_path is required" }, 400);
    if (stage !== "legend" && stage !== "instances") return json({ error: "stage must be 'legend' or 'instances'" }, 400);
    if (stage === "instances" && (!Array.isArray(confirmed_legend) || confirmed_legend.length === 0)) {
      return json({ error: "confirmed_legend is required for the instances stage" }, 400);
    }
    // storage_path must be the caller's own folder — belt-and-braces on top
    // of the storage RLS policy, since we're downloading with the service
    // role key here (which bypasses RLS).
    if (!storage_path.startsWith(`${userId}/`)) return json({ error: "Unauthorized" }, 403);

    // ── Atomic rate limit — same shape as extract-setout-plan's, separate
    // kind so the two features don't share one cap ──
    const { data: used } = await supabase.rpc("check_and_record_ai_usage", {
      p_user_id: userId, p_kind: "setout_symbol_detect", p_max: 20, p_window_seconds: 3600,
    });
    if (typeof used === "number" && used < 0) {
      return json({ error: "Hourly limit reached — please try again later." }, 429);
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) return json({ error: "Service unavailable" }, 500);

    const { data: fileData, error: dlError } = await supabase.storage.from("setout-plan-uploads").download(storage_path);
    if (dlError || !fileData) return json({ error: "Could not load the uploaded plan" }, 500);
    const bytes = new Uint8Array(await fileData.arrayBuffer());
    let binary = "";
    const SLICE = 0x8000;
    for (let i = 0; i < bytes.length; i += SLICE) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + SLICE) as unknown as number[]);
    const imageBase64 = btoa(binary);
    const mediaType = content_type === "image/jpeg" ? "image/jpeg" : "image/png";

    const imageBlock = { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } };

    const request = stage === "legend"
      ? {
          model: "claude-sonnet-4-6",
          max_tokens: 2000,
          system: LEGEND_SYSTEM_PROMPT,
          tools: [{
            name: "return_legend",
            description: "Return the plan's legend entries matched to fitting types",
            input_schema: {
              type: "object",
              properties: {
                legend: {
                  type: "array",
                  description: "Empty array if the plan has no legend",
                  items: {
                    type: "object",
                    properties: {
                      legend_label: { type: "string", description: "The legend's own printed label/description for this symbol" },
                      matched_type: { type: "string", enum: MATCH_TYPES },
                      confidence: { type: "string", enum: CONFIDENCES },
                    },
                    required: ["legend_label", "matched_type", "confidence"],
                  },
                },
              },
              required: ["legend"],
            },
          }],
          tool_choice: { type: "tool", name: "return_legend" },
          messages: [{
            role: "user",
            content: [imageBlock, { type: "text", text: "Read this plan's legend and match each entry to a fitting type." }],
          }],
        }
      : {
          model: "claude-sonnet-4-6",
          max_tokens: 4000,
          system: INSTANCES_SYSTEM_PROMPT.replace(
            "{{CONFIRMED_LEGEND}}",
            (confirmed_legend as ConfirmedLegendEntry[])
              .map((e) => `- "${e.legend_label}" = ${FITTING_LABELS[e.matched_type] ?? e.matched_type}`)
              .join("\n"),
          ),
          tools: [{
            name: "return_instances",
            description: "Return every instance found of the confirmed legend symbols",
            input_schema: {
              type: "object",
              properties: {
                instances: {
                  type: "array",
                  description: "Empty array if none of the confirmed symbols appear anywhere on the sheet",
                  items: {
                    type: "object",
                    properties: {
                      x: { type: "number" },
                      y: { type: "number" },
                      legend_label: { type: "string", description: "Must exactly match one of the confirmed legend labels given" },
                      confidence: { type: "string", enum: CONFIDENCES },
                    },
                    required: ["x", "y", "legend_label", "confidence"],
                  },
                },
              },
              required: ["instances"],
            },
          }],
          tool_choice: { type: "tool", name: "return_instances" },
          messages: [{
            role: "user",
            content: [imageBlock, { type: "text", text: "Find every instance of the confirmed legend symbols on this sheet." }],
          }],
        };

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "Content-Type": "application/json", "anthropic-version": "2023-06-01" },
      body: JSON.stringify(request),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error("[detect-plan-symbols] AI error:", aiRes.status, errText);
      return json({ error: "Detection failed — please try again." }, 502);
    }

    const aiData = await aiRes.json();
    if (aiData.usage) {
      // Awaited, same reasoning as extract-setout-plan: nothing else for
      // this function to do afterward, so an unawaited call here would
      // race the edge runtime tearing the isolate down.
      await logTokenUsage(supabase, {
        userId, kind: "setout_symbol_detect", model: "claude-sonnet-4-6", refId: plan_id,
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

    if (stage === "legend") {
      if (!result || !Array.isArray(result.legend)) {
        return json({ error: "Could not read that plan — try again, or skip and add fittings manually." }, 502);
      }
      return json({ legend: result.legend });
    }

    if (!result || !Array.isArray(result.instances)) {
      return json({ error: "Could not search that plan — try again, or skip and add fittings manually." }, 502);
    }
    return json({ instances: result.instances });
  } catch (e) {
    console.error("[detect-plan-symbols] error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
