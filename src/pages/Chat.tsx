import { useState } from "react";
import { Send, Camera, Mic, AlertTriangle, Lock, Zap, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";

interface Message {
  id: number;
  role: "user" | "ai";
  content: string;
  clauses?: string[];
  safetyWarning?: boolean;
  gated?: boolean;
}

const mockMessages: Message[] = [
  {
    id: 1,
    role: "user",
    content:
      "What are the requirements for circuit protection in a bathroom?",
  },
  {
    id: 2,
    role: "ai",
    content:
      "Based on AS/NZS 3000:2018, bathroom circuits require specific protection measures. All circuits supplying socket outlets and lighting in Zone 1 and Zone 2 must be protected by a residual current device (RCD) with a rated residual operating current not exceeding 30mA.",
    clauses: ["Clause 6.2.2.1", "Clause 6.2.3"],
    safetyWarning: true,
  },
  {
    id: 3,
    role: "user",
    content: "What about cable sizing for the bathroom circuit?",
  },
  {
    id: 4,
    role: "ai",
    content:
      "This question relates to cable sizing which is covered in detail in AS/NZS 3008. There is a clause covering this in your library, but it falls outside the indexed portion of your standard.",
    gated: true,
  },
];

const Chat = () => {
  const [messages] = useState<Message[]>(mockMessages);
  const [input, setInput] = useState("");

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)]">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <h1 className="font-display text-lg font-bold text-foreground">
            Compliance Chat
          </h1>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          3 of 5 free queries remaining today
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={
              msg.role === "user" ? "flex justify-end" : "flex justify-start"
            }
          >
            {msg.role === "user" ? (
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-3">
                <p className="text-sm text-primary-foreground">{msg.content}</p>
              </div>
            ) : (
              <Card className="max-w-[90%] p-4 shadow-sm">
                <p className="text-sm text-card-foreground leading-relaxed">
                  {msg.content}
                </p>

                {/* Clause badges */}
                {msg.clauses && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {msg.clauses.map((clause) => (
                      <Badge
                        key={clause}
                        className="bg-primary/10 text-primary border-0 text-xs font-semibold"
                      >
                        {clause}
                      </Badge>
                    ))}
                  </div>
                )}

                {/* Safety warning */}
                {msg.safetyWarning && (
                  <div className="flex items-start gap-2 mt-3 rounded-lg bg-destructive/10 p-3">
                    <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-destructive font-medium">
                      Safety-critical work must be assessed and signed off by a
                      licensed professional on-site.
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
                          You're on the right track — upgrade to Pro to get the
                          full clause and complete guidance.
                        </p>
                        <Button
                          size="sm"
                          className="mt-2 h-7 text-xs font-semibold gap-1"
                        >
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
          <Button
            size="icon"
            variant="ghost"
            className="h-10 w-10 flex-shrink-0 text-muted-foreground"
          >
            <Mic className="h-5 w-5" />
          </Button>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about compliance..."
            className="min-h-[40px] max-h-[120px] resize-none text-sm"
            rows={1}
          />
          <Button
            size="icon"
            className="h-10 w-10 flex-shrink-0"
            disabled={!input.trim()}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Chat;
