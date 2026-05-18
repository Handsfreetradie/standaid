import { useState, useRef, useCallback, useEffect } from "react";
import { Send, Camera, AlertTriangle, Lock, Zap, Shield, Mic, ThumbsUp, ThumbsDown, HelpCircle, Check } from "lucide-react";
import ReactMarkdown from "react-markdown";
import VoiceMode from "@/components/VoiceMode";
import { PDFViewerModal } from "@/components/PDFViewerModal";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useData";
import { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Citation {
  clause_number: string;
  standard_code: string;
  standard_version?: string;
  page_number?: number;
  relevant_text?: string;
  gated?: boolean;
}

interface ImageRef {
  figure_number?: string;
  table_number?: string;
  caption?: string;
  standard_code?: string;
  page_number?: number;
  image_url?: string;
}

type FeedbackRating = "helpful" | "wrong" | "unclear";

interface Message {
  id: string;
  role: "user" | "ai";
  content: string;
  isTyping?: boolean;
  citations?: Citation[];
  figures_referenced?: ImageRef[];
  tables_referenced?: ImageRef[];
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
  const [pdfViewer, setPdfViewer] = useState<{ clauseNumber: string; standardCode: string } | null>(null);
  const { session } = useAuth();
  const { data: profile } = useProfile();
  const scrollRef = useRef<HTMLDivElement>(null);

  const queriesRemaining = profile
    ? 5 - (profile.daily_query_count || 0)
    : 5;

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, isLoading, scrollToBottom]);

  const runQuery = async (question: string): Promise<string | undefined> => {
    if (!session) {
      toast.error("Please sign in to use the chat");
      return undefined;
    }

    const history = messages
      .filter((m) => !m.isTyping && m.content)
      .slice(-6)
      .map((m) => ({ role: m.role === "ai" ? "assistant" : "user", content: m.content }));

    // Add AI placeholder immediately — user sees typing cursor straight away
    const aiMsgId = crypto.randomUUID();
    setMessages((prev) => [...prev, { id: aiMsgId, role: "ai" as const, content: "", isTyping: true }]);
    scrollToBottom();

    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/query`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
          "apikey": SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ question, conversation_history: history }),
      });

      if (!response.ok || !response.body) {
        const err = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        setMessages((prev) => prev.map((m) =>
          m.id === aiMsgId ? { ...m, content: err.error || "Request failed", isTyping: false } : m
        ));
        return undefined;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = "";
      let streamedAnswer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split("\n");
        sseBuffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (!data) continue;

          try {
            const event = JSON.parse(data);

            if (event.error) {
              setMessages((prev) => prev.map((m) =>
                m.id === aiMsgId ? { ...m, content: event.error, isTyping: false } : m
              ));
              return undefined;
            }

            if (event.token !== undefined) {
              streamedAnswer += event.token;
              setMessages((prev) => prev.map((m) =>
                m.id === aiMsgId ? { ...m, content: streamedAnswer } : m
              ));
              if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            }

            if (event.done) {
              const finalAnswer = event.answer || streamedAnswer;
              setMessages((prev) => prev.map((m) =>
                m.id === aiMsgId ? {
                  ...m,
                  content: finalAnswer,
                  isTyping: false,
                  citations: event.citations || [],
                  figures_referenced: (event.figures_referenced || []).filter((f: ImageRef) => f.image_url),
                  tables_referenced: (event.tables_referenced || []).filter((t: ImageRef) => t.image_url),
                  safety_critical: event.safety_critical || false,
                  safety_message: event.safety_message,
                  confidence: event.confidence,
                  gated: event.gated || false,
                  gated_message: event.gated_message,
                  low_confidence: event.low_confidence || false,
                  answer_found: event.answer_found,
                  follow_up_questions: event.follow_up_questions || [],
                  queryId: event.queryId || null,
                } : m
              ));
              scrollToBottom();
              return finalAnswer;
            }
          } catch { /* ignore incomplete JSON lines */ }
        }
      }
    } catch (e: any) {
      console.error("Stream error:", e);
      setMessages((prev) => prev.map((m) =>
        m.id === aiMsgId ? { ...m, content: "Sorry, something went wrong. Please try again.", isTyping: false } : m
      ));
    }
    return undefined;
  };

  const sendQuery = async (overrideText?: string) => {
    const question = (overrideText ?? input).trim();
    if (!question || isLoading) return;

    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user" as const, content: question }]);
    setInput("");
    setIsLoading(true);

    try {
      await runQuery(question);
    } catch (e: any) {
      console.error("Query error:", e);
    } finally {
      setIsLoading(false);
      scrollToBottom();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendQuery();
    }
  };

  const handleVoiceQuery = useCallback(async (text: string): Promise<string | undefined> => {
    if (!text.trim() || !session) return undefined;

    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user" as const, content: text.trim() }]);
    setIsLoading(true);

    try {
      return await runQuery(text.trim());
    } catch (e: any) {
      console.error("Voice query error:", e);
      return "Sorry, I couldn't process that. Please try again.";
    } finally {
      setIsLoading(false);
    }
  }, [session]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Query count for free tier */}
      {profile?.subscription_tier === "free" && (
        <div className="px-5 py-1.5 border-b border-border bg-muted/30">
          <p className="text-xs text-muted-foreground text-center">
            {queriesRemaining > 0
              ? `${queriesRemaining} of 5 free queries remaining today`
              : "Daily limit reached — upgrade to Pro"}
          </p>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col">
        {messages.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-4 gap-5">
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

        <div className="space-y-4">
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

                  {/* Answer — markdown rendered during and after typing */}
                  <div className="text-sm text-card-foreground leading-relaxed prose prose-sm max-w-none prose-headings:text-foreground prose-p:text-card-foreground prose-strong:text-foreground prose-li:text-card-foreground">
                    <ReactMarkdown>{msg.content || " "}</ReactMarkdown>
                    {msg.isTyping && (
                      <span className="inline-block w-0.5 h-4 bg-primary ml-0.5 animate-pulse align-middle" />
                    )}
                  </div>

                  {/* Clause badges */}
                  {!msg.isTyping && msg.citations && msg.citations.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {msg.citations.map((citation, idx) =>
                        citation.gated ? (
                          <Badge
                            key={idx}
                            className="border-0 text-xs font-semibold bg-muted text-muted-foreground"
                          >
                            🔒 {citation.clause_number}
                            {citation.standard_code ? ` (${citation.standard_code})` : ""}
                          </Badge>
                        ) : (
                          <button
                            key={idx}
                            onClick={() => setPdfViewer({ clauseNumber: citation.clause_number, standardCode: citation.standard_code })}
                            className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-primary/10 text-primary hover:bg-primary/20 active:scale-95 transition-all"
                          >
                            {citation.clause_number}
                            {citation.standard_code ? ` (${citation.standard_code})` : ""}
                          </button>
                        )
                      )}
                    </div>
                  )}

                  {/* Figure images */}
                  {!msg.isTyping && msg.figures_referenced && msg.figures_referenced.length > 0 && (
                    <div className="mt-3 space-y-3">
                      {msg.figures_referenced.map((fig, idx) => (
                        <div key={idx} className="rounded-lg overflow-hidden border border-border">
                          <img
                            src={fig.image_url}
                            alt={fig.caption || `Figure ${fig.figure_number}`}
                            className="w-full h-auto"
                            loading="lazy"
                          />
                          {(fig.caption || fig.figure_number) && (
                            <p className="text-[10px] text-muted-foreground px-3 py-1.5 bg-muted/30">
                              Figure {fig.figure_number}{fig.caption ? ` — ${fig.caption}` : ""}{fig.standard_code ? ` (${fig.standard_code})` : ""}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Table images */}
                  {!msg.isTyping && msg.tables_referenced && msg.tables_referenced.length > 0 && (
                    <div className="mt-3 space-y-3">
                      {msg.tables_referenced.map((tbl, idx) => (
                        <div key={idx} className="rounded-lg overflow-hidden border border-border">
                          <img
                            src={tbl.image_url}
                            alt={tbl.caption || `Table ${tbl.table_number}`}
                            className="w-full h-auto"
                            loading="lazy"
                          />
                          {(tbl.caption || tbl.table_number) && (
                            <p className="text-[10px] text-muted-foreground px-3 py-1.5 bg-muted/30">
                              Table {tbl.table_number}{tbl.caption ? ` — ${tbl.caption}` : ""}{tbl.standard_code ? ` (${tbl.standard_code})` : ""}
                            </p>
                          )}
                        </div>
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
        </div>

        {isLoading && !messages.some(m => m.isTyping) && (
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

      {/* Input — chat-input-wrapper class is locked in index.css, do not remove */}
      <div className="chat-input-wrapper flex-shrink-0 border-t border-border px-4 pt-3 bg-card">
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
        <p className="chat-disclaimer text-center text-[10px] text-muted-foreground">
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

      {/* PDF Clause Viewer */}
      {pdfViewer && (
        <PDFViewerModal
          isOpen={!!pdfViewer}
          onClose={() => setPdfViewer(null)}
          clauseNumber={pdfViewer.clauseNumber}
          standardCode={pdfViewer.standardCode}
        />
      )}
    </div>
  );
};

export default Chat;
