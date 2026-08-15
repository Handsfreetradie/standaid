import { useEffect, useState } from "react";
import { History, MessageSquare } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";

// Mirrors the columns saved in the `queries` table for each question asked.
export interface HistoryItem {
  id: string;
  question: string;
  response: string | null;
  citations: any;
  safety_flagged: boolean;
  created_at: string;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return `Today, ${d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })}`;
  }
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

interface ChatHistoryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (item: HistoryItem) => void;
}

export function ChatHistory({ open, onOpenChange, onSelect }: ChatHistoryProps) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(false);
      const { data, error } = await supabase
        .from("queries")
        .select("id, question, response, citations, safety_flagged, created_at")
        .not("question", "like", "explain\\_%") // hide exam-helper explanation cache rows
        .order("created_at", { ascending: false })
        .limit(10);

      if (cancelled) return;
      if (error) {
        console.error("History load error:", error);
        setError(true);
      } else {
        setItems((data as HistoryItem[]) ?? []);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[88vw] sm:w-[400px] p-0 flex flex-col">
        <SheetHeader className="px-5 py-4 border-b border-border text-left" style={{ paddingTop: `calc(16px + env(safe-area-inset-top, 0px))` }}>
          <SheetTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4 text-primary" />
            Recent questions
          </SheetTitle>
          <SheetDescription className="text-xs">
            Your last 10 questions, saved to your account.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-3 py-3">
          {loading && (
            <p className="text-sm text-muted-foreground text-center py-8">Loading your history…</p>
          )}

          {!loading && error && (
            <p className="text-sm text-muted-foreground text-center py-8">
              Couldn't load your history. Please try again.
            </p>
          )}

          {!loading && !error && items.length === 0 && (
            <div className="text-center py-10 px-4">
              <MessageSquare className="h-8 w-8 text-primary/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                No questions yet. Ask something and it'll show up here.
              </p>
            </div>
          )}

          {!loading && !error && items.length > 0 && (
            <ul className="space-y-1.5">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    onClick={() => {
                      onSelect(item);
                      onOpenChange(false);
                    }}
                    className="w-full text-left rounded-xl px-3.5 py-3 hover:bg-muted/60 active:scale-[0.99] transition-all"
                  >
                    <p className="text-sm font-medium text-foreground line-clamp-2 leading-snug">
                      {item.question}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {formatWhen(item.created_at)}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default ChatHistory;
