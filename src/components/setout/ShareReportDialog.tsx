import { useEffect, useState } from "react";
import { Copy, ExternalLink, Loader2, RefreshCw, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import type { SetoutPlan } from "@/lib/setoutTypes";

const EXPORT_BUCKET = "setout-plan-exports";

interface ShareReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: SetoutPlan;
  userId: string;
  /** True while a revoke-and-reshare (rotate token + re-export + re-upload) is in flight. */
  busy: boolean;
  onRevoke: () => void;
}

// "Share with builder" — the public link is just the exported PDF's public
// storage URL, same one the legend's own QR code already points at (see
// handleExport in SetoutPlan.tsx). This dialog doesn't generate that PDF
// itself; it shows the link, offers ways to hand it off, and can revoke +
// regenerate it under a fresh token when the tradie wants the old link dead.
const ShareReportDialog = ({ open, onOpenChange, plan, userId, busy, onRevoke }: ShareReportDialogProps) => {
  const [checking, setChecking] = useState(true);
  const [exportExists, setExportExists] = useState(false);

  const publicUrl = supabase.storage.from(EXPORT_BUCKET).getPublicUrl(`${userId}/${plan.export_token}.pdf`).data.publicUrl;

  // setout_plans has no last_exported_at column to check cheaply, so whether
  // a link is actually live is worked out the direct way: list the one
  // folder this plan's export would sit in and look for its filename.
  // Re-checked on every open (and whenever the token changes, e.g. right
  // after a revoke) rather than trusted from stale state.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setChecking(true);
    (async () => {
      const { data, error } = await supabase.storage
        .from(EXPORT_BUCKET)
        .list(userId, { search: `${plan.export_token}.pdf` });
      if (cancelled) return;
      if (error) {
        console.error("[ShareReportDialog] Could not check for an existing export:", error);
        setExportExists(false);
      } else {
        setExportExists((data ?? []).some((f) => f.name === `${plan.export_token}.pdf`));
      }
      setChecking(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, userId, plan.export_token]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy the link — copy it straight from the box instead.");
    }
  };

  const canWebShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const handleWebShare = async () => {
    try {
      await navigator.share({ title: plan.name, text: `Setout plan — ${plan.name}`, url: publicUrl });
    } catch (err) {
      // AbortError just means the tradie backed out of the native share sheet.
      if (err instanceof Error && err.name !== "AbortError") toast.error("Couldn't open the share sheet.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share with builder</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
            Anyone with this link can view the exported PDF — no sign-in required. Only send it where you're happy for the plan to be seen.
          </p>
          {checking ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking for an existing export…
            </div>
          ) : exportExists ? (
            <>
              <div className="flex gap-2">
                <Input readOnly value={publicUrl} className="h-9 text-xs" onFocus={(e) => e.currentTarget.select()} />
                <Button variant="outline" size="icon" className="h-9 w-9 flex-shrink-0" onClick={handleCopy} title="Copy link">
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {canWebShare && (
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={handleWebShare}>
                    <Share2 className="h-3.5 w-3.5" /> Share
                  </Button>
                )}
                <Button size="sm" variant="outline" className="gap-1.5" asChild>
                  <a href={publicUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-3.5 w-3.5" /> Open
                  </a>
                </Button>
              </div>
              <div className="pt-3 border-t border-border">
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full gap-1.5 text-destructive hover:text-destructive"
                  disabled={busy}
                  onClick={onRevoke}
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Revoke and make a new link
                </Button>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  Kills the old link straight away, then generates and uploads a fresh one automatically.
                </p>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              This plan hasn't been exported yet — use Export PDF first, then come back here to share it.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ShareReportDialog;
