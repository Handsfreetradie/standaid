import { CloudOff, RefreshCw } from "lucide-react";
import { useIsOnline, useSetoutPendingSyncCount } from "@/hooks/useSetoutSyncStatus";

// Sits at the top of a setout page. Nothing to configure — reads the same
// onlineManager/mutation-queue state the offline persistence layer itself
// runs on, so it can never disagree with what's actually queued.
export function OfflineSyncBanner() {
  const isOnline = useIsOnline();
  const pending = useSetoutPendingSyncCount();

  if (isOnline && pending === 0) return null;

  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium ${
        isOnline ? "bg-primary/10 text-primary" : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
      }`}
      role="status"
    >
      {isOnline ? (
        <>
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          <span>Syncing {pending} change{pending === 1 ? "" : "s"}…</span>
        </>
      ) : (
        <>
          <CloudOff className="h-3.5 w-3.5" />
          <span>
            Offline — {pending > 0 ? `${pending} change${pending === 1 ? "" : "s"} saved on this device, will sync` : "changes save on this device and sync"} when you're back in range.
          </span>
        </>
      )}
    </div>
  );
}
