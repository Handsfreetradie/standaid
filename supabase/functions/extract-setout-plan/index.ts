import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
import { getAllowedOrigin } from "../_shared/cors.ts";
import { logTokenUsage } from "../_shared/log-usage.ts";

// Reads an uploaded builder's plan (rasterized PDF page or photo) and returns
// the wall outline plus any hand-marked fixture locations on it, all in
// normalized 0-1 image coordinates. Nothing is written to the DB here — the
// frontend owns turning this into walls/fittings (via polygonToWalls,
// computeMeasurementLock etc.) after the tradie confirms scale, same as
// every other Setout mutation is client-driven.
//
// Existing-symbol classification (what's this circle-with-a-cross?) proved
// unreliable in two earlier attempts — see MARK_COLORS below, which
// replaces that entirely with tradie-applied colour marking instead.
// Interior walls/openings don't have that classification-ambiguity problem
// (a wall is unambiguously a wall regardless of how much context is
// visible), but DO suffer the same "too many precise coordinates in one
// pass" precision loss a dense real plan can have 15-20+ wall/opening
// segments. So this task is tiled (Pass 2, below) while corners/scale/marks
// stay a single whole-image pass (Pass 1) — they're already reliable at
// their point-counts.

const MARK_COLORS = ["red", "orange", "yellow", "green", "blue", "purple", "pink", "black"];

const GEOMETRY_SYSTEM_PROMPT = `You are reading an Australian residential/commercial electrical or architectural floor plan (a builder's PDF page or a site photo of a plan) for a licensed electrician who will use your output to set out the job. Precision matters — the electrician measures from these positions on site.

TASK 1 — Wall outline: trace the outer perimeter of the room/house as an ordered polygon of corner points, walking the perimeter in one direction (clockwise or counterclockwise, either is fine as long as it's consistent). Use normalized image coordinates: x and y each range 0-1, where (0,0) is the top-left corner of the image and (1,1) is the bottom-right. Only trace what is clearly a wall line on the drawing — do not guess at a wall you can't actually see (e.g. because it's obscured or the plan is cropped).

TASK 2 — Scale: if a dimension is legibly labelled on the drawing spanning two of the corners you traced (e.g. "4200", "3.6m", "4200mm"), report which two corners it spans and the real-world length in metres. Only report this if you can actually read a number on the plan — never estimate or guess a scale from typical room sizes. If no legible dimension is visible, omit this field entirely.

TASK 3 — Hand-marked fixture locations: the tradie may have marked up this plan themselves with a highlighter or pen to indicate where electrical fixtures go — bright, hand-drawn dots/circles/ticks that are clearly NOT part of the plan's own printed drawing (which is black/grey/blue CAD linework). Completely ignore the plan's own printed electrical symbols, room labels, and dimension marks for this task — only report the tradie's own added marks. For each hand-mark found, report its position (same normalized 0-1 coordinates) and its colour, picked from exactly this list: ${MARK_COLORS.join(", ")}. Pick whichever colour in the list is the closest match — don't invent a colour name outside this list. If the plan has no hand-marks on it at all, that's a normal, valid result — return an empty array.

Never invent a wall or mark that isn't actually visible. Call return_geometry with your findings — marks can be an empty array if the plan has none.`;

function wallTileSystemPrompt(): string {
  return `You are reading a cropped region of a larger Australian residential/commercial electrical or architectural floor plan. Precision matters — an electrician measures from these positions on site.

TASK — Internal walls: for every internal partition wall line clearly visible within THIS cropped image, report it as its own line segment (two endpoints), normalized 0-1 coordinates relative to THIS crop (where (0,0) is this crop's top-left and (1,1) is its bottom-right) — not the full plan. These don't need to connect into a closed shape, each is independent. Do not report the exterior perimeter wall lines, only genuine internal partitions. If a wall continues beyond this crop's edge, still report the portion of it that's visible here — a wall doesn't need to be fully contained in this crop to be reported.

TASK — Doors and windows: for every door/window opening visible within this crop, cut into ANY wall (exterior or internal), report it the same way — a short segment spanning the gap in the wall, plus whether it's a "door" or "window". A door is typically a gap with a quarter-circle swing arc; a window is typically a gap with a thin line or double-tick across it. Only report openings you can actually see.

This image is one of several overlapping crops from the same plan — it's fine, expected even, for something visible here to also appear in a neighbouring crop; duplicates are merged afterward, so report anything genuinely visible in this crop rather than trying to guess whether it "belongs" here.

Never invent a wall or opening that isn't actually visible. Call return_wall_tile with your findings — interior_walls and openings can both be empty arrays if this crop shows neither.`;
}

interface ClaudeToolCallParams {
  apiKey: string;
  maxTokens: number;
  system: string;
  toolName: string;
  toolDescription: string;
  schema: Record<string, unknown>;
  imageBase64: string;
  mediaType: string;
  userText: string;
}

async function callClaudeTool(params: ClaudeToolCallParams): Promise<{ result: any; usage: any } | { error: string }> {
  const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": params.apiKey, "Content-Type": "application/json", "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-opus-4-8",
      max_tokens: params.maxTokens,
      system: params.system,
      tools: [{ name: params.toolName, description: params.toolDescription, input_schema: params.schema }],
      tool_choice: { type: "tool", name: params.toolName },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: params.mediaType, data: params.imageBase64 } },
          { type: "text", text: params.userText },
        ],
      }],
    }),
  });
  if (!aiRes.ok) {
    const errText = await aiRes.text();
    console.error(`[extract-setout-plan] AI error (${params.toolName}):`, aiRes.status, errText);
    return { error: "AI call failed" };
  }
  const aiData = await aiRes.json();
  const block = aiData.content?.find?.((b: any) => b.type === "tool_use");
  return { result: block?.input, usage: aiData.usage };
}

interface TileBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// 2x2 grid, each tile covering 60% of the image with a 20% overlap band on
// every shared edge — the same grid used (and proven workable to compute
// and crop) in the earlier fitting-tiling attempt, just applied to a task
// where tiling should actually help instead of hurt.
const WALL_TILES: TileBounds[] = [
  { x0: 0, y0: 0, x1: 0.6, y1: 0.6 },
  { x0: 0.4, y0: 0, x1: 1, y1: 0.6 },
  { x0: 0, y0: 0.4, x1: 0.6, y1: 1 },
  { x0: 0.4, y0: 0.4, x1: 1, y1: 1 },
];

interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
interface OpeningSegment extends Segment {
  kind: "door" | "window";
}

const SEGMENT_DEDUPE_THRESHOLD = 0.02; // ~2% of image span

function segmentsNearlyMatch(a: Segment, b: Segment): boolean {
  const d = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);
  const sameOrder = d(a.x1, a.y1, b.x1, b.y1) < SEGMENT_DEDUPE_THRESHOLD && d(a.x2, a.y2, b.x2, b.y2) < SEGMENT_DEDUPE_THRESHOLD;
  const reversed = d(a.x1, a.y1, b.x2, b.y2) < SEGMENT_DEDUPE_THRESHOLD && d(a.x2, a.y2, b.x1, b.y1) < SEGMENT_DEDUPE_THRESHOLD;
  return sameOrder || reversed;
}

// Overlapping tiles commonly detect the exact same short wall/opening twice
// (both endpoints land very close once remapped to full-image coordinates)
// — collapse those. A wall long enough to genuinely span a tile boundary
// isn't stitched back together here (that's a harder problem — matching
// partial, non-identical segments) and instead lands as two collinear
// segments, an acceptable minor imperfection fixable with the existing
// "Add interior wall" tool if it looks wrong.
function dedupeSegments<T extends Segment>(segments: T[], sameKind: (a: T, b: T) => boolean = () => true): T[] {
  const accepted: T[] = [];
  for (const s of segments) {
    if (!accepted.some((a) => sameKind(a, s) && segmentsNearlyMatch(a, s))) accepted.push(s);
  }
  return accepted;
}

function remapSegment<T extends Segment>(seg: T, bounds: TileBounds): T {
  return {
    ...seg,
    x1: bounds.x0 + seg.x1 * (bounds.x1 - bounds.x0),
    y1: bounds.y0 + seg.y1 * (bounds.y1 - bounds.y0),
    x2: bounds.x0 + seg.x2 * (bounds.x1 - bounds.x0),
    y2: bounds.y0 + seg.y2 * (bounds.y1 - bounds.y0),
  };
}

const SEGMENT_SCHEMA = { type: "object", properties: { x1: { type: "number" }, y1: { type: "number" }, x2: { type: "number" }, y2: { type: "number" } }, required: ["x1", "y1", "x2", "y2"] };

const WALL_TILE_SCHEMA = {
  type: "object",
  properties: {
    interior_walls: {
      type: "array",
      description: "Internal partition walls visible in this crop — empty array if none",
      items: SEGMENT_SCHEMA,
    },
    openings: {
      type: "array",
      description: "Doors/windows visible in this crop — empty array if none",
      items: {
        type: "object",
        properties: { ...SEGMENT_SCHEMA.properties, kind: { type: "string", enum: ["door", "window"] } },
        required: [...SEGMENT_SCHEMA.required, "kind"],
      },
    },
  },
  required: ["interior_walls", "openings"],
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

    // ── Setout add-on gate (mirrors src/App.tsx's SetoutRoute) ──
    const { data: profile } = await supabase.from("profiles").select("has_setout_addon, trade_type").eq("user_id", userId).single();
    const trades = profile?.trade_type ? String(profile.trade_type).split(",").filter(Boolean) : [];
    if (!trades.includes("electrical") || !profile?.has_setout_addon) {
      return json({ error: "Rough-In Setout is a paid add-on for electrical trades." }, 403);
    }

    // ── Atomic rate limit — one check per extraction REQUEST, even though
    // it fans out into 5 AI calls internally ──
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
    const toBase64 = (b: Uint8Array) => {
      let binary = "";
      const SLICE = 0x8000;
      for (let i = 0; i < b.length; i += SLICE) binary += String.fromCharCode.apply(null, b.subarray(i, i + SLICE) as unknown as number[]);
      return btoa(binary);
    };
    const mediaType = content_type === "image/jpeg" ? "image/jpeg" : "image/png";
    const fullImageBase64 = toBase64(bytes);

    // ── Pass 1: corners, scale, hand-marks (whole image — few enough
    // points at this task that a single pass holds up) ──
    const geometryCall = callClaudeTool({
      apiKey: ANTHROPIC_API_KEY,
      maxTokens: 3000,
      system: GEOMETRY_SYSTEM_PROMPT,
      toolName: "return_geometry",
      toolDescription: "Return the wall outline, optional scale suggestion, and hand-marked fixture locations",
      schema: {
        type: "object",
        properties: {
          corners: {
            type: "array",
            description: "Ordered polygon of the room/house outline, normalized 0-1 image coordinates",
            items: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"] },
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
          marks: {
            type: "array",
            description: "Hand-marked fixture locations the tradie added themselves — empty array if none",
            items: {
              type: "object",
              properties: { x: { type: "number" }, y: { type: "number" }, color: { type: "string", enum: MARK_COLORS } },
              required: ["x", "y", "color"],
            },
          },
        },
        required: ["corners", "marks"],
      },
      imageBase64: fullImageBase64,
      mediaType,
      userText: "Extract the wall outline, scale (if legibly labelled), and any hand-marked fixture locations from this plan.",
    });

    // ── Pass 2: interior walls + openings, tiled — crop into 4 overlapping
    // regions and run each as its own smaller, less-cluttered detection.
    // Each tile decodes its own fresh Image instance from the source bytes
    // rather than cropping a shared decoded instance 4 times — avoids
    // depending on crop() being non-mutating/cloneable, not worth assuming
    // without being able to check the library's docs; decoding a small PNG
    // 4 times instead of once is a negligible cost either way. ──
    const tileCalls = WALL_TILES.map(async (bounds) => {
      const tileSource = await Image.decode(bytes);
      const px0 = Math.round(bounds.x0 * tileSource.width);
      const py0 = Math.round(bounds.y0 * tileSource.height);
      const pw = Math.round((bounds.x1 - bounds.x0) * tileSource.width);
      const ph = Math.round((bounds.y1 - bounds.y0) * tileSource.height);
      const tileImage = tileSource.crop(px0, py0, pw, ph);
      const tileBytes = await tileImage.encode();
      const call = await callClaudeTool({
        apiKey: ANTHROPIC_API_KEY,
        maxTokens: 2000,
        system: wallTileSystemPrompt(),
        toolName: "return_wall_tile",
        toolDescription: "Return internal walls and openings visible in this cropped region",
        schema: WALL_TILE_SCHEMA,
        imageBase64: toBase64(tileBytes),
        mediaType: "image/png",
        userText: "List every internal wall and door/window opening visible in this cropped region of the plan.",
      });
      return { bounds, call };
    });

    const [geometryOutcome, ...tileOutcomes] = await Promise.all([geometryCall, ...tileCalls]);

    // Log cost per call — separate kinds so the geometry/wall-tile cost
    // split stays visible in token_usage, same multi-kind-per-feature
    // pattern analyze-audit-photo already uses for its own sub-calls.
    // Awaited (not fire-and-forget) — nothing else happens after this, so
    // an unawaited insert would race the response being sent and the edge
    // runtime tearing the isolate down before it completes.
    const logCalls: Promise<void>[] = [];
    if ("usage" in geometryOutcome && geometryOutcome.usage) {
      logCalls.push(logTokenUsage(supabase, {
        userId, kind: "setout_import_geometry", model: "claude-opus-4-8", refId: plan_id,
        usage: {
          input_tokens: geometryOutcome.usage.input_tokens ?? 0,
          output_tokens: geometryOutcome.usage.output_tokens ?? 0,
          cache_read_tokens: geometryOutcome.usage.cache_read_input_tokens ?? 0,
          cache_creation_tokens: geometryOutcome.usage.cache_creation_input_tokens ?? 0,
        },
      }));
    }
    for (const { call } of tileOutcomes) {
      if ("usage" in call && call.usage) {
        logCalls.push(logTokenUsage(supabase, {
          userId, kind: "setout_import_walls", model: "claude-opus-4-8", refId: plan_id,
          usage: {
            input_tokens: call.usage.input_tokens ?? 0,
            output_tokens: call.usage.output_tokens ?? 0,
            cache_read_tokens: call.usage.cache_read_input_tokens ?? 0,
            cache_creation_tokens: call.usage.cache_creation_input_tokens ?? 0,
          },
        }));
      }
    }
    await Promise.all(logCalls);

    const geometryResult = "result" in geometryOutcome ? geometryOutcome.result : null;
    if (!geometryResult || !Array.isArray(geometryResult.corners) || geometryResult.corners.length < 3) {
      return json({ error: "Could not make out a wall outline on that plan — try tracing it manually instead." }, 502);
    }

    // Remap each tile's segments back to full-image normalized coordinates,
    // then dedupe overlapping detections.
    const remappedWalls: Segment[] = [];
    const remappedOpenings: OpeningSegment[] = [];
    for (const { bounds, call } of tileOutcomes) {
      if (!("result" in call) || !call.result) continue;
      for (const seg of (call.result.interior_walls ?? []) as Segment[]) remappedWalls.push(remapSegment(seg, bounds));
      for (const seg of (call.result.openings ?? []) as OpeningSegment[]) remappedOpenings.push(remapSegment(seg, bounds));
    }
    const interiorWalls = dedupeSegments(remappedWalls);
    const openings = dedupeSegments(remappedOpenings, (a, b) => a.kind === b.kind);

    return json({
      corners: geometryResult.corners,
      suggested_scale: geometryResult.suggested_scale ?? null,
      interior_walls: interiorWalls,
      openings,
      marks: geometryResult.marks ?? [],
    });
  } catch (e) {
    console.error("[extract-setout-plan] error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
