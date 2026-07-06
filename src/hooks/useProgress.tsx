import { createContext, useContext, useState, useCallback } from "react";

export type ProgressPhase = "analyzing" | "uploading" | "saving" | "searching" | "loading";

interface ProgressState {
  phase: ProgressPhase | null;
  message: string;
  progress: number; // 0–100
}

interface ProgressContextType {
  state: ProgressState;
  start: (phase: ProgressPhase, initialMessage: string) => void;
  update: (message: string, progress: number) => void;
  done: () => void;
}

const ProgressContext = createContext<ProgressContextType | null>(null);

const phaseMessages: Record<ProgressPhase, string> = {
  analyzing: "Analyzing...",
  uploading: "Uploading...",
  saving: "Saving...",
  searching: "Searching...",
  loading: "Loading...",
};

export function ProgressProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ProgressState>({ phase: null, message: "", progress: 0 });

  const start = useCallback((phase: ProgressPhase, initialMessage?: string) => {
    setState({
      phase,
      message: initialMessage || phaseMessages[phase],
      progress: 0,
    });
  }, []);

  const update = useCallback((message: string, progress: number) => {
    setState((prev) => (prev.phase ? { ...prev, message, progress: Math.min(100, Math.max(0, progress)) } : prev));
  }, []);

  const done = useCallback(() => {
    setState({ phase: null, message: "", progress: 0 });
  }, []);

  return (
    <ProgressContext.Provider value={{ state, start, update, done }}>
      {children}
    </ProgressContext.Provider>
  );
}

export function useProgress() {
  const ctx = useContext(ProgressContext);
  if (!ctx) throw new Error("useProgress must be used inside <ProgressProvider>");
  return ctx;
}
