import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

// Bump this key if the notice ever needs to be re-shown after a future
// change — each version is its own "seen it" flag. v2 replaces the old
// "AS/NZS features are off" notice (seen_sa_ai_disclaimer_v1) now that the
// app no longer blocks AI on any document — the message inverted, so
// everyone who dismissed v1 needs to see this one too.
const SEEN_KEY = "seen_ai_disclaimer_v2";

export function AiDisclaimerNotice() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(SEEN_KEY) !== "true") setOpen(true);
  }, []);

  const dismiss = () => {
    localStorage.setItem(SEEN_KEY, "true");
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) dismiss(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="h-11 w-11 rounded-xl bg-amber-500/10 flex items-center justify-center mb-2">
            <ShieldAlert className="h-5 w-5 text-amber-600 dark:text-amber-500" />
          </div>
          <DialogTitle>Before you rely on AI answers</DialogTitle>
          <DialogDescription className="text-left pt-1">
            StandAId's AI can get things wrong — always verify anything safety-critical against your
            actual document. You're responsible for having the right to upload and use any document
            with AI: some publishers, including Standards Australia, don't permit AI/ML use of their
            content under their own terms. Checking that is on you, not StandAId.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button className="w-full" onClick={dismiss}>Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
