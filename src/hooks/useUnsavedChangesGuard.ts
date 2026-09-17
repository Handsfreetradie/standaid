import { useEffect } from "react";

// Warns before a browser-level navigation (tab close, refresh, back/forward,
// typing a new address) throws away in-progress setout work — walls,
// openings or a calibration a tradie hasn't saved yet. This only covers the
// browser leaving the page entirely; an in-app Back/Close button needs its
// own confirm dialog, since `beforeunload` never fires for those.
export function useUnsavedChangesGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Most browsers ignore this string these days and show their own fixed
      // wording, but setting returnValue is still what actually triggers the
      // "leave site?" prompt at all.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
}
