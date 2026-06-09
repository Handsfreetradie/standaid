/**
 * Feedback Buttons — Reference Component
 *
 * Drop this alongside your chat response display. Adapt styling to match
 * StandAid's existing UI (Tailwind, dark cinematic aesthetic, red #E3000F
 * reserved for AI elements).
 *
 * Usage in your chat component:
 *
 *   <ChatMessage response={aiResponse} />
 *   <FeedbackButtons queryId={aiResponse.queryId} />
 *
 * The queryId comes from the /query endpoint response (you'll need to add
 * it to the response — see 07-integration-notes.md).
 */

import { useState } from "react";
import { ThumbsUp, ThumbsDown, HelpCircle, Check } from "lucide-react";

interface FeedbackButtonsProps {
  queryId: string;
  onFeedbackSubmitted?: (rating: FeedbackRating) => void;
}

type FeedbackRating = "helpful" | "wrong" | "unclear";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export function FeedbackButtons({
  queryId,
  onFeedbackSubmitted,
}: FeedbackButtonsProps) {
  const [submitted, setSubmitted] = useState<FeedbackRating | null>(null);
  const [showCommentBox, setShowCommentBox] = useState(false);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submitFeedback(
    rating: FeedbackRating,
    userComment?: string
  ): Promise<void> {
    if (submitting) return;
    setSubmitting(true);

    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/feedback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          queryId,
          rating,
          userComment: userComment ?? undefined,
        }),
      });

      if (!response.ok) {
        throw new Error(`Feedback failed: ${response.status}`);
      }

      setSubmitted(rating);
      onFeedbackSubmitted?.(rating);
    } catch (err) {
      console.error("Failed to submit feedback:", err);
      // In production, show a non-intrusive toast
    } finally {
      setSubmitting(false);
    }
  }

  function handleQuickFeedback(rating: FeedbackRating): void {
    if (rating === "wrong" || rating === "unclear") {
      // Show comment box for negative feedback
      setShowCommentBox(true);
      // Don't submit yet — wait for optional comment
    } else {
      void submitFeedback(rating);
    }
  }

  function handleSubmitWithComment(rating: FeedbackRating): void {
    void submitFeedback(rating, comment.trim() || undefined);
    setShowCommentBox(false);
  }

  // Already submitted — show confirmation
  if (submitted) {
    return (
      <div className="flex items-center gap-2 mt-3 text-sm text-neutral-400">
        <Check size={14} />
        <span>Thanks — your feedback helps StandAid improve.</span>
      </div>
    );
  }

  // Comment box for negative feedback
  if (showCommentBox) {
    return (
      <div className="mt-3 space-y-2">
        <p className="text-sm text-neutral-400">
          What was wrong? (optional — helps us improve)
        </p>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={2000}
          placeholder="e.g. Wrong clause number, or didn't answer my question..."
          className="w-full bg-neutral-900 border border-neutral-800 rounded-md px-3 py-2 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-[#E3000F]"
          rows={3}
        />
        <div className="flex gap-2">
          <button
            onClick={() => handleSubmitWithComment("wrong")}
            disabled={submitting}
            className="px-3 py-1.5 bg-[#E3000F] text-white text-sm rounded-md hover:bg-[#C00010] disabled:opacity-50"
          >
            Submit
          </button>
          <button
            onClick={() => {
              setShowCommentBox(false);
              setComment("");
            }}
            className="px-3 py-1.5 text-sm text-neutral-400 hover:text-white"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // Default state — three buttons
  return (
    <div className="flex items-center gap-3 mt-3">
      <span className="text-xs text-neutral-500">Was this helpful?</span>
      <button
        onClick={() => handleQuickFeedback("helpful")}
        disabled={submitting}
        className="flex items-center gap-1 px-2 py-1 text-sm text-neutral-400 hover:text-green-500 transition-colors disabled:opacity-50"
        aria-label="Mark as helpful"
      >
        <ThumbsUp size={14} />
      </button>
      <button
        onClick={() => handleQuickFeedback("wrong")}
        disabled={submitting}
        className="flex items-center gap-1 px-2 py-1 text-sm text-neutral-400 hover:text-[#E3000F] transition-colors disabled:opacity-50"
        aria-label="Mark as wrong"
      >
        <ThumbsDown size={14} />
      </button>
      <button
        onClick={() => handleQuickFeedback("unclear")}
        disabled={submitting}
        className="flex items-center gap-1 px-2 py-1 text-sm text-neutral-400 hover:text-yellow-500 transition-colors disabled:opacity-50"
        aria-label="Mark as unclear"
      >
        <HelpCircle size={14} />
      </button>
    </div>
  );
}
