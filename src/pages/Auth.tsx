import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Mail, Lock, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

const Auth = () => {
  const [isSignUp, setIsSignUp] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [signupSent, setSignupSent] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const { signIn, signUp, resetPassword, resendConfirmation } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearInterval(timer);
  }, [resendCooldown > 0]);

  const handleResend = async () => {
    setLoading(true);
    try {
      const { error } = await resendConfirmation(email);
      if (error) {
        toast.error(error.message);
      } else {
        toast.success("Confirmation email resent");
        setResendCooldown(60);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    if (isSignUp && password.length < 12) {
      toast.error("Password must be at least 12 characters");
      return;
    }

    setLoading(true);
    try {
      if (isSignUp) {
        const { error } = await signUp(email, password);
        if (error) {
          toast.error(error.message);
        } else {
          setSignupSent(true);
          setResendCooldown(60);
        }
      } else {
        const { error } = await signIn(email, password);
        if (error) {
          toast.error(error.message);
        } else {
          navigate("/");
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    try {
      const { error } = await resetPassword(email);
      if (error) {
        toast.error(error.message);
      } else {
        setResetSent(true);
      }
    } finally {
      setLoading(false);
    }
  };

  // ── FORGOT PASSWORD ──
  if (isForgotPassword) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-5 bg-background">
        <h1 className="mb-8 text-[64px] font-bold tracking-[-0.02em] leading-tight">
          <span className="text-foreground">Stand</span>
          <span className="text-primary">A</span>
          <span className="text-primary">I</span>
          <span className="text-foreground">d</span>
        </h1>

        <Card className="w-full max-w-sm p-6">
          {resetSent ? (
            <>
              <h2 className="font-display text-xl font-bold text-foreground mb-1">Check your inbox</h2>
              <p className="text-sm text-muted-foreground mb-6">
                We've sent a password reset link to <strong>{email}</strong>. Follow the link in the email to set a new password.
              </p>
              <Button
                variant="outline"
                className="w-full h-11"
                onClick={() => { setIsForgotPassword(false); setResetSent(false); }}
              >
                Back to sign in
              </Button>
            </>
          ) : (
            <>
              <h2 className="font-display text-xl font-bold text-foreground mb-1">Reset password</h2>
              <p className="text-sm text-muted-foreground mb-6">
                Enter your email and we'll send you a reset link.
              </p>
              <form onSubmit={handleReset} className="space-y-4">
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="email"
                    placeholder="Email address"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-9 h-11"
                    required
                  />
                </div>
                <Button type="submit" className="w-full h-11 font-semibold" disabled={loading}>
                  {loading ? "Sending..." : "Send reset link"}
                </Button>
              </form>
              <p className="text-sm text-center text-muted-foreground mt-6">
                <button
                  type="button"
                  onClick={() => setIsForgotPassword(false)}
                  className="text-primary font-semibold hover:underline"
                >
                  Back to sign in
                </button>
              </p>
            </>
          )}
        </Card>
      </div>
    );
  }

  // ── CHECK YOUR EMAIL (post sign-up) ──
  if (signupSent) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-5 bg-background">
        <h1 className="mb-8 text-[64px] font-bold tracking-[-0.02em] leading-tight">
          <span className="text-foreground">Stand</span>
          <span className="text-primary">A</span>
          <span className="text-primary">I</span>
          <span className="text-foreground">d</span>
        </h1>

        <Card className="w-full max-w-sm p-6">
          <h2 className="font-display text-xl font-bold text-foreground mb-1">Check your inbox</h2>
          <p className="text-sm text-muted-foreground mb-2">
            We've sent a confirmation link to <strong>{email}</strong>. Click it to activate your account.
          </p>
          <p className="text-sm text-muted-foreground mb-6">
            Can't see it? Check your <strong>junk / spam folder</strong> — it can take a minute or two to land.
          </p>
          <Button
            variant="outline"
            className="w-full h-11"
            onClick={handleResend}
            disabled={loading || resendCooldown > 0}
          >
            {resendCooldown > 0 ? `Resend email (${resendCooldown}s)` : "Resend email"}
          </Button>
          <button
            type="button"
            onClick={() => { setSignupSent(false); setIsSignUp(false); }}
            className="text-sm text-center text-muted-foreground hover:text-foreground hover:underline w-full mt-4"
          >
            Back to sign in
          </button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-5 bg-background">
      <h1 className="mb-8 text-[64px] font-bold tracking-[-0.02em] leading-tight">
        <span className="text-foreground">Stand</span>
        <span className="text-primary">A</span>
        <span className="text-primary">I</span>
        <span className="text-foreground">d</span>
      </h1>

      <Card className="w-full max-w-sm p-6">
        <h2 className="font-sans text-xl font-bold text-foreground mb-1">
          {isSignUp ? "Create account" : "Welcome back"}
        </h2>
        <p className="text-sm text-muted-foreground mb-6">
          {isSignUp
            ? "Get started with your compliance assistant"
            : "Sign in to your account"}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="pl-9 h-11"
              required
            />
          </div>
          <div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type={showPassword ? "text" : "password"}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pl-9 pr-10 h-11"
                required
                minLength={isSignUp ? 8 : undefined}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Eye className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
            </div>
            {isSignUp && (
              <p className="text-xs text-muted-foreground mt-1">Minimum 12 characters</p>
            )}
          </div>
          <Button type="submit" className="w-full h-11 font-semibold" disabled={loading}>
            {loading ? "Please wait..." : isSignUp ? "Create Account" : "Sign In"}
          </Button>
          {!isSignUp && (
            <p className="text-sm text-center">
              <button
                type="button"
                onClick={() => setIsForgotPassword(true)}
                className="text-muted-foreground hover:text-foreground hover:underline"
              >
                Forgot password?
              </button>
            </p>
          )}
        </form>

        <p className="text-sm text-center text-muted-foreground mt-6">
          {isSignUp ? "Already have an account?" : "Don't have an account?"}{" "}
          <button
            onClick={() => setIsSignUp(!isSignUp)}
            className="text-primary font-semibold hover:underline"
          >
            {isSignUp ? "Sign in" : "Sign up"}
          </button>
        </p>
      </Card>
    </div>
  );
};

export default Auth;
