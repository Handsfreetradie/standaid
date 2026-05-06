import { useState, useRef, useCallback } from "react";
import { Send, Camera, AlertTriangle, Lock, Zap, Shield, Mic, ThumbsUp, ThumbsDown, HelpCircle, Check } from "lucide-react";
import ReactMarkdown from "react-markdown";
import VoiceMode from "@/components/VoiceMode";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useData";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Citation {
  clause_number: string;
  standard_code: string;
  standard_version?: string;
  page_number?: number;
  relevant_text?: string;
  gated?: boolean;
}

type FeedbackRating = "helpful" | "wrong" | "unclear";

interface Message {
  id: string;
  role: "user" | "ai";
  content: string;
  isTyping?: boolean;
  citations?: Citation[];
  safety_critical?: boolean;
  safety_message?: string;
  confidence?: string;
  gated?: boolean;
  gated_message?: string;
  low_confidence?: boolean;
  answer_found?: boolean;
  follow_up_questions?: string[];
  accuracy_score?: number;
  accuracy_reason?: string;
  queryId?: string;
}

function FeedbackButtons({ queryId }: { queryId: string }) {
  const [submitted, setSubmitted] = useState<FeedbackRating | null>(null);
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(rating: FeedbackRating, userComment?: string) {
    if (submitting) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.functions.invoke("feedback", {
        body: { queryId, rating, userComment: userComment ?? undefined },
      });
      if (error) throw error;
      setSubmitted(rating);
    } catch (err) {
      console.error("Feedback error:", err);
    } finally {
      setSubmitting(false);
    }
  }

  function handleQuick(rating: FeedbackRating) {
    if (rating === "wrong" || rating === "unclear") {
      setShowComment(true);
    } else {
      void submit(rating);
    }
  }

  if (submitted) {
    return (
      <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
        <Check size={12} />
        <span>Thanks — helps StandAid improve.</span>
      </div>
    );
  }

  if (showComment) {
    return (
      <div className="mt-2 space-y-2">
        <p className="text-xs text-muted-foreground">What was wrong? (optional)</p>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={2000}
          placeholder="e.g. Wrong clause number..."
          className="w-full bg-background border border-border rounded-md px-3 py-2 text-xs text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary resize-none"
          rows={2}
        />
        <div className="flex gap-2">
          <button
            onClick={() => { void submit("wrong", comment.trim() || undefined); setShowComment(false); }}
            disabled={submitting}
            className="px-3 py-1 bg-destructive text-destructive-foreground text-xs rounded-md hover:opacity-90 disabled:opacity-50"
          >
            Submit
          </button>
          <button
            onClick={() => { setShowComment(false); setComment(""); }}
            className="px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 mt-2">
      <span className="text-xs text-muted-foreground">Helpful?</span>
      <button onClick={() => handleQuick("helpful")} disabled={submitting} className="text-muted-foreground hover:text-green-500 transition-colors disabled:opacity-50" aria-label="Helpful">
        <ThumbsUp size={13} />
      </button>
      <button onClick={() => handleQuick("wrong")} disabled={submitting} className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50" aria-label="Wrong">
        <ThumbsDown size={13} />
      </button>
      <button onClick={() => handleQuick("unclear")} disabled={submitting} className="text-muted-foreground hover:text-yellow-500 transition-colors disabled:opacity-50" aria-label="Unclear">
        <HelpCircle size={13} />
      </button>
    </div>
  );
}

const STARTER_QUESTIONS = [
  "What are the minimum cable burial depths?",
  "What protection is required for RCDs?",
  "What are the earthing requirements for a subboard?",
  "When is a safety switch required?",
];

const Chat = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const { session } = useAuth();
  const { data: profile } = useProfile();
  const scrollRef = useRef<HTMLDivElement>(null);

  const queriesRemaining = profile
    ? 5 - (profile.daily_query_count || 0)
    : 5;

  const scrollToBottom = () => {
    setTimeout(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }, 50);
  };

  const startTypewriter = (msgId: string, fullContent: string) => {
    let pos = 0;
    const tick = setInterval(() => {
      pos = Math.min(pos + 5, fullContent.length);
      const partial = fullContent.slice(0, pos);
      const done = pos >= fullContent.length;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId ? { ...m, content: partial, isTyping: !done } : m
        )
      );
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
      if (done) clearInterval(tick);
    }, 18);
  };

  const runQuery = async (question: string) => {
    if (!session) {
      toast.error("Please sign in to use the chat");
      return null;
    }

    const { data, error } = await supabase.functions.invoke("query", {
      body: { question },
    });

    if (error) throw new Error(error.message || "Query failed");

    if (data?.error) {
      if (data.upgrade_required) {
        return {
          id: crypto.randomUUID(),
          role: "ai" as const,
          content: data.message || data.error,
          gated: true,
          gated_message: data.message,
          isTyping: false,
        };
      }
      throw new Error(data.error);
    }

    return {
      id: crypto.randomUUID(),
      role: "ai" as const,
      content: "",
      isTyping: true,
      _full: data.answer || "No response generated.",
      citations: data.citations || [],
      safety_critical: data.safety_critical || false,
      safety_message: data.safety_message,
      confidence: data.confidence,
      gated: data.gated || false,
      gated_message: data.gated_message,
      low_confidence: data.low_confidence || false,
      answer_found: data.answer_found,
      follow_up_questions: data.follow_up_questions || [],
      accuracy_score: data.accuracy_score ?? null,
      accuracy_reason: data.accuracy_reason ?? null,
      queryId: data.queryId ?? null,
    };
  };

  const sendQuery = async (overrideText?: string) => {
    const question = (overrideText ?? input).trim();
    if (!question || isLoading) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: question,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const result = await runQuery(question);
      if (result) {
        const { _full, ...aiMessage } = result as any;
        setMessages((prev) => [...prev, aiMessage]);
        setIsLoading(false);
        scrollToBottom();
        if (_full) {
          startTypewriter(aiMessage.id, _full);
        }
        return;
      }
    } catch (e: any) {
      console.error("Query error:", e);
      toast.error(e.message || "Failed to send query");
    }
    setIsLoading(false);
    scrollToBottom();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendQuery();
    }
  };

  const handleVoiceQuery = useCallback(async (text: string): Promise<string | undefined> => {
    if (!text.trim() || !session) return undefined;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text.trim(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    try {
      const result = await runQuery(text.trim());
      if (result) {
        const { _full, ...aiMessage } = result as any;
        setMessages((prev) => [...prev, aiMessage]);
        setIsLoading(false);
        if (_full) startTypewriter(aiMessage.id, _full);
        return _full || aiMessage.content;
      }
    } catch (e: any) {
      console.error("Voice query error:", e);
      return "Sorry, I couldn't process that. Please try again.";
    }
    setIsLoading(false);
  }, [session]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <h1 className="font-sans text-lg font-bold text-foreground">
            Compliance Chat
          </h1>
        </div>
        {profile?.subscription_tier === "free" && (
          <p className="text-xs text-muted-foreground mt-0.5">
            {queriesRemaining > 0
              ? `${queriesRemaining} of 5 free queries remaining today`
              : "Daily limit reached — upgrade to Pro"}
          </p>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4 gap-5">
            <div>
              <Shield className="h-12 w-12 text-primary/30 mb-3 mx-auto" />
              <p className="text-sm font-semibold text-foreground mb-1">
                What do you need to know?
              </p>
              <p className="text-xs text-muted-foreground">
                Ask anything about your uploaded standards. I'll find the exact clause.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2 w-full max-w-sm">
              {STARTER_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => sendQuery(q)}
                  className="text-left text-xs text-primary bg-primary/8 hover:bg-primary/15 rounded-xl px-4 py-3 transition-colors font-medium"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={msg.role === "user" ? "flex justify-end" : "flex justify-start"}
          >
            {msg.role === "user" ? (
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-3">
                <p className="text-sm text-primary-foreground">{msg.content}</p>
              </div>
            ) : (
              <div className="max-w-[90%] space-y-2">
                <Card className="p-4 shadow-sm">
                  {/* Accuracy score — hide while typing */}
                  {!msg.isTyping && msg.accuracy_score != null && (
                    <div className="flex items-center gap-3 mb-3">
                      <div className="flex items-center gap-1.5">
                        <div className="flex gap-0.5">
                          {Array.from({ length: 10 }).map((_, i) => (
                            <div
                              key={i}
                              className={`h-1.5 w-3 rounded-full transition-colors ${
                                i < msg.accuracy_score!
                                  ? msg.accuracy_score! >= 8
                                    ? "bg-green-500"
                                    : msg.accuracy_score! >= 5
                                    ? "bg-yellow-500"
                                    : "bg-red-400"
                                  : "bg-muted"
                              }`}
                            />
                          ))}
                        </div>
                        <span className={`text-xs font-bold ${
                          msg.accuracy_score! >= 8 ? "text-green-600" : msg.accuracy_score! >= 5 ? "text-yellow-600" : "text-red-500"
                        }`}>
                          {msg.accuracy_score}/10
                        </span>
                      </div>
                      {msg.accuracy_reason && (
                        <p className="text-xs text-muted-foreground">{msg.accuracy_reason}</p>
                      )}
                    </div>
                  )}

                  {/* Answer — plain text + cursor while typing, markdown when done */}
                  <div className="text-sm text-card-foreground leading-relaxed prose prose-sm max-w-none prose-headings:text-foreground prose-p:text-card-foreground prose-strong:text-foreground prose-li:text-card-foreground">
                    {msg.isTyping ? (
                      <span>
                        {msg.content}
                        <span className="inline-block w-0.5 h-4 bg-primary ml-0.5 animate-pulse align-middle" />
                      </span>
                    ) : (
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    )}
                  </div>

                  {/* Clause badges */}
                  {!msg.isTyping && msg.citations && msg.citations.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {msg.citations.map((citation, idx) => (
                        <Badge
                          key={idx}
                          className={`border-0 text-xs font-semibold ${
                            citation.gated
                              ? "bg-muted text-muted-foreground"
                              : "bg-primary/10 text-primary"
                          }`}
                        >
                          {citation.gated ? "🔒 " : ""}
                          {citation.clause_number}
                          {citation.standard_code ? ` (${citation.standard_code})` : ""}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {/* Safety warning */}
                  {!msg.isTyping && msg.safety_critical && (
                    <div className="flex items-start gap-2 mt-3 rounded-lg bg-destructive/10 p-3">
                      <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-destructive font-medium">
                        {msg.safety_message ||
                          "Safety-critical work must be assessed and signed off by a licensed professional on-site."}
                      </p>
                    </div>
                  )}

                  {/* Gated content */}
                  {msg.gated && (
                    <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
                      <div className="flex items-start gap-2">
                        <Lock className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-xs font-semibold text-foreground">
                            {msg.gated_message ||
                              "You're on the right track — upgrade to Pro to get the full clause and complete guidance."}
                          </p>
                          <Button size="sm" className="mt-2 h-7 text-xs font-semibold gap-1">
                            <Zap className="h-3 w-3" />
                            Upgrade to Pro
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </Card>

                {/* Follow-up question chips */}
                {!msg.isTyping && msg.follow_up_questions && msg.follow_up_questions.length > 0 && (
                  <div className="flex flex-wrap gap-2 px-1">
                    {msg.follow_up_questions.map((q, idx) => (
                      <button
                        key={idx}
                        onClick={() => sendQuery(q)}
                        className="text-xs text-primary bg-primary/8 hover:bg-primary/15 rounded-full px-3 py-1.5 transition-colors font-medium"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                )}

                {/* Feedback buttons */}
                {!msg.isTyping && msg.queryId && (
                  <div className="px-1">
                    <FeedbackButtons queryId={msg.queryId} />
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <Card className="p-4 shadow-sm">
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  <span className="h-2 w-2 rounded-full bg-primary animate-bounce [animation-delay:0ms]" />
                  <span className="h-2 w-2 rounded-full bg-primary animate-bounce [animation-delay:150ms]" />
                  <span className="h-2 w-2 rounded-full bg-primary animate-bounce [animation-delay:300ms]" />
                </div>
                <p className="text-sm text-muted-foreground">Searching your standards...</p>
              </div>
            </Card>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-border px-4 pt-3 pb-2 bg-card">
        <div className="flex items-end gap-2">
          <Button
            size="icon"
            variant="ghost"
            className="h-10 w-10 flex-shrink-0 text-muted-foreground"
          >
            <Camera className="h-5 w-5" />
          </Button>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your standards..."
            className="min-h-[40px] max-h-[120px] resize-none text-sm"
            rows={1}
          />
          <Button
            size="icon"
            variant="outline"
            className="h-10 w-10 flex-shrink-0 text-primary"
            onClick={() => setVoiceMode(true)}
          >
            <Mic className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            className="h-10 w-10 flex-shrink-0"
            disabled={!input.trim() || isLoading}
            onClick={() => sendQuery()}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-center text-[10px] text-muted-foreground mt-2 pb-safe">
          Always verify AI answers against the original standard before relying on them on the job.
        </p>
      </div>

      {/* Voice Mode Overlay */}
      {voiceMode && (
        <VoiceMode
          onTranscript={handleVoiceQuery}
          isQuerying={isLoading}
          onClose={() => setVoiceMode(false)}
        />
      )}
    </div>
  );
};

export default Chat;
