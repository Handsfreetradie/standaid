import { useEffect, useState } from "react";
import { AlertTriangle, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Props {
  onNext: () => void;
  onSkip: () => void;
}

const OnboardingDemo = ({ onNext, onSkip }: Props) => {
  const [visibleCards, setVisibleCards] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setVisibleCards(1), 300),
      setTimeout(() => setVisibleCards(2), 700),
      setTimeout(() => setVisibleCards(3), 1100),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  const cardClass = (index: number) =>
    `transition-all duration-500 ease-out ${
      visibleCards > index ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
    }`;

  return (
    <div className="min-h-screen bg-background px-5 py-6 pb-24 overflow-y-auto">
      {/* Skip */}
      <div className="flex justify-end mb-4">
        <button onClick={onSkip} className="text-sm text-muted-foreground hover:text-foreground">
          Skip
        </button>
      </div>

      <div className="text-center mb-8">
        <h2 className="font-display text-2xl font-extrabold text-foreground">
          See it in action
        </h2>
        <p className="text-muted-foreground text-sm mt-2 leading-relaxed">
          Real answers. Real clause numbers.{"\n"}Every time.
        </p>
      </div>

      <div className="space-y-4 max-w-md mx-auto">
        {/* Card 1 — AI Compliance */}
        <div className={cardClass(0)}>
          <p className="text-xs text-muted-foreground font-medium mb-2">AI Compliance Chat</p>
          <div className="flex justify-end mb-2">
            <div className="bg-primary text-primary-foreground rounded-2xl rounded-br-md px-4 py-3 max-w-[85%]">
              <p className="text-sm">What's the maximum height for a residential handrail?</p>
            </div>
          </div>
          <Card className="p-4">
            <p className="text-sm text-card-foreground leading-relaxed">
              Handrails on stairways in residential buildings must be between 865 mm and 1000 mm high, measured vertically above the nosing line.
            </p>
            <div className="flex flex-wrap gap-1.5 mt-3">
              <Badge className="bg-primary/10 text-primary border-0 text-xs font-semibold">
                Clause D2.16
              </Badge>
              <Badge variant="secondary" className="text-xs">
                NCC Volume Two
              </Badge>
            </div>
            <div className="flex items-start gap-2 mt-3 rounded-lg bg-primary/5 p-3">
              <AlertTriangle className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
              <p className="text-xs text-primary font-medium">Verified from uploaded standard</p>
            </div>
          </Card>
        </div>

        {/* Card 2 — Calculator */}
        <div className={cardClass(1)}>
          <p className="text-xs text-muted-foreground font-medium mb-2">Standards Calculator</p>
          <Card className="p-4">
            <p className="text-sm font-bold text-foreground mb-2">Voltage Drop Calculator</p>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg font-extrabold text-foreground">4.2%</span>
                <span className="text-sm font-semibold" style={{ color: "hsl(142 71% 45%)" }}>✅ Compliant</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-3">
              <Badge className="bg-primary/10 text-primary border-0 text-xs font-semibold">
                Clause 3.6.2
              </Badge>
              <Badge variant="secondary" className="text-xs">
                AS/NZS 3000:2018
              </Badge>
            </div>
          </Card>
        </div>

        {/* Card 3 — Photo Analysis */}
        <div className={cardClass(2)}>
          <p className="text-xs text-muted-foreground font-medium mb-2">Photo Analysis — Pro</p>
          <Card className="relative overflow-hidden p-0">
            <div className="h-40 bg-gradient-to-br from-muted to-secondary flex items-center justify-center relative">
              <div className="absolute inset-0 bg-primary/20 backdrop-blur-sm" />
              <div className="relative z-10 flex flex-col items-center gap-2">
                <div className="h-12 w-12 rounded-full bg-background/80 flex items-center justify-center">
                  <Lock className="h-6 w-6 text-foreground" />
                </div>
                <p className="text-sm font-semibold text-foreground text-center px-6">
                  Photograph your job — AI checks compliance instantly
                </p>
              </div>
              <Badge className="absolute top-3 right-3 bg-primary text-primary-foreground text-xs">
                Pro Feature
              </Badge>
            </div>
          </Card>
        </div>
      </div>

      <div className="text-center mt-8 max-w-md mx-auto">
        <p className="text-sm text-muted-foreground mb-6">
          Works for any industry. Any standard. Any compliance question.
        </p>
        <Button onClick={onNext} className="w-full h-12 text-base font-bold rounded-xl">
          Get Started Free
        </Button>
        <button className="text-sm text-muted-foreground mt-4 hover:text-primary">
          View all features →
        </button>
      </div>
    </div>
  );
};

export default OnboardingDemo;
