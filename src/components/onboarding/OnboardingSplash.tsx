import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  onNext: () => void;
}

const OnboardingSplash = ({ onNext }: Props) => {
  const [logoVisible, setLogoVisible] = useState(false);
  const [buttonVisible, setButtonVisible] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setLogoVisible(true), 100);
    const t2 = setTimeout(() => setButtonVisible(true), 500);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6">
      <div
        className={`text-center transition-all duration-[400ms] ease-out ${
          logoVisible ? "opacity-100 scale-100" : "opacity-0 scale-[0.95]"
        }`}
      >
        <h1 className="font-display text-[48px] font-extrabold tracking-tight leading-tight">
          <span className="text-foreground">Stand</span>
          <span className="text-primary">Ai</span><span className="text-foreground">d</span>
        </h1>
        <p className="text-muted-foreground text-lg mt-3">
          Know your standard. On every job.
        </p>
      </div>

      <div
        className={`mt-12 w-full max-w-xs transition-all duration-[400ms] ease-out ${
          buttonVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
        }`}
      >
        <Button
          onClick={onNext}
          className="w-full h-14 text-base font-bold rounded-xl"
        >
          Get Started — It's Free
        </Button>
        <p className="text-muted-foreground text-sm text-center mt-3">
          No credit card required
        </p>
      </div>
    </div>
  );
};

export default OnboardingSplash;
