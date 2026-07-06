import { useProgress } from "@/hooks/useProgress";

const phaseEmoji: Record<string, string> = {
  analyzing: "🔍",
  uploading: "📤",
  saving: "💾",
  searching: "🔎",
  loading: "⏳",
};

export function ProgressBar() {
  const { state } = useProgress();

  if (!state.phase) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-sm border-b border-border">
      <div className="max-w-2xl mx-auto px-5 py-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-lg">{phaseEmoji[state.phase] || "⏳"}</span>
          <p className="text-sm font-semibold text-foreground">{state.message}</p>
        </div>
        <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${Math.min(state.progress, 95)}%` }}
          />
        </div>
        {state.progress > 0 && state.progress < 100 && (
          <p className="text-xs text-muted-foreground mt-1">{Math.round(state.progress)}%</p>
        )}
      </div>
    </div>
  );
}
