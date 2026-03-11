import { useState } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  onNext: (industries: string[]) => void;
  onBack: () => void;
}

const industries = [
  { id: "electrical", icon: "⚡", name: "Electrical", count: "12 standards loaded" },
  { id: "plumbing", icon: "🔧", name: "Plumbing", count: "8 standards loaded" },
  { id: "building", icon: "🏗️", name: "Building & Construction", count: "15 standards loaded" },
  { id: "carpentry", icon: "🔩", name: "Carpentry", count: "6 standards loaded" },
  { id: "gas", icon: "🔥", name: "Gas Fitting", count: "5 standards loaded" },
  { id: "hvac", icon: "🌡️", name: "HVAC", count: "7 standards loaded" },
  { id: "health_safety", icon: "⚕️", name: "Health & Safety", count: "10 standards loaded" },
  { id: "engineering", icon: "🏭", name: "Engineering", count: "9 standards loaded" },
  { id: "food_safety", icon: "🍽️", name: "Food Safety", count: "6 standards loaded" },
  { id: "other", icon: "📐", name: "Other", count: "Browse all standards" },
];

const OnboardingIndustry = ({ onNext, onBack }: Props) => {
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  return (
    <div className="min-h-screen bg-background px-5 py-6 pb-32 overflow-y-auto">
      {/* Back */}
      <button onClick={onBack} className="text-sm text-muted-foreground mb-4 hover:text-foreground">
        ← Back
      </button>

      <div className="text-center mb-6">
        <h2 className="font-display text-2xl font-extrabold text-foreground">
          What's your industry?
        </h2>
        <p className="text-muted-foreground text-sm mt-2">
          We'll load the right standards and tools for you
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 max-w-md mx-auto">
        {industries.map((ind) => {
          const isSelected = selected.includes(ind.id);
          return (
            <button
              key={ind.id}
              onClick={() => toggle(ind.id)}
              className={`flex flex-col items-center gap-2 p-4 rounded-xl border text-center transition-all ${
                isSelected
                  ? "border-primary border-2 bg-primary/5"
                  : "border-border bg-card hover:border-muted-foreground/30"
              }`}
            >
              <span className="text-2xl">{ind.icon}</span>
              <span className={`text-sm font-bold ${isSelected ? "text-primary" : "text-foreground"}`}>
                {ind.name}
              </span>
              <span className="text-xs text-muted-foreground">{ind.count}</span>
            </button>
          );
        })}
      </div>

      {/* Fixed bottom CTA */}
      <div className="fixed bottom-0 left-0 right-0 bg-background border-t border-border px-5 py-4 pb-safe">
        <Button
          onClick={() => onNext(selected)}
          disabled={selected.length === 0}
          className="w-full h-12 text-base font-bold rounded-xl"
        >
          Continue{selected.length > 0 ? ` (${selected.length} selected)` : ""}
        </Button>
        <p className="text-xs text-muted-foreground text-center mt-2">
          You can add more industries later
        </p>
      </div>
    </div>
  );
};

export default OnboardingIndustry;
