/**
 * Feedback Edge Function
 *
 * Location: supabase/functions/feedback/index.ts (NEW FILE)
 *
 * Captures user feedback on AI responses so we can:
 *   1. Track accuracy over time
 *   2. Identify bad responses for manual review
 *   3. Build a training dataset for future fine-tuning
 *
 * API:
 *   POST /functions/v1/feedback
 *   Body:
 *     {
 *       queryId: string,          // ID of the original query (from query endpoint)
 *       rating: "helpful" | "wrong" | "unclear",
 *       userComment?: string,     // optional free-text feedback
 *       userId?: string           // optional — if authenticated
 *     }
 *   Response:
 *     { success: true, feedbackId: string }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ──────────────────────────────────────────────────────────────────────────
// CORS — Match your existing query/index.ts CORS setup
// ──────────────────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

type FeedbackRating = "helpful" | "wrong" | "unclear";

interface FeedbackRequestBody {
  queryId: string;
  rating: FeedbackRating;
  userComment?: string;
  userId?: string;
}

// ──────────────────────────────────────────────────────────────────────────
// Handler
// ──────────────────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    // Parse body
    const body = (await req.json()) as FeedbackRequestBody;

    // Validate
    const validationError = validateFeedbackBody(body);
    if (validationError) {
      return jsonResponse({ error: validationError }, 400);
    }

    // Get Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      console.error("Missing Supabase environment variables");
      return jsonResponse({ error: "Server configuration error" }, 500);
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Insert feedback
    const { data, error } = await supabase
      .from("query_feedback")
      .insert({
        query_id: body.queryId,
        rating: body.rating,
        user_comment: body.userComment ?? null,
        user_id: body.userId ?? null,
        created_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) {
      console.error("Failed to insert feedback:", error);
      return jsonResponse({ error: "Failed to save feedback" }, 500);
    }

    return jsonResponse({
      success: true,
      feedbackId: data.id,
    });
  } catch (err) {
    console.error("Feedback handler error:", err);
    return jsonResponse(
      { error: "Unexpected error processing feedback" },
      500
    );
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function validateFeedbackBody(body: unknown): string | null {
  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  const b = body as Partial<FeedbackRequestBody>;

  if (!b.queryId || typeof b.queryId !== "string") {
    return "queryId is required and must be a string";
  }

  const validRatings: FeedbackRating[] = ["helpful", "wrong", "unclear"];
  if (!b.rating || !validRatings.includes(b.rating)) {
    return `rating must be one of: ${validRatings.join(", ")}`;
  }

  if (b.userComment && typeof b.userComment !== "string") {
    return "userComment must be a string if provided";
  }

  if (b.userComment && b.userComment.length > 2000) {
    return "userComment must be 2000 characters or fewer";
  }

  return null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
