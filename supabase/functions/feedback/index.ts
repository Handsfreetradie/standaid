import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAllowedOrigin } from "../_shared/cors.ts";

type FeedbackRating = "helpful" | "wrong" | "unclear";

interface FeedbackRequestBody {
  queryId: string;
  rating: FeedbackRating;
  userComment?: string;
}

serve(async (req: Request) => {
  const origin = req.headers.get("Origin") || "";
  const corsHeaders = {
    "Access-Control-Allow-Origin": getAllowedOrigin(origin),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, corsHeaders);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Unauthorized" }, 401, corsHeaders);
    }
    const token = authHeader.replace("Bearer ", "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseKey) {
      return jsonResponse({ error: "Server configuration error" }, 500, corsHeaders);
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return jsonResponse({ error: "Unauthorized" }, 401, corsHeaders);
    }
    const userId = user.id;

    const body = (await req.json()) as FeedbackRequestBody;
    const validationError = validateFeedbackBody(body);
    if (validationError) return jsonResponse({ error: validationError }, 400, corsHeaders);

    // Verify the query being rated exists and belongs to this user — feedback
    // must not be attachable to another user's queries.
    const { data: logRow, error: logError } = await supabase
      .from("query_log")
      .select("query_text, user_id")
      .eq("id", body.queryId)
      .single();

    if (logError || !logRow || logRow.user_id !== userId) {
      return jsonResponse({ error: "Query not found" }, 404, corsHeaders);
    }

    const isNegative = (body.rating === "wrong" || body.rating === "unclear") && !!body.userComment;

    // For negative feedback with a comment, embed the original question so
    // similar future queries can receive this correction as context.
    let questionText: string | null = null;
    let questionEmbedding: number[] | null = null;

    if (isNegative) {
      questionText = logRow.query_text ?? null;

      if (questionText) {
        const openaiKey = Deno.env.get("OPENAI_API_KEY");
        if (openaiKey) {
          try {
            const embRes = await fetch("https://api.openai.com/v1/embeddings", {
              method: "POST",
              headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({ model: "text-embedding-3-small", input: questionText }),
            });
            if (embRes.ok) {
              const embData = await embRes.json();
              questionEmbedding = embData.data[0].embedding;
            }
          } catch (e) {
            // Non-fatal — feedback still saves without embedding
            console.error("[feedback] Embedding failed:", e);
          }
        }
      }
    }

    const { data, error } = await supabase
      .from("query_feedback")
      .insert({
        query_id: body.queryId,
        rating: body.rating,
        user_comment: body.userComment ?? null,
        user_id: userId,
        created_at: new Date().toISOString(),
        ...(questionText ? { question_text: questionText } : {}),
        ...(questionEmbedding ? { question_embedding: questionEmbedding } : {}),
      })
      .select("id")
      .single();

    if (error) {
      console.error("Failed to insert feedback:", error);
      return jsonResponse({ error: "Failed to save feedback" }, 500, corsHeaders);
    }

    return jsonResponse({ success: true, feedbackId: data.id }, 200, corsHeaders);
  } catch (err) {
    console.error("Feedback handler error:", err);
    return jsonResponse({ error: "Unexpected error processing feedback" }, 500, corsHeaders);
  }
});

function validateFeedbackBody(body: unknown): string | null {
  if (!body || typeof body !== "object") return "Request body is required";
  const b = body as Partial<FeedbackRequestBody>;
  if (!b.queryId || typeof b.queryId !== "string") return "queryId is required and must be a string";
  const validRatings: FeedbackRating[] = ["helpful", "wrong", "unclear"];
  if (!b.rating || !validRatings.includes(b.rating)) return `rating must be one of: ${validRatings.join(", ")}`;
  if (b.userComment && typeof b.userComment !== "string") return "userComment must be a string if provided";
  if (b.userComment && b.userComment.length > 2000) return "userComment must be 2000 characters or fewer";
  return null;
}

function jsonResponse(body: unknown, status: number, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
