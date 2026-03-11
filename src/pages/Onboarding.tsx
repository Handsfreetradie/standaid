import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import OnboardingSplash from "@/components/onboarding/OnboardingSplash";
import OnboardingDemo from "@/components/onboarding/OnboardingDemo";
import OnboardingIndustry from "@/components/onboarding/OnboardingIndustry";
import OnboardingPricing from "@/components/onboarding/OnboardingPricing";
import OnboardingAccount from "@/components/onboarding/OnboardingAccount";
import OnboardingReady from "@/components/onboarding/OnboardingReady";
import ProgressDots from "@/components/onboarding/ProgressDots";
import { supabase } from "@/integrations/supabase/client";

const ONBOARDING_KEY = "standaid_onboarding_step";
const ONBOARDING_DONE_KEY = "standaid_onboarding_complete";

const Onboarding = () => {
  const navigate = useNavigate();
  const savedStep = parseInt(localStorage.getItem(ONBOARDING_KEY) || "0", 10);
  const [step, setStep] = useState(savedStep);
  const [selectedIndustries, setSelectedIndustries] = useState<string[]>([]);
  const [firstName, setFirstName] = useState("");

  useEffect(() => {
    localStorage.setItem(ONBOARDING_KEY, String(step));
  }, [step]);

  const finish = () => {
    localStorage.setItem(ONBOARDING_DONE_KEY, "true");
    localStorage.removeItem(ONBOARDING_KEY);
    navigate("/", { replace: true });
  };

  const goSignIn = () => {
    localStorage.setItem(ONBOARDING_DONE_KEY, "true");
    localStorage.removeItem(ONBOARDING_KEY);
    navigate("/auth", { replace: true });
  };

  // Save industries to profile when selected
  const handleIndustryNext = async (industries: string[]) => {
    setSelectedIndustries(industries);
    // Save to profile if user is already authed
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      await supabase
        .from("profiles")
        .update({ trade_type: industries.join(",") })
        .eq("user_id", session.user.id);
    }
    setStep(3);
  };

  // Show progress dots on screens 2–4 (indices 2, 3, 4 map to dot indices 0, 1, 2)
  const showDots = step >= 2 && step <= 4;

  return (
    <div className="relative">
      {showDots && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-sm pt-safe">
          <ProgressDots total={3} current={step - 2} />
        </div>
      )}

      {step === 0 && <OnboardingSplash onNext={() => setStep(1)} />}
      {step === 1 && (
        <OnboardingDemo onNext={() => setStep(2)} onSkip={() => setStep(2)} />
      )}
      {step === 2 && (
        <OnboardingIndustry
          onNext={handleIndustryNext}
          onBack={() => setStep(1)}
        />
      )}
      {step === 3 && (
        <OnboardingPricing
          onNext={() => setStep(4)}
          onBack={() => setStep(2)}
        />
      )}
      {step === 4 && (
        <OnboardingAccount
          onNext={(name) => {
            setFirstName(name);
            setStep(5);
          }}
          onBack={() => setStep(3)}
          onSignIn={goSignIn}
        />
      )}
      {step === 5 && (
        <OnboardingReady
          firstName={firstName}
          industryCount={selectedIndustries.length}
          onFinish={finish}
        />
      )}
    </div>
  );
};

export default Onboarding;
