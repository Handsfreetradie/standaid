import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  firstName: string;
  industryCount: number;
  onFinish: () => void;
}

const OnboardingReady = ({ firstName, industryCount, onFinish }: Props) => {
  const [confetti, setConfetti] = useState<Array<{ id: number; x: number; delay: number; color: string; size: number }>>([]);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Generate confetti
    const pieces = Array.from({ length: 40 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      delay: Math.random() * 0.8,
      color: i % 3 === 0 ? "hsl(var(--primary))" : i % 3 === 1 ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
      size: 6 + Math.random() * 6,
    }));
    setConfetti(pieces);
    setTimeout(() => setVisible(true), 200);
  }, []);

  const standardsLoaded = industryCount > 0 ? industryCount * 8 : 12;

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 relative overflow-hidden">
      {/* Confetti */}
      {confetti.map((p) => (
        <div
          key={p.id}
          className="absolute top-0 animate-bounce"
          style={{
            left: `${p.x}%`,
            width: p.size,
            height: p.size,
            backgroundColor: p.color,
            borderRadius: p.size > 9 ? "50%" : "2px",
            animationDelay: `${p.delay}s`,
            animationDuration: `${1.5 + Math.random()}s`,
            opacity: 0.8,
          }}
        />
      ))}

      <div className={`text-center transition-all duration-500 ease-out ${visible ? "opacity-100 scale-100" : "opacity-0 scale-95"}`}>
        {/* Checkmark */}
        <div className="mx-auto mb-6 h-20 w-20 rounded-full bg-primary/10 ring-4 ring-primary flex items-center justify-center">
          <Check className="h-10 w-10 text-primary" strokeWidth={3} />
        </div>

        <h2 className="font-sans text-2xl font-extrabold text-foreground">
          You're ready, {firstName || "mate"}!
        </h2>
        <p className="text-muted-foreground text-sm mt-2">
          Your standards are loaded and your AI assistant is ready.
        </p>

        {/* Stats */}
        <div className="flex justify-center gap-4 mt-8">
          <div className="flex flex-col items-center bg-card border border-border rounded-xl px-5 py-4 min-w-[100px]">
            <span className="text-lg mb-1">📚</span>
            <span className="text-lg font-extrabold text-foreground">{standardsLoaded}</span>
            <span className="text-[10px] text-muted-foreground">Standards</span>
            <span className="text-[10px] text-muted-foreground">Loaded and ready</span>
          </div>
          <div className="flex flex-col items-center bg-card border border-border rounded-xl px-5 py-4 min-w-[100px]">
            <span className="text-lg mb-1">💬</span>
            <span className="text-lg font-extrabold text-foreground">5</span>
            <span className="text-[10px] text-muted-foreground">Queries</span>
            <span className="text-[10px] text-muted-foreground">Available today</span>
          </div>
          <div className="flex flex-col items-center bg-card border border-border rounded-xl px-5 py-4 min-w-[100px]">
            <span className="text-lg mb-1">🔧</span>
            <span className="text-lg font-extrabold text-foreground">1</span>
            <span className="text-[10px] text-muted-foreground">Calculator</span>
            <span className="text-[10px] text-muted-foreground">Ready to use</span>
          </div>
        </div>

        <div className="mt-10 w-full max-w-xs mx-auto">
          <Button
            onClick={onFinish}
            className="w-full h-14 text-base font-bold rounded-xl"
          >
            Open StandAid
          </Button>
          <p className="text-xs text-muted-foreground mt-3">
            Pro tip: Ask your first compliance question to see StandAid in action
          </p>
        </div>
      </div>
    </div>
  );
};

export default OnboardingReady;
