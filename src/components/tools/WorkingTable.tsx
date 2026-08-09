import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useState } from "react";

export interface WorkingStep {
  label: string;
  working: string;
  result: string;
  reference: string;
}

interface WorkingTableProps {
  steps: WorkingStep[];
}

// Shared "show your working" breakdown for trade tools — one step per row
// (label / formula / result / standard reference) so the user can see how
// a tool arrived at its number, not just the number itself.
const WorkingTable = ({ steps }: WorkingTableProps) => {
  const [open, setOpen] = useState(false);

  if (steps.length === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-3 pt-3 border-t border-border">
      <CollapsibleTrigger asChild>
        <button className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 transition-colors w-full py-1">
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
          {open ? "Hide" : "Show"} the working
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-2 pt-2">
          {steps.map((s, i) => (
            <div key={i} className="rounded-lg border border-border bg-muted/30 p-2.5">
              <p className="text-[11px] font-semibold text-foreground mb-0.5">
                {i + 1}. {s.label}
              </p>
              <p className="text-xs font-mono text-muted-foreground break-words">{s.working}</p>
              <div className="flex items-center justify-between gap-2 mt-1">
                <p className="text-xs font-bold text-primary">{s.result}</p>
                <p className="text-[10px] text-muted-foreground text-right">{s.reference}</p>
              </div>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

export default WorkingTable;
