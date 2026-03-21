import { useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Props {
  onNext: (plan: "free" | "pro") => void;
  onBack: () => void;
}

const OnboardingPricing = ({ onNext, onBack }: Props) => {
  const [annual, setAnnual] = useState(true);

  const freeFeatures = [
    { text: "Government & public standards", included: true },
    { text: "5 AI queries per day", included: true },
    { text: "1 basic calculator", included: true },
    { text: "Basic compliance chat", included: true },
    { text: "Upload your own standards", included: false },
    { text: "Photo & video analysis", included: false },
    { text: "Unlimited queries", included: false },
    { text: "Full calculator suite", included: false },
    { text: "Compliance reports", included: false },
    { text: "Voice input", included: false },
    { text: "Save history", included: false },
  ];

  const proFeatures = [
    "Everything in Free",
    "Upload unlimited standards",
    "Unlimited AI queries",
    "Photo & video analysis",
    "20+ calculators with clause refs",
    "Voice input — hands free",
    "Full job history saved",
    "Compliance reports & certificates",
    "Apprentice & capstone mode",
    "7 day free trial — no card needed",
  ];

  return (
    <div className="min-h-screen bg-background px-5 py-6 pb-32 overflow-y-auto">
      <button onClick={onBack} className="text-sm text-muted-foreground mb-4 hover:text-foreground">
        ← Back
      </button>

      <div className="text-center mb-6">
        <h2 className="font-sans text-2xl font-extrabold text-foreground">Start free.</h2>
        <p className="text-muted-foreground text-sm mt-2">
          Upgrade when you need more on the job.
        </p>
      </div>

      {/* Toggle */}
      <div className="flex items-center justify-center gap-3 mb-6">
        <span className={`text-sm font-medium ${!annual ? "text-foreground" : "text-muted-foreground"}`}>
          Monthly
        </span>
        <button
          onClick={() => setAnnual(!annual)}
          className={`relative w-14 h-7 rounded-full transition-colors ${
            annual ? "bg-primary" : "bg-muted"
          }`}
        >
          <div
            className={`absolute top-0.5 h-6 w-6 rounded-full bg-background shadow transition-transform ${
              annual ? "translate-x-7" : "translate-x-0.5"
            }`}
          />
        </button>
        <div className="flex items-center gap-1.5">
          <span className={`text-sm font-medium ${annual ? "text-foreground" : "text-muted-foreground"}`}>
            Annual
          </span>
          {annual && (
            <Badge className="bg-primary text-primary-foreground text-[10px] px-1.5 py-0">
              Save 25%
            </Badge>
          )}
        </div>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 gap-4 max-w-md mx-auto sm:grid-cols-2">
        {/* Free */}
        <Card className="p-5">
          <div className="bg-muted rounded-lg px-3 py-1.5 inline-block mb-3">
            <span className="text-sm font-bold text-foreground">Free</span>
          </div>
          <p className="text-2xl font-extrabold text-foreground">$0</p>
          <p className="text-xs text-muted-foreground mb-4">forever</p>
          <div className="space-y-2.5">
            {freeFeatures.map((f) => (
              <div key={f.text} className="flex items-start gap-2">
                {f.included ? (
                  <Check className="h-4 w-4 flex-shrink-0 mt-0.5" style={{ color: "hsl(142 71% 45%)" }} />
                ) : (
                  <X className="h-4 w-4 text-muted-foreground/40 flex-shrink-0 mt-0.5" />
                )}
                <span className={`text-xs ${f.included ? "text-foreground" : "text-muted-foreground/60"}`}>
                  {f.text}
                </span>
              </div>
            ))}
          </div>
        </Card>

        {/* Pro */}
        <Card className="p-5 border-primary ring-1 ring-primary relative shadow-lg shadow-primary/10">
          <Badge className="absolute -top-2.5 right-4 bg-primary text-primary-foreground text-[10px]">
            Most Popular
          </Badge>
          <div className="bg-primary rounded-lg px-3 py-1.5 inline-block mb-3">
            <span className="text-sm font-bold text-primary-foreground">Pro</span>
          </div>
          <p className="text-2xl font-extrabold text-foreground">
            {annual ? "$14.99" : "$19.99"}
          </p>
          <p className="text-xs text-muted-foreground mb-1">/month</p>
          {annual && (
            <p className="text-xs text-primary font-semibold mb-4">
              $179/year — save 25%
            </p>
          )}
          {!annual && <div className="mb-4" />}
          <div className="space-y-2.5">
            {proFeatures.map((f) => (
              <div key={f} className="flex items-start gap-2">
                <Check className="h-4 w-4 flex-shrink-0 mt-0.5" style={{ color: "hsl(142 71% 45%)" }} />
                <span className="text-xs text-foreground">{f}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Fixed bottom */}
      <div className="fixed bottom-0 left-0 right-0 bg-background border-t border-border px-5 py-4 pb-safe">
        <Button
          onClick={() => onNext("free")}
          className="w-full h-12 text-base font-bold rounded-xl"
        >
          Start Free
        </Button>
        <button
          onClick={() => onNext("pro")}
          className="text-sm text-muted-foreground mt-3 block mx-auto hover:text-primary"
        >
          Start Pro free trial — no card needed →
        </button>
        <p className="text-xs text-muted-foreground text-center mt-2">
          Cancel any time. No lock in.
        </p>
      </div>
    </div>
  );
};

export default OnboardingPricing;
