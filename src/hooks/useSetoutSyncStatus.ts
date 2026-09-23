import { useEffect, useState } from "react";
import { onlineManager, useMutationState } from "@tanstack/react-query";

// Thin wrapper around TanStack Query's own onlineManager rather than a
// second navigator.onLine listener — it's the exact signal that decides
// whether a paused setout mutation is waiting or already flushing, so this
// stays in lockstep with what the mutation queue is actually doing instead
// of occasionally disagreeing with it.
export function useIsOnline(): boolean {
  const [isOnline, setIsOnline] = useState(() => onlineManager.isOnline());
  useEffect(() => onlineManager.subscribe(() => setIsOnline(onlineManager.isOnline())), []);
  return isOnline;
}

// Counts setout mutations sitting paused (queued offline, or restored from a
// previous session and not yet flushed) so the banner can say "N changes
// will sync" instead of a bare "you're offline" that doesn't tell a tradie
// whether their last few taps actually queued.
export function useSetoutPendingSyncCount(): number {
  const paused = useMutationState({
    filters: {
      status: "pending",
      predicate: (mutation) => {
        const key = mutation.options.mutationKey;
        return mutation.state.isPaused && Array.isArray(key) && typeof key[0] === "string" && key[0].startsWith("setout");
      },
    },
  });
  return paused.length;
}
