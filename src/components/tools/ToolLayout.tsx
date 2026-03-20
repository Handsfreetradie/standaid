import { ArrowLeft, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useState } from "react";

interface ToolLayoutProps {
  title: string;
  subtitle: string;
  disclaimer: string;
  onBack: () => void;
  children: React.ReactNode;
  result?: React.ReactNode;
  onCalculate: () => void;
  advancedInputs?: React.ReactNode;
}

const ToolLayout = ({ title, subtitle, disclaimer, onBack, children, result, onCalculate, advancedInputs }: ToolLayoutProps) => {
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div className="px-5 py-6 pb-24 max-w-md mx-auto">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <h2 className="font-display text-lg font-extrabold text-foreground mb-1">{title}</h2>
      <p className="text-xs text-muted-foreground mb-5">{subtitle}</p>

      <div className="space-y-4">
        {children}

        {advancedInputs && (
          <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
            <CollapsibleTrigger asChild>
              <button className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 transition-colors w-full py-2">
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
                {showAdvanced ? "Hide" : "Show"} Advanced Settings
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="space-y-4 pt-2 pb-1 pl-3 border-l-2 border-primary/20">
                {advancedInputs}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        <Button onClick={onCalculate} className="w-full h-12 font-bold rounded-xl text-base">
          Calculate
        </Button>
      </div>

      {result && (
        <Card className="mt-5 p-4 border-primary/20">
          {result}
        </Card>
      )}

      <p className="text-[10px] text-muted-foreground mt-4 leading-relaxed">{disclaimer}</p>
    </div>
  );
};

export default ToolLayout;
