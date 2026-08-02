import { useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { CheckCircle2, Loader2, MailWarning } from "lucide-react";
import type { EmailOtpType } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

// Supabase's default confirmation link verifies (and burns the one-time
// token) the instant it's loaded — a plain GET. Corporate email scanners and
// link-prefetchers fetch that URL automatically to check it's safe, which
// consumes the token before the person ever clicks it, so they hit
// "otp_expired" seconds after signing up. This page requires an explicit
// button click to call verifyOtp — a bot that only loads the page can't
// trigger that. Needs the "Confirm signup" email template pointed at
// {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&email={{ .Email }}
// instead of the default {{ .ConfirmationURL }}.
const AuthConfirm = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  const email = params.get("email");
  const [status, setStatus] = useState<"idle" | "verifying" | "done" | "failed">("idle");
  const [resending, setResending] = useState(false);

  const confirm = async () => {
    if (!tokenHash || !type) return;
    setStatus("verifying");
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) {
      setStatus("failed");
      return;
    }
    setStatus("done");
    setTimeout(() => navigate("/"), 800);
  };

  const resend = async () => {
    if (!email) return;
    setResending(true);
    const { error } = await supabase.auth.resend({ type: "signup", email });
    setResending(false);
    if (error) toast.error("Couldn't resend — please try signing up again.");
    else toast.success("New confirmation email sent — check your inbox.");
  };

  if (!tokenHash || !type) {
    return (
      <div className="min-h-screen flex items-center justify-center px-5 text-center">
        <div>
          <h1 className="text-xl font-bold text-foreground mb-2">Invalid confirmation link</h1>
          <p className="text-sm text-muted-foreground">
            This link is missing some information. Try signing up again, or check you copied the whole link.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-5">
      <Card className="max-w-sm w-full p-6 text-center">
        {status === "done" ? (
          <>
            <CheckCircle2 className="h-10 w-10 text-primary mx-auto mb-3" />
            <h1 className="text-lg font-bold text-foreground mb-1">Email confirmed</h1>
            <p className="text-sm text-muted-foreground">Taking you into StandAId…</p>
          </>
        ) : status === "failed" ? (
          <>
            <MailWarning className="h-10 w-10 text-destructive mx-auto mb-3" />
            <h1 className="text-lg font-bold text-foreground mb-1">That link didn't work</h1>
            <p className="text-sm text-muted-foreground mb-4">
              It may have already been used or expired. Get a fresh one below.
            </p>
            {email ? (
              <Button className="w-full" onClick={resend} disabled={resending}>
                {resending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Resend confirmation email"}
              </Button>
            ) : (
              <Link to="/auth" className="text-sm text-primary underline">Back to sign up</Link>
            )}
          </>
        ) : (
          <>
            <h1 className="text-lg font-bold text-foreground mb-1">Confirm your email</h1>
            <p className="text-sm text-muted-foreground mb-4">Tap below to activate your StandAId account.</p>
            <Button className="w-full" onClick={confirm} disabled={status === "verifying"}>
              {status === "verifying" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm email address"}
            </Button>
          </>
        )}
      </Card>
    </div>
  );
};

export default AuthConfirm;
