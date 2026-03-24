import { useState, useRef, useCallback } from "react";
import { Send, Camera, AlertTriangle, Lock, Zap, Shield, Loader2, Mic } from "lucide-react";
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

interface Message {
  id: string;
  role: "user" | "ai";
  content: string;
  citations?: Citation[];
  safety_critical?: boolean;
  safety_message?: string;
  confidence?: string;
  gated?: boolean;
  gated_message?: string;
  low_confidence?: boolean;
  answer_found?: boolean;
}

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

  const sendQuery = async () => {
    if (!input.trim() || isLoading) return;
    if (!session) {
      toast.error("Please sign in to use the chat");
      return;
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: input.trim(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke("query", {
        body: { question: userMessage.content },
      });

      if (error) {
        throw new Error(error.message || "Query failed");
      }

      if (data?.error) {
        if (data.upgrade_required) {
          const aiMessage: Message = {
            id: crypto.randomUUID(),
            role: "ai",
            content: data.message || data.error,
            gated: true,
            gated_message: data.message,
          };
          setMessages((prev) => [...prev, aiMessage]);
        } else {
          toast.error(data.error);
        }
        return;
      }

      const aiMessage: Message = {
        id: crypto.randomUUID(),
        role: "ai",
        content: data.answer || "No response generated.",
        citations: data.citations || [],
        safety_critical: data.safety_critical || false,
        safety_message: data.safety_message,
        confidence: data.confidence,
        gated: data.gated || false,
        gated_message: data.gated_message,
        low_confidence: data.low_confidence || false,
        answer_found: data.answer_found,
      };

      setMessages((prev) => [...prev, aiMessage]);
    } catch (e: any) {
      console.error("Query error:", e);
      toast.error(e.message || "Failed to send query");
    } finally {
      setIsLoading(false);
      setTimeout(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
      }, 100);
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

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text.trim(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke("query", {
        body: { question: text.trim() },
      });

      if (error) throw new Error(error.message || "Query failed");

      const answer = data?.answer || data?.message || data?.error || "No response.";
      const aiMessage: Message = {
        id: crypto.randomUUID(),
        role: "ai",
        content: answer,
        citations: data?.citations || [],
        safety_critical: data?.safety_critical || false,
        safety_message: data?.safety_message,
        confidence: data?.confidence,
        low_confidence: data?.low_confidence || false,
        answer_found: data?.answer_found,
      };
      setMessages((prev) => [...prev, aiMessage]);
      return answer;
    } catch (e: any) {
      console.error("Voice query error:", e);
      return "Sorry, I couldn't process that. Please try again.";
    } finally {
      setIsLoading(false);
    }
  }, [session]);

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)]">
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
          <div className="flex flex-col items-center justify-center h-full text-center px-8">
            <Shield className="h-12 w-12 text-primary/30 mb-4" />
            <p className="text-sm font-semibold text-foreground mb-1">
              Ask a compliance question
            </p>
            <p className="text-xs text-muted-foreground">
              Upload a standard first, then ask questions about it. The AI will
              reference specific clauses from your uploaded documents.
            </p>
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
              <Card className="max-w-[90%] p-4 shadow-sm">
                {/* Low confidence warning */}
                {msg.low_confidence && (
                  <div className="flex items-start gap-2 mb-3 rounded-lg bg-warning/10 p-3">
                    <AlertTriangle className="h-4 w-4 text-warning flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-warning font-medium">
                      I'm not fully confident in this answer — I'd recommend verifying directly with the relevant standard.
                    </p>
                  </div>
                )}

                <p className="text-sm text-card-foreground leading-relaxed">
                  {msg.content}
                </p>

                {/* Clause badges */}
                {msg.citations && msg.citations.length > 0 && (
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
                {msg.safety_critical && (
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
            )}
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <Card className="p-4 shadow-sm">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Searching your standards...</p>
              </div>
            </Card>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-border px-4 py-3 pb-safe bg-card">
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
            placeholder="Ask about compliance..."
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
            onClick={sendQuery}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
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
