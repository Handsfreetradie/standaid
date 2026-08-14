import { useState, useRef, useCallback, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Send, Camera, AlertTriangle, Lock, Zap, Shield, Mic, ThumbsUp, ThumbsDown, HelpCircle, Check, FileText, History, X, ExternalLink, ShoppingCart } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import VoiceMode from "@/components/VoiceMode";
import ChatHistory, { HistoryItem } from "@/components/ChatHistory";
import { PDFViewerModal } from "@/components/PDFViewerModal";
import { StandardClipImage } from "@/components/StandardClipImage";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useData";
import { useProgress } from "@/hooks/useProgress";
import { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { retryWithBackoff, getUserMessage } from "@/lib/network";

interface Citation {
  clause_number: string;
  standard_code: string;
  standard_version?: string;
  standard_id?: string;
  page_number?: number;
  relevant_text?: string;
  gated?: boolean;
}

interface ImageRef {
  figure_number?: string;
  table_number?: string;
  caption?: string;
  standard_code?: string;
  standard_id?: string;
  page_number?: number;
  image_url?: string;
}

type FeedbackRating = "helpful" | "wrong" | "unclear";

interface Message {
  id: string;
  role: "user" | "ai";
  content: string;
  attachedImage?: string;
  isComplianceCheck?: boolean;
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
  cached?: boolean;
}

function FeedbackButtons({ queryId }: { queryId: string }) {
  const [submitted, setSubmitted] = useState<FeedbackRating | null>(null);
  // Which negative rating opened the comment box — previously the submit
  // button hardcoded "wrong", so "unclear" feedback was misrecorded.
  const [pendingRating, setPendingRating] = useState<FeedbackRating | null>(null);
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
      toast.error("Couldn't send feedback — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleQuick(rating: FeedbackRating) {
    if (rating === "wrong" || rating === "unclear") {
      setPendingRating(rating);
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

  if (pendingRating) {
    return (
      <div className="mt-2 space-y-2">
        <p className="text-xs text-muted-foreground">
          {pendingRating === "unclear" ? "What was confusing? (optional)" : "What was wrong? (optional)"}
        </p>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={2000}
          placeholder={pendingRating === "unclear" ? "e.g. Too much jargon..." : "e.g. Wrong clause number..."}
          className="w-full bg-background border border-border rounded-md px-3 py-2 text-xs text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary resize-none"
          rows={2}
        />
        <div className="flex gap-2">
          <button
            onClick={() => { void submit(pendingRating, comment.trim() || undefined); setPendingRating(null); }}
            disabled={submitting}
            className="px-3 py-1 bg-destructive text-destructive-foreground text-xs rounded-md hover:opacity-90 disabled:opacity-50"
          >
            Submit
          </button>
          <button
            onClick={() => { setPendingRating(null); setComment(""); }}
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

const STANDARDS_AFFILIATE_URL = "https://www.standards.org.au"; // TODO: replace with affiliate link

function ThinkingBubble({ isComplianceCheck }: { isComplianceCheck?: boolean }) {
  const [stage, setStage] = useState(0);
  const stages = isComplianceCheck
    ? ["Scanning photo…", "Checking compliance…", "Reviewing clauses…"]
    : ["Searching standards…", "Finding clauses…", "Drafting answer…"];

  useEffect(() => {
    const t = setInterval(() => setStage((s) => (s + 1) % stages.length), 2000);
    return () => clearInterval(t);
  }, [stages.length]);

  return (
    <div className="flex items-center gap-3 py-0.5">
      <div className="flex gap-[5px] items-end">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="block rounded-full bg-primary animate-thinking-dot"
            style={{ width: 7, height: 7, animationDelay: `${i * 0.18}s` }}
          />
        ))}
      </div>
      <span className="text-sm text-muted-foreground">{stages[stage]}</span>
    </div>
  );
}

const compressImage = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 1280;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        if (width > height) { height = Math.round(height * MAX / width); width = MAX; }
        else { width = Math.round(width * MAX / height); height = MAX; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.8).split(",")[1]);
    };
    img.onerror = reject;
    img.src = url;
  });

const Chat = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pendingImage, setPendingImage] = useState<{ base64: string; previewUrl: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pdfViewer, setPdfViewer] = useState<{ clauseNumber: string; standardCode?: string; standardId?: string; pageNumber?: number } | null>(null);
  const { session } = useAuth();
  const { data: profile } = useProfile();
  const location = useLocation();
  const navigate = useNavigate();
  // Hooks must run during render — calling useProgress() inside runQuery
  // threw on every send and killed the chat before the request went out.
  const { start, update, done } = useProgress();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Prefill from ?q= (the tools' "Verify with AI" button) or from route state
  // (Learn's "Ask AI Tutor" button, seeded with a missed exam question).
  // Prefill ONLY — nothing sends until the user hits send, so no query is
  // spent silently.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    if (q) {
      setInput(q);
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }
    const seedMessage = (location.state as { seedMessage?: string } | null)?.seedMessage;
    if (seedMessage) {
      setInput(seedMessage);
      navigate(location.pathname, { replace: true, state: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const queriesRemaining = profile
    ? Math.max(0, 5 - (profile.daily_query_count || 0))
    : 5;

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, isLoading, scrollToBottom]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Only images are supported — video analysis coming soon.");
      return;
    }
    try {
      const base64 = await compressImage(file);
      const previewUrl = `data:image/jpeg;base64,${base64}`;
      setPendingImage({ base64, previewUrl });
    } catch {
      toast.error("Couldn't load that image. Please try another.");
    }
    e.target.value = "";
  };

  const runQuery = async (question: string, imageBase64?: string, isComplianceCheck?: boolean): Promise<string | undefined> => {
    if (!session) {
      toast.error("Please sign in to use the chat");
      return undefined;
    }

    const history = messages
      .filter((m) => !m.isTyping && m.content)
      .slice(-6)
      .map((m) => ({ role: m.role === "ai" ? "assistant" : "user", content: m.content }));

    const aiMsgId = crypto.randomUUID();
    setMessages((prev) => [...prev, { id: aiMsgId, role: "ai" as const, content: "", isTyping: true }]);
    scrollToBottom();
    start("searching", "Searching standards...");

    try {
      await retryWithBackoff(
        async () => {
          const response = await fetch(`${SUPABASE_URL}/functions/v1/query`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${session.access_token}`,
              "apikey": SUPABASE_PUBLISHABLE_KEY,
            },
            body: JSON.stringify({ question, conversation_history: history, ...(imageBase64 ? { image_base64: imageBase64 } : {}) }),
          });

          if (!response.ok || !response.body) {
            const err = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
            const httpError = new Error(err.error || `HTTP ${response.status}`) as Error & { status?: number };
            httpError.status = response.status;
            throw httpError;
          }

          update("Reading answer...", 20);
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let sseBuffer = "";
          let streamedAnswer = "";
          let tokenCount = 0;

          while (true) {
            const { done: isDone, value } = await reader.read();
            if (isDone) break;

            sseBuffer += decoder.decode(value, { stream: true });
            const lines = sseBuffer.split("\n");
            sseBuffer = lines.pop() || "";

            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              const data = line.slice(6).trim();
              if (!data) continue;

              // Parse in its own try so only malformed/partial JSON is
              // ignored — real error events from the server must propagate,
              // not get swallowed by this catch.
              let event;
              try {
                event = JSON.parse(data);
              } catch { continue; }

              if (event.error) throw new Error(event.error);

              if (event.token !== undefined) {
                streamedAnswer += event.token;
                tokenCount++;
                setMessages((prev) => prev.map((m) =>
                  m.id === aiMsgId ? { ...m, content: streamedAnswer } : m
                ));
                update("Generating answer...", Math.min(90, 20 + (tokenCount % 70)));
                if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
              }

              if (event.done) {
                const finalAnswer = event.answer || streamedAnswer;
                setMessages((prev) => prev.map((m) =>
                  m.id === aiMsgId ? {
                    ...m,
                    content: finalAnswer,
                    isTyping: false,
                    isComplianceCheck: isComplianceCheck || false,
                    citations: event.citations || [],
                    // A standard + page is now the minimum renderable ref: the
                    // image is cropped live from the PDF, so a stored image_url
                    // (which only ever existed for some figures) is no longer
                    // enough on its own — and is no longer used at all.
                    figures_referenced: (event.figures_referenced || []).filter((f: ImageRef) => f.standard_id && f.page_number),
                    tables_referenced: (event.tables_referenced || []).filter((t: ImageRef) => t.standard_id && t.page_number),
                    safety_critical: event.safety_critical || false,
                    safety_message: event.safety_message,
                    confidence: event.confidence,
                    gated: event.gated || false,
                    gated_message: event.gated_message,
                    low_confidence: event.low_confidence || false,
                    answer_found: event.answer_found,
                    follow_up_questions: event.follow_up_questions || [],
                    queryId: event.queryId || null,
                    cached: event.cached || false,
                  } : m
                ));
                scrollToBottom();
                update("Done!", 100);
                return finalAnswer;
              }
            }
          }
          throw new Error("Stream ended without completion");
        },
        { maxRetries: 2, timeoutMs: 60000 }
      );
    } catch (e: any) {
      const msg = getUserMessage(e);
      console.error("Query error:", e);
      setMessages((prev) => prev.map((m) =>
        m.id === aiMsgId ? { ...m, content: msg, isTyping: false } : m
      ));
      toast.error(msg);
    } finally {
      done();
    }
    return undefined;
  };

  const sendQuery = async (overrideText?: string) => {
    const question = (overrideText ?? input).trim();
    const img = pendingImage;
    if (!question && !img) return;
    if (isLoading) return;

    const effectiveQuestion = question || "Please analyse this image and give me guidance based on the relevant Australian standards.";
    const isComplianceCheck = !!img;
    setMessages((prev) => [...prev, {
      id: crypto.randomUUID(),
      role: "user" as const,
      content: effectiveQuestion,
      attachedImage: img?.base64,
    }]);
    setInput("");
    setPendingImage(null);
    setIsLoading(true);

    try {
      await runQuery(effectiveQuestion, img?.base64, isComplianceCheck);
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

  // Reopen a saved question from history — loads it into the view to read back.
  // Only question/answer/clauses/safety were saved, so figures, follow-ups and
  // feedback aren't restored (queryId is left unset on purpose).
  const openFromHistory = useCallback((item: HistoryItem) => {
    setMessages([
      { id: `${item.id}-q`, role: "user", content: item.question },
      {
        id: `${item.id}-a`,
        role: "ai",
        content: item.response || "",
        citations: Array.isArray(item.citations) ? item.citations : [],
        safety_critical: item.safety_flagged,
      },
    ]);
  }, []);

  // Opens a specific past question/answer when navigated here with one (the
  // home page's Recent Activity cards) — same restore path as picking one
  // from the History drawer, just arriving via route state instead of a
  // click inside this page. Runs once on mount, same pattern as the ?q= and
  // seedMessage prefill above.
  useEffect(() => {
    const openQuery = (location.state as { openQuery?: HistoryItem } | null)?.openQuery;
    if (openQuery) {
      openFromHistory(openQuery);
      navigate(location.pathname, { replace: true, state: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Top bar — history access */}
      <div className="flex items-center justify-end px-4 py-1.5 border-b border-border">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setHistoryOpen(true)}
          className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <History className="h-4 w-4" />
          History
        </Button>
      </div>

      {/* Query count for free tier */}
      {profile?.subscription_tier === "free" && (
        <div className="px-5 py-1.5 border-b border-border bg-muted/30">
          <p className="text-xs text-muted-foreground text-center">
            {queriesRemaining > 0
              ? `${queriesRemaining} of 3 free queries remaining today`
              : "Daily limit reached — upgrade to Pro"}
          </p>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col">
        {messages.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center px-4 gap-5">
            <div className="text-center">
              <Shield className="h-12 w-12 text-primary/30 mb-3 mx-auto" />
              <p className="text-sm font-semibold text-foreground mb-1">
                What do you need to know?
              </p>
              <p className="text-xs text-muted-foreground">
                Ask anything about your uploaded standards. I'll find the exact clause.
              </p>
            </div>

            {/* Affiliate — subtle secondary link */}
            <a
              href={STANDARDS_AFFILIATE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border bg-background hover:bg-muted/50 active:scale-[0.98] transition-all text-xs text-muted-foreground hover:text-foreground"
            >
              <ShoppingCart className="h-3.5 w-3.5 flex-shrink-0 text-primary" />
              <span>Need a standard? <span className="font-semibold text-foreground">Buy Australian Standards</span></span>
              <ExternalLink className="h-3 w-3 flex-shrink-0 ml-auto" />
            </a>
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
                {msg.attachedImage && (
                  <img
                    src={`data:image/jpeg;base64,${msg.attachedImage}`}
                    alt="Attached"
                    className="w-full max-w-[240px] rounded-lg mb-2"
                  />
                )}
                <p className="text-sm text-primary-foreground">{msg.content}</p>
              </div>
            ) : (
              <div className="max-w-[90%] space-y-2">
                <Card className="p-4 shadow-sm">
                  {/* Compliance check badge */}
                  {msg.isComplianceCheck && (
                    <div className="flex items-center gap-1.5 mb-3 text-xs font-semibold text-amber-600 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400 rounded-lg px-3 py-1.5 w-fit">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Compliance Check
                    </div>
                  )}

                  {/* Cached badge — answer reused from a teammate's close-enough
                      question rather than freshly generated. Always shown, never
                      hidden, so the user can judge for themselves and re-ask if
                      their situation might differ. */}
                  {!msg.isTyping && msg.cached && (
                    <div className="flex items-center gap-1.5 mb-3 text-xs font-semibold text-blue-600 bg-blue-50 dark:bg-blue-950/30 dark:text-blue-400 rounded-lg px-3 py-1.5 w-fit">
                      <Zap className="h-3.5 w-3.5" />
                      Instant — a teammate already asked this
                    </div>
                  )}

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

                  {/* Thinking animation while waiting for first token, then stream */}
                  {msg.isTyping && !msg.content ? (
                    <ThinkingBubble isComplianceCheck={msg.isComplianceCheck} />
                  ) : (
                    <div className="chat-answer text-card-foreground">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content || " "}</ReactMarkdown>
                      {msg.isTyping && (
                        <span className="inline-block w-0.5 h-4 bg-primary ml-0.5 animate-pulse align-middle" />
                      )}
                    </div>
                  )}

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
                            onClick={() => setPdfViewer({ clauseNumber: citation.clause_number, standardCode: citation.standard_code, standardId: citation.standard_id, pageNumber: citation.page_number })}
                            className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-primary/10 text-primary hover:bg-primary/20 active:scale-95 transition-all"
                          >
                            {citation.clause_number}
                            {citation.standard_code ? ` (${citation.standard_code})` : ""}
                          </button>
                        )
                      )}
                    </div>
                  )}

                  {/* Figures — cropped live from the PDF, see StandardClipImage */}
                  {!msg.isTyping && msg.figures_referenced && msg.figures_referenced.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {msg.figures_referenced.map((fig, idx) => (
                        <StandardClipImage
                          key={idx}
                          standardId={fig.standard_id!}
                          kind="Figure"
                          refNumber={fig.figure_number || ""}
                          caption={fig.caption}
                          pageNumber={fig.page_number!}
                          onOpenFull={() => setPdfViewer({ clauseNumber: `Figure ${fig.figure_number}`, standardId: fig.standard_id, pageNumber: fig.page_number })}
                        />
                      ))}
                    </div>
                  )}

                  {/* Tables */}
                  {!msg.isTyping && msg.tables_referenced && msg.tables_referenced.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {msg.tables_referenced.map((tbl, idx) => (
                        <StandardClipImage
                          key={idx}
                          standardId={tbl.standard_id!}
                          kind="Table"
                          refNumber={tbl.table_number || ""}
                          caption={tbl.caption}
                          pageNumber={tbl.page_number!}
                          onOpenFull={() => setPdfViewer({ clauseNumber: `Table ${tbl.table_number}`, standardId: tbl.standard_id, pageNumber: tbl.page_number })}
                        />
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
              <ThinkingBubble />
            </Card>
          </div>
        )}
      </div>

      {/* Input — chat-input-wrapper class is locked in index.css, do not remove */}
      <div className="chat-input-wrapper flex-shrink-0 border-t border-border px-4 pt-4 bg-card">
        {/* Image preview */}
        {pendingImage && (
          <div className="relative inline-block mb-2">
            <img
              src={pendingImage.previewUrl}
              alt="Attached"
              className="h-16 w-16 object-cover rounded-lg border border-border"
            />
            <button
              onClick={() => setPendingImage(null)}
              className="absolute -top-1.5 -right-1.5 h-5 w-5 bg-destructive rounded-full flex items-center justify-center shadow"
            >
              <X className="h-3 w-3 text-white" />
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileSelect}
          />
          <Button
            size="icon"
            variant="ghost"
            className={`h-10 w-10 flex-shrink-0 ${pendingImage ? "text-primary" : "text-muted-foreground"}`}
            onClick={() => fileInputRef.current?.click()}
          >
            <Camera className="h-5 w-5" />
          </Button>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={pendingImage ? "Describe what to check, or just send to let Claude assess it..." : "Ask about your standards..."}
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
            disabled={(!input.trim() && !pendingImage) || isLoading}
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

      {/* Chat history panel */}
      <ChatHistory open={historyOpen} onOpenChange={setHistoryOpen} onSelect={openFromHistory} />

      {/* PDF Clause Viewer */}
      {pdfViewer && (
        <PDFViewerModal
          isOpen={!!pdfViewer}
          onClose={() => setPdfViewer(null)}
          clauseNumber={pdfViewer.clauseNumber}
          standardCode={pdfViewer.standardCode}
          standardId={pdfViewer.standardId}
          pageNumber={pdfViewer.pageNumber}
        />
      )}
    </div>
  );
};

export default Chat;
