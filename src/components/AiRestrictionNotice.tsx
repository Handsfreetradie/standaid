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
// change — each version is its own "seen it" flag.
const SEEN_KEY = "seen_sa_ai_disclaimer_v1";

export function AiRestrictionNotice() {
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
          <DialogTitle>A change to AS/NZS standards</DialogTitle>
          <DialogDescription className="text-left pt-1">
            Standards Australia's licensing terms don't allow AI use of their content. AS/NZS and NZS
            standards can still be uploaded and viewed in StandAId, but AI search, chat and Learn
            features are no longer available for them. Other standards (NCC, plumbing and building
            codes, and more) aren't affected.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button className="w-full" onClick={dismiss}>Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
