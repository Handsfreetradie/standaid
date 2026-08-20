import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { User, ChevronRight, ChevronDown, Shield, Zap, HelpCircle, LogOut, CreditCard, Bell, Mail, ExternalLink, CheckCircle2, BookOpen, FileText, CalendarDays, Loader2, Users, Gift, UserCog, Image as ImageIcon, X, AlertTriangle, RefreshCw, Trash2, Receipt } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { useProfile, useStandards, useOrganization, useSubscription } from "@/hooks/useData";
import { supabase } from "@/integrations/supabase/client";
import { compressImageToBlob } from "@/lib/image";

const TRADE_LABELS: Record<string, string> = {
  electrical: "Electrical",
  plumbing: "Plumbing",
  building: "Building & Construction",
  carpentry: "Carpentry",
  gas: "Gas Fitting",
  hvac: "HVAC",
  health_safety: "Health & Safety",
  engineering: "Engineering",
  food_safety: "Food Safety",
  other: "Other",
};

const FAQS = [
  {
    q: "How do I upload a standard?",
    a: "Go to the Standards tab, tap the upload button, and select your PDF. StandAId will process and index it automatically — usually takes 1–2 minutes.",
  },
  {
    q: "What standards can I upload?",
    a: "Any Australian Standard in PDF format, for AI search and chat — plumbing codes, building codes, NCC, and more. AS/NZS standards (e.g. AS/NZS 3000, AS 3017) can still be uploaded and viewed, but Standards Australia's licensing terms mean AI features aren't available for them.",
  },
  {
    q: "How accurate are the AI answers?",
    a: "StandAId retrieves exact clause text from your uploaded standard and cites the source. Always verify critical decisions against the original document.",
  },
  {
    q: "Can I upload multiple standards?",
    a: "Yes — upload as many as you need. The AI searches across all your standards to find the most relevant clause for each question.",
  },
];

// Only Kyle sees the "Grant Free Trial" tool — no app-wide admin/roles
// concept exists yet, so this is a single hardcoded check, same style as
// other small inline constants in this codebase.
const ADMIN_EMAIL = "kyledixonelectrical@gmail.com";

const Profile = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, signOut } = useAuth();
  const { data: profile, isLoading: profileLoading } = useProfile();
  const { data: subscription } = useSubscription();
  const { data: standards } = useStandards();
  const { data: org } = useOrganization();
  const [activePanel, setActivePanel] = useState<string | null>(null);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [notifFeatures, setNotifFeatures] = useState(() =>
    localStorage.getItem("notif_features") !== "false"
  );
  const [notifStandards, setNotifStandards] = useState(() =>
    localStorage.getItem("notif_standards") !== "false"
  );

  const handleSignOut = async () => {
    try {
      await signOut();
    } finally {
      // Belt-and-braces: always redirect even if signOut throws
      window.location.href = "/auth";
    }
  };

  const togglePanel = (panel: string) =>
    setActivePanel((prev) => (prev === panel ? null : panel));

  const [editName, setEditName] = useState("");
  const [editTrades, setEditTrades] = useState<string[]>([]);
  const [editBusinessName, setEditBusinessName] = useState("");
  const [editLicenceNumber, setEditLicenceNumber] = useState("");
  const [logoPath, setLogoPath] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const sbAny = supabase as any; // profiles' new business/logo columns aren't in the generated types yet

  // Sync the edit fields whenever the profile loads/changes, not on every
  // render — otherwise typing would get clobbered by the next refetch.
  useEffect(() => {
    if (!profile) return;
    const p = profile as any;
    setEditName(p.display_name || "");
    setEditTrades(p.trade_type ? p.trade_type.split(",").filter(Boolean) : []);
    setEditBusinessName(p.business_name || "");
    setEditLicenceNumber(p.licence_number || "");
    setLogoPath(p.logo_storage_path || null);
  }, [profile]);

  // Resolve the logo's signed URL for preview whenever the stored path changes.
  useEffect(() => {
    if (!logoPath) { setLogoUrl(null); return; }
    let cancelled = false;
    supabase.storage.from("business-logos").createSignedUrl(logoPath, 3600).then(({ data }) => {
      if (!cancelled && data?.signedUrl) setLogoUrl(data.signedUrl);
    });
    return () => { cancelled = true; };
  }, [logoPath]);

  const toggleEditTrade = (id: string) => {
    setEditTrades((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  };

  const onLogoPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !user) return;
    setUploadingLogo(true);
    try {
      const blob = await compressImageToBlob(file, 512, 0.85);
      const path = `${user.id}/logo.jpg`;
      const { error } = await supabase.storage.from("business-logos").upload(path, blob, { contentType: "image/jpeg", upsert: true });
      if (error) throw error;
      setLogoPath(path);
      toast.success("Logo uploaded — tap Save changes to keep it.");
    } catch (e) {
      console.error("[profile] logo upload error:", e);
      toast.error("Couldn't upload that logo.");
    } finally {
      setUploadingLogo(false);
    }
  };

  const saveProfileEdits = async () => {
    if (!user || savingProfile) return;
    setSavingProfile(true);
    try {
      const { error } = await sbAny
        .from("profiles")
        .update({
          display_name: editName.trim() || null,
          trade_type: editTrades.join(","),
          business_name: editBusinessName.trim() || null,
          licence_number: editLicenceNumber.trim() || null,
          logo_storage_path: logoPath,
        })
        .eq("user_id", user.id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      toast.success("Profile updated");
    } catch (e) {
      console.error("[profile] save error:", e);
      toast.error("Couldn't save — please try again.");
    } finally {
      setSavingProfile(false);
    }
  };

  const [billingBusy, setBillingBusy] = useState(false);

  // Surface the outcome when Stripe redirects back to /profile.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("checkout");
    if (outcome === "success") toast.success("Subscription active — thanks for upgrading!");
    else if (outcome === "cancelled") toast("Checkout cancelled — no charge made.");
    if (outcome) window.history.replaceState({}, "", "/profile");
  }, []);

  // Which billing cycle pending Pro/Business checkouts use — shared by every
  // upgrade button on this page so they all agree.
  const [billingInterval, setBillingInterval] = useState<"monthly" | "annual">("monthly");
  const proPrice = billingInterval === "annual" ? "$7.42/mo" : "$9.99/mo";
  const businessPrice = billingInterval === "annual" ? "$37.42/mo" : "$49.99/mo";

  // Start a Stripe Checkout session for the chosen tier and redirect to it.
  const startCheckout = async (chosenTier: "pro" | "business") => {
    if (billingBusy) return;
    setBillingBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-checkout", {
        body: { tier: chosenTier, interval: billingInterval },
      });
      if (error || !data?.url) throw error ?? new Error("No checkout URL");
      window.location.href = data.url;
    } catch (e) {
      console.error("[checkout] error:", e);
      toast.error("Couldn't start checkout — please try again.");
      setBillingBusy(false);
    }
  };

  // Open the Stripe billing portal so the user can manage or cancel.
  const openPortal = async () => {
    if (billingBusy) return;
    setBillingBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("customer-portal", { body: {} });
      if (error || !data?.url) throw error ?? new Error("No portal URL");
      window.location.href = data.url;
    } catch (e) {
      console.error("[portal] error:", e);
      toast.error("Couldn't open the billing portal — please try again.");
      setBillingBusy(false);
    }
  };

  const setNotif = (key: string, value: boolean, setter: (v: boolean) => void) => {
    setter(value);
    localStorage.setItem(key, String(value));
  };

  const isAdmin = user?.email === ADMIN_EMAIL;
  const [grantEmail, setGrantEmail] = useState("");
  const [grantDays, setGrantDays] = useState("14");
  const [granting, setGranting] = useState(false);

  const grantTrial = async () => {
    const email = grantEmail.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      toast.error("Enter a valid email address.");
      return;
    }
    const days = Number(grantDays);
    if (!Number.isInteger(days) || days < 1 || days > 90) {
      toast.error("Days must be a whole number between 1 and 90.");
      return;
    }
    setGranting(true);
    try {
      const { data, error } = await supabase.functions.invoke("grant-trial", { body: { email, days } });
      if (error) throw error;
      toast.success(
        data?.isNewAccount
          ? `Invite sent to ${email} — ${days} days free Pro waiting for them.`
          : `${email} now has ${days} days free Pro — they'll get an email too.`
      );
      setGrantEmail("");
    } catch (e: any) {
      console.error("[grant trial] error:", e);
      toast.error(e?.message || "Couldn't grant that trial — please try again.");
    } finally {
      setGranting(false);
    }
  };

  type AdminUserRow = {
    user_id: string;
    email: string | null;
    display_name: string | null;
    subscription_tier: string | null;
    created_at: string;
    pro_expires_at: string | null;
    query_count: number;
    total_cost_usd: number;
    email_confirmed: boolean;
  };
  const [adminUsers, setAdminUsers] = useState<AdminUserRow[] | null>(null);
  const [adminUsersLoading, setAdminUsersLoading] = useState(false);
  const [adminTotalCost, setAdminTotalCost] = useState<number | null>(null);

  const loadAdminUsers = async () => {
    setAdminUsersLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-users", { body: {} });
      if (error) throw error;
      setAdminUsers(data?.users ?? []);
      setAdminTotalCost(typeof data?.total_cost_usd === "number" ? data.total_cost_usd : null);
    } catch (e: any) {
      console.error("[admin users] error:", e);
      toast.error(e?.message || "Couldn't load the users list.");
    } finally {
      setAdminUsersLoading(false);
    }
  };

  const formatCost = (n: number) => n < 0.01 && n > 0 ? "<$0.01" : `$${n.toFixed(2)}`;

  type FailedStandardRow = {
    id: string;
    title: string;
    standard_code: string | null;
    user_id: string;
    email: string;
    failed_chunks_count: number;
    failed_chunks_labels: string[];
    extraction_quality_score: number | null;
    total_chunks: number | null;
    indexed_chunks: number | null;
    created_at: string;
  };
  const [failedStandards, setFailedStandards] = useState<FailedStandardRow[] | null>(null);
  const [failedStandardsLoading, setFailedStandardsLoading] = useState(false);
  const [retryingStandardId, setRetryingStandardId] = useState<string | null>(null);

  const loadFailedStandards = async () => {
    setFailedStandardsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-failed-extractions", { body: {} });
      if (error) throw error;
      setFailedStandards(data?.standards ?? []);
    } catch (e: any) {
      console.error("[admin failed extractions] error:", e);
      toast.error(e?.message || "Couldn't load failed extractions.");
    } finally {
      setFailedStandardsLoading(false);
    }
  };

  // Targeted fix, not a full reprocess: re-reads just the couple of pages
  // around each permanently-failed table/figure and re-runs the (fixed)
  // caption-detection logic there — a few pages of vision input per failed
  // item instead of the whole document. Runs synchronously and returns the
  // actual outcome (fixed / correctly-removed-as-not-a-real-caption / still
  // failed) in this one request — no separate "check back later" step.
  const retryFailedStandard = async (standardId: string) => {
    setRetryingStandardId(standardId);
    try {
      const { data, error } = await supabase.functions.invoke("admin-failed-extractions", {
        body: { action: "retry", standard_id: standardId },
      });
      if (error) throw error;
      if (data?.error) {
        toast.error(data.error);
      } else {
        const fixed = data?.fixed ?? 0;
        const removed = data?.removed_as_false_match ?? 0;
        const stillFailed = data?.still_failed ?? 0;
        const parts = [];
        if (fixed) parts.push(`${fixed} fixed`);
        if (removed) parts.push(`${removed} weren't real captions and were cleared`);
        if (stillFailed) parts.push(`${stillFailed} still failed`);
        toast.success(parts.length ? parts.join(", ") : "No failed tables/figures left to fix.");
        loadFailedStandards();
      }
    } catch (e: any) {
      toast.error(e?.message || "Couldn't run targeted recovery.");
    } finally {
      setRetryingStandardId(null);
    }
  };

  const displayName = profile?.display_name || user?.email?.split("@")[0] || "Tradie";
  const tradeLabel = profile?.trade_type
    ? profile.trade_type.split(",").filter(Boolean).map((id) => TRADE_LABELS[id] || id).join(", ")
    : null;
  // No fallback guess here — while the profile is still loading, `tier` is
  // undefined so isPro is false rather than silently claiming a tier the
  // user might not actually have (see the loading guard on the summary line).
  const tier = profile?.subscription_tier;
  const planLabel = tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : "";
  const queriesUsed = profile?.daily_query_count || 0;
  const isPro = tier === "pro" || tier === "business";
  // pro_expires_at is only ever set for trials/promos (see
  // 20260721000000_promo_pro_expiry.sql) — real paid Stripe subscribers
  // never have it set, so its presence alone identifies a trial.
  const trialDaysLeft = profile?.pro_expires_at
    ? Math.max(0, Math.ceil((new Date(profile.pro_expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;

  const readyStandards = (standards || []).filter((s: any) => s.extraction_status === "complete");
  const totalClauses = (standards || []).reduce((sum: number, s: any) => sum + (s.indexed_chunks || 0), 0);
  const memberSince = user?.created_at
    ? new Date(user.created_at).toLocaleDateString("en-AU", { month: "short", year: "numeric" })
    : null;

  return (
    <div className="h-full overflow-y-auto">
      {/* md:justify-center vertically centres the content block on desktop —
          it used to hug the top-left of the viewport with a sea of empty
          space below (especially for Pro users, who have no plan-comparison
          cards). Mobile keeps the natural top-aligned scroll flow. */}
      <div className="min-h-full px-5 py-6 pb-24 md:py-10 max-w-5xl md:mx-auto flex flex-col md:justify-center">
        <div className="md:grid md:grid-cols-5 md:gap-10 md:items-start">

          {/* Left column: identity + plan */}
          <div className="md:col-span-2 mb-6 md:mb-0">
            {/* User Info */}
            <div className="flex items-center gap-4 mb-6">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                <User className="h-7 w-7 text-primary" />
              </div>
              <div>
                <h1 className="font-sans text-xl font-bold text-foreground">{displayName}</h1>
                <p className="text-sm text-muted-foreground">
                  {tradeLabel || "Set your trade below"}
                </p>
              </div>
            </div>

            {/* Current Plan */}
            <Card className="border-primary/20 bg-primary/5 p-4 mb-6">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-primary" />
                  <span className="text-sm font-bold text-foreground capitalize">{tier} Plan</span>
                </div>
                <Badge className="bg-primary text-primary-foreground text-xs">
                  {trialDaysLeft !== null ? `Trial — ${trialDaysLeft}d left` : "Current"}
                </Badge>
              </div>
              <div className="space-y-2 mb-4">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Daily queries</span>
                  <span className="font-semibold text-foreground">
                    {isPro ? "Unlimited" : `${queriesUsed} / 5 used`}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Clause references</span>
                  <span className={`font-semibold ${isPro ? "text-foreground" : "text-primary"}`}>
                    {isPro ? "Full access" : "Teaser only"}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Voice input</span>
                  <span className={`font-semibold ${isPro ? "text-foreground" : "text-muted-foreground"}`}>
                    {isPro ? "Included" : "Pro only"}
                  </span>
                </div>
              </div>
              {(!isPro || trialDaysLeft !== null) && (
                <>
                  <div className="flex items-center justify-center gap-2 mb-3">
                    <span className={`text-xs font-medium ${billingInterval === "monthly" ? "text-foreground" : "text-muted-foreground"}`}>
                      Monthly
                    </span>
                    <Switch
                      checked={billingInterval === "annual"}
                      onCheckedChange={(checked) => setBillingInterval(checked ? "annual" : "monthly")}
                    />
                    <span className={`text-xs font-medium ${billingInterval === "annual" ? "text-foreground" : "text-muted-foreground"}`}>
                      Annual
                    </span>
                    {billingInterval === "annual" && (
                      <Badge className="bg-primary text-primary-foreground text-[10px] px-1.5 py-0">Save 26%</Badge>
                    )}
                  </div>
                  <Button
                    className="w-full h-11 text-sm font-semibold gap-1.5"
                    disabled={billingBusy}
                    onClick={() => startCheckout("pro")}
                  >
                    {billingBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                    {trialDaysLeft !== null ? "Keep Pro — subscribe now" : `Upgrade to Pro — ${proPrice}`}
                  </Button>
                  {billingInterval === "annual" && (
                    <p className="text-[10px] text-muted-foreground text-center mt-1.5">$89/year, billed annually</p>
                  )}
                </>
              )}
            </Card>

            {/* Your Library — fills the left column with real account data */}
            <Card className="p-4 mb-6">
              <h2 className="text-sm font-bold text-foreground mb-3">Your Library</h2>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-muted/50 py-3 px-1">
                  <BookOpen className="h-4 w-4 text-primary mx-auto mb-1.5" />
                  <p className="text-lg font-extrabold text-foreground leading-none">{readyStandards.length}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">Standards ready</p>
                </div>
                <div className="rounded-lg bg-muted/50 py-3 px-1">
                  <FileText className="h-4 w-4 text-primary mx-auto mb-1.5" />
                  <p className="text-lg font-extrabold text-foreground leading-none">{totalClauses.toLocaleString("en-AU")}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">Clauses searchable</p>
                </div>
                <div className="rounded-lg bg-muted/50 py-3 px-1">
                  <CalendarDays className="h-4 w-4 text-primary mx-auto mb-1.5" />
                  <p className="text-lg font-extrabold text-foreground leading-none">{memberSince ?? "—"}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">Member since</p>
                </div>
              </div>
              {readyStandards.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {readyStandards.slice(0, 4).map((s: any) => (
                    <div key={s.id} className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2">
                      <span className="text-xs font-medium text-foreground truncate mr-2">
                        {s.standard_code || s.title}
                      </span>
                      <span className="text-[10px] text-muted-foreground flex-shrink-0">
                        {(s.indexed_chunks || 0).toLocaleString("en-AU")} clauses
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Plan Comparison — free tier only */}
            {!isPro && (
              <>
                <h2 className="font-sans text-lg font-bold text-foreground mb-3">Compare Plans</h2>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { name: "Free", price: "$0", features: ["1 standard", "3 queries/day", "Partial clauses"] },
                    { name: "Pro", price: billingInterval === "annual" ? "$7.42" : "$9.99", features: ["Unlimited", "Unlimited", "Full clauses", "Voice & Photo"], highlight: true, tier: "pro" as const },
                    { name: "Business", price: billingInterval === "annual" ? "$37.42" : "$49.99", features: ["Everything in Pro", "Single login", "Priority support"], tier: "business" as const, showTeamLink: true },
                  ].map((plan) => (
                    <Card
                      key={plan.name}
                      className={`p-3 text-center flex flex-col ${plan.highlight ? "border-primary ring-1 ring-primary" : ""}`}
                    >
                      <p className="text-xs font-bold text-foreground">{plan.name}</p>
                      <p className="text-lg font-extrabold text-foreground mt-1">{plan.price}</p>
                      <p className="text-[10px] text-muted-foreground">{plan.price === "$0" ? "" : billingInterval === "annual" ? "/mo, billed yearly" : "/month"}</p>
                      <Separator className="my-2" />
                      <div className="space-y-1 flex-1">
                        {plan.features.map((f) => (
                          <p key={f} className="text-[10px] text-muted-foreground">{f}</p>
                        ))}
                      </div>
                      {plan.tier && (
                        <Button
                          size="sm"
                          variant={plan.highlight ? "default" : "outline"}
                          className="w-full mt-2 h-7 text-[10px]"
                          disabled={billingBusy}
                          onClick={() => startCheckout(plan.tier)}
                        >
                          Upgrade
                        </Button>
                      )}
                      {plan.showTeamLink && (
                        <button
                          className="w-full mt-1.5 text-[9px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                          onClick={() => navigate("/team")}
                        >
                          Need multiple seats? Set up a team
                        </button>
                      )}
                    </Card>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Right column: settings */}
          <div className="md:col-span-3 flex flex-col gap-6">
            <div>
              <h2 className="hidden md:block font-sans text-lg font-bold text-foreground mb-3">Settings</h2>
              <Card className="p-2 md:p-3 divide-y divide-border">

                {/* Edit Profile */}
                <div>
                  <button
                    onClick={() => togglePanel("edit-profile")}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-foreground hover:bg-secondary transition-colors min-h-[44px]"
                  >
                    <UserCog className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
                    <div className="flex-1 text-left">
                      <span className="block">Edit Profile</span>
                      <span className="block text-xs text-muted-foreground font-normal mt-0.5">Name & trade</span>
                    </div>
                    {activePanel === "edit-profile"
                      ? <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      : <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    }
                  </button>
                  {activePanel === "edit-profile" && (
                    <div className="px-3 pb-4 pt-1 space-y-3">
                      <div>
                        <Label className="text-xs">Name</Label>
                        <Input
                          className="h-11 mt-1"
                          placeholder="Your name"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Trade(s)</Label>
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {Object.entries(TRADE_LABELS).map(([id, label]) => (
                            <Badge
                              key={id}
                              variant={editTrades.includes(id) ? "default" : "outline"}
                              className="cursor-pointer text-[11px] px-2 py-1"
                              onClick={() => toggleEditTrade(id)}
                            >
                              {label}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      <Separator />
                      <p className="text-xs font-semibold text-foreground -mb-1">Used on Site Audit reports</p>
                      <div>
                        <Label className="text-xs">Business name</Label>
                        <Input
                          className="h-11 mt-1"
                          placeholder="Falls back to your name if left blank"
                          value={editBusinessName}
                          onChange={(e) => setEditBusinessName(e.target.value)}
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Licence number</Label>
                        <Input
                          className="h-11 mt-1"
                          placeholder="e.g. EC 123456"
                          value={editLicenceNumber}
                          onChange={(e) => setEditLicenceNumber(e.target.value)}
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Business logo</Label>
                        <div className="flex items-center gap-3 mt-1.5">
                          <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-lg border border-border bg-muted/30 overflow-hidden">
                            {logoUrl ? (
                              <img src={logoUrl} alt="Business logo" className="h-full w-full object-contain" />
                            ) : (
                              <ImageIcon className="h-5 w-5 text-muted-foreground" />
                            )}
                          </div>
                          <div className="flex flex-col gap-1">
                            <label>
                              <input type="file" accept="image/*" className="hidden" onChange={onLogoPicked} disabled={uploadingLogo} />
                              <span className="inline-flex h-8 cursor-pointer items-center rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-secondary">
                                {uploadingLogo ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                                {logoPath ? "Replace logo" : "Upload logo"}
                              </span>
                            </label>
                            {logoPath && (
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
                                onClick={() => { setLogoPath(null); setLogoUrl(null); }}
                              >
                                <X className="h-3 w-3" /> Remove
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                      <Button className="w-full h-11 gap-1.5" disabled={savingProfile} onClick={saveProfileEdits}>
                        {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save changes"}
                      </Button>
                    </div>
                  )}
                </div>

                {/* Subscription & Billing */}
                <div>
                  <button
                    onClick={() => togglePanel("billing")}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-foreground hover:bg-secondary transition-colors min-h-[44px]"
                  >
                    <CreditCard className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
                    <div className="flex-1 text-left">
                      <span className="block">Subscription & Billing</span>
                      <span className="block text-xs text-muted-foreground font-normal mt-0.5">
                        {profileLoading
                          ? "Loading…"
                          : trialDaysLeft !== null
                          ? `${planLabel} trial — ${trialDaysLeft}d left`
                          : isPro
                          ? `${planLabel} plan active`
                          : "Free plan"}
                      </span>
                    </div>
                    {activePanel === "billing"
                      ? <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      : <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    }
                  </button>
                  {activePanel === "billing" && (
                    <div className="px-3 pb-4 pt-1 space-y-3">
                      <div className="rounded-lg bg-muted/50 p-3 space-y-2.5">
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Plan</span>
                          <span className="font-semibold capitalize text-foreground">{tier || "Free"}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Price</span>
                          <span className="font-semibold text-foreground">
                            {trialDaysLeft !== null
                              ? "Free during trial"
                              : !isPro
                              ? "Free"
                              : org
                              ? "Per-seat billing"
                              : subscription?.interval === "year"
                              ? "Billed annually"
                              : "Billed monthly"}
                          </span>
                        </div>
                        {trialDaysLeft !== null && (
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Trial ends</span>
                            <span className="font-semibold text-foreground">
                              {trialDaysLeft === 0 ? "Today" : `In ${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"}`}
                            </span>
                          </div>
                        )}
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Status</span>
                          <span className="flex items-center gap-1 font-semibold text-green-600">
                            <CheckCircle2 className="h-3 w-3" /> Active
                          </span>
                        </div>
                      </div>
                      {isPro && trialDaysLeft === null ? (
                        <>
                          <div className="space-y-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="w-full gap-1.5"
                              disabled={billingBusy}
                              onClick={openPortal}
                            >
                              {billingBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Receipt className="h-3.5 w-3.5" />}
                              View Invoices & Receipts
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              className="w-full gap-1.5"
                              disabled={billingBusy}
                              onClick={openPortal}
                            >
                              {billingBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                              Cancel Subscription
                            </Button>
                          </div>
                          {org && (
                            <Button
                              size="sm"
                              className="w-full gap-1.5"
                              onClick={() => navigate("/team")}
                            >
                              <Users className="h-3.5 w-3.5" />
                              Manage Team
                            </Button>
                          )}
                        </>
                      ) : (
                        <Button
                          size="sm"
                          className="w-full gap-1.5"
                          disabled={billingBusy}
                          onClick={() => startCheckout("pro")}
                        >
                          {billingBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                          {trialDaysLeft !== null ? "Keep Pro — subscribe now" : `Upgrade to Pro — ${proPrice}`}
                        </Button>
                      )}
                      <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 space-y-1.5">
                        <p className="text-xs font-medium text-amber-900 dark:text-amber-100">
                          {subscription?.interval === "year" ? "Annual Billing" : "Monthly Billing"}
                        </p>
                        <p className="text-xs text-amber-800 dark:text-amber-200 leading-relaxed">
                          Your subscription renews automatically each {subscription?.interval === "year" ? "year" : "month"}. You can view past invoices, update your payment method, or cancel anytime in the buttons above.
                        </p>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Questions about billing? Contact us at{" "}
                        <a href="mailto:hello@standaid.ai" className="text-primary underline">
                          hello@standaid.ai
                        </a>
                      </p>
                    </div>
                  )}
                </div>

                {/* Notifications */}
                <div>
                  <button
                    onClick={() => togglePanel("notifications")}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-foreground hover:bg-secondary transition-colors min-h-[44px]"
                  >
                    <Bell className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
                    <div className="flex-1 text-left">
                      <span className="block">Notifications</span>
                    </div>
                    {activePanel === "notifications"
                      ? <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      : <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    }
                  </button>
                  {activePanel === "notifications" && (
                    <div className="px-3 pb-4 pt-1 space-y-2">
                      {[
                        {
                          key: "notif_features",
                          label: "Feature updates",
                          sub: "New tools and improvements to StandAId",
                          value: notifFeatures,
                          setter: (v: boolean) => setNotif("notif_features", v, setNotifFeatures),
                        },
                        {
                          key: "notif_standards",
                          label: "Standard alerts",
                          sub: "When Australian Standards you use are revised",
                          value: notifStandards,
                          setter: (v: boolean) => setNotif("notif_standards", v, setNotifStandards),
                        },
                      ].map(({ key, label, sub, value, setter }) => (
                        <div key={key} className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-3">
                          <div className="flex-1 mr-3">
                            <p className="text-xs font-medium text-foreground">{label}</p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>
                          </div>
                          <Switch checked={value} onCheckedChange={setter} />
                        </div>
                      ))}
                      <p className="text-[11px] text-muted-foreground px-1">
                        Push notifications coming soon. Preferences saved locally.
                      </p>
                    </div>
                  )}
                </div>

                {/* Help & Support */}
                <div>
                  <button
                    onClick={() => togglePanel("help")}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-foreground hover:bg-secondary transition-colors min-h-[44px]"
                  >
                    <HelpCircle className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
                    <div className="flex-1 text-left">
                      <span className="block">Help & Support</span>
                    </div>
                    {activePanel === "help"
                      ? <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      : <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    }
                  </button>
                  {activePanel === "help" && (
                    <div className="px-3 pb-4 pt-1 space-y-3">
                      {/* FAQs */}
                      <div className="space-y-1.5">
                        {FAQS.map((faq, i) => (
                          <div key={i} className="rounded-lg border border-border overflow-hidden">
                            <button
                              onClick={() => setOpenFaq(openFaq === i ? null : i)}
                              className="flex w-full items-center justify-between px-3 py-2.5 text-left"
                            >
                              <span className="text-xs font-medium text-foreground pr-3">{faq.q}</span>
                              <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground flex-shrink-0 transition-transform ${openFaq === i ? "rotate-180" : ""}`} />
                            </button>
                            {openFaq === i && (
                              <div className="px-3 pb-3">
                                <p className="text-xs text-muted-foreground leading-relaxed">{faq.a}</p>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>

                      {/* Contact */}
                      <div className="rounded-lg bg-muted/50 p-3 space-y-2">
                        <p className="text-xs font-medium text-foreground">Contact us</p>
                        <a
                          href="mailto:hello@standaid.ai"
                          className="flex items-center gap-2 text-xs text-primary hover:underline"
                        >
                          <Mail className="h-3.5 w-3.5" />
                          hello@standaid.ai
                        </a>
                        <a
                          href="mailto:hello@standaid.ai?subject=Bug%20report"
                          className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Report a bug
                        </a>
                      </div>

                      {/* Legal */}
                      <div className="rounded-lg bg-muted/50 p-3 space-y-2">
                        <p className="text-xs font-medium text-foreground">Legal</p>
                        <a href="/terms" className="flex items-center gap-2 text-xs text-primary hover:underline">
                          <ExternalLink className="h-3.5 w-3.5" />
                          Terms of Service
                        </a>
                        <a href="/privacy" className="flex items-center gap-2 text-xs text-primary hover:underline">
                          <ExternalLink className="h-3.5 w-3.5" />
                          Privacy Policy
                        </a>
                      </div>
                    </div>
                  )}
                </div>

                {/* Grant Free Trial — Kyle only */}
                {isAdmin && (
                  <div>
                    <button
                      onClick={() => togglePanel("grant-trial")}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-foreground hover:bg-secondary transition-colors min-h-[44px]"
                    >
                      <Gift className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
                      <div className="flex-1 text-left">
                        <span className="block">Grant Free Trial</span>
                        <span className="block text-xs text-muted-foreground font-normal mt-0.5">Admin only</span>
                      </div>
                      {activePanel === "grant-trial"
                        ? <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        : <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      }
                    </button>
                    {activePanel === "grant-trial" && (
                      <div className="px-3 pb-4 pt-1 space-y-3">
                        <p className="text-xs text-muted-foreground">
                          Gives free Pro access to any email, new or existing account. Sends a branded invite —
                          access expires automatically, no card involved.
                        </p>
                        <div>
                          <Label className="text-xs">Email</Label>
                          <Input
                            className="h-11 mt-1"
                            type="email"
                            placeholder="someone@example.com"
                            value={grantEmail}
                            onChange={(e) => setGrantEmail(e.target.value)}
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Days free</Label>
                          <Input
                            className="h-11 mt-1"
                            type="number"
                            min={1}
                            max={90}
                            value={grantDays}
                            onChange={(e) => setGrantDays(e.target.value)}
                          />
                        </div>
                        <Button className="w-full h-11 gap-1.5" disabled={granting} onClick={grantTrial}>
                          {granting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gift className="h-4 w-4" />}
                          Send Invite
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {/* All Users — Kyle only */}
                {isAdmin && (
                  <div>
                    <button
                      onClick={() => {
                        togglePanel("all-users");
                        if (activePanel !== "all-users" && adminUsers === null) loadAdminUsers();
                      }}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-foreground hover:bg-secondary transition-colors min-h-[44px]"
                    >
                      <Users className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
                      <div className="flex-1 text-left">
                        <span className="block">All Users</span>
                        <span className="block text-xs text-muted-foreground font-normal mt-0.5">Admin only</span>
                      </div>
                      {activePanel === "all-users"
                        ? <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        : <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      }
                    </button>
                    {activePanel === "all-users" && (
                      <div className="px-3 pb-4 pt-1 space-y-3">
                        {adminUsersLoading && (
                          <div className="flex items-center justify-center py-6">
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                          </div>
                        )}
                        {!adminUsersLoading && adminUsers && adminUsers.length === 0 && (
                          <p className="text-xs text-muted-foreground">No users yet.</p>
                        )}
                        {!adminUsersLoading && adminUsers && adminUsers.length > 0 && (
                          <div className="overflow-x-auto rounded-lg border border-border">
                            <table className="w-full text-[11px]">
                              <thead>
                                <tr className="bg-muted/50 text-left text-muted-foreground">
                                  <th className="px-2 py-2 font-medium">Email</th>
                                  <th className="px-2 py-2 font-medium whitespace-nowrap">Signed up</th>
                                  <th className="px-2 py-2 font-medium">Status</th>
                                  <th className="px-2 py-2 font-medium">Tier</th>
                                  <th className="px-2 py-2 font-medium text-right">Queries</th>
                                  <th className="px-2 py-2 font-medium text-right">Cost</th>
                                </tr>
                              </thead>
                              <tbody>
                                {[...adminUsers].sort((a, b) => b.total_cost_usd - a.total_cost_usd).map((u) => (
                                  <tr key={u.user_id} className="border-t border-border">
                                    <td className="px-2 py-1.5 max-w-[140px] truncate text-[10px]" title={u.email ?? ""}>
                                      {u.email || u.display_name || "—"}
                                    </td>
                                    <td className="px-2 py-1.5 whitespace-nowrap text-[10px]">
                                      {new Date(u.created_at).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}
                                    </td>
                                    <td className="px-2 py-1.5 whitespace-nowrap">
                                      {u.email_confirmed ? (
                                        <Badge className="bg-green-600/15 text-green-700 dark:text-green-400 text-[10px] px-1 py-0 font-normal">
                                          ✓
                                        </Badge>
                                      ) : (
                                        <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 text-[10px] px-1 py-0 font-normal">
                                          ⏳
                                        </Badge>
                                      )}
                                    </td>
                                    <td className="px-2 py-1.5 capitalize text-[10px]">{u.subscription_tier || "free"}</td>
                                    <td className="px-2 py-1.5 text-right text-[10px]">{u.query_count}</td>
                                    <td className="px-2 py-1.5 text-right font-semibold text-[10px]">{formatCost(u.total_cost_usd)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                        <p className="text-[11px] text-muted-foreground">
                          {adminUsers ? `${adminUsers.length} user${adminUsers.length === 1 ? "" : "s"}` : ""} · showing latest 500
                          {adminTotalCost !== null ? ` · total spend: ${formatCost(adminTotalCost)}` : ""}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Failed Extractions — Kyle only */}
                {isAdmin && (
                  <div>
                    <button
                      onClick={() => {
                        togglePanel("failed-extractions");
                        if (activePanel !== "failed-extractions" && failedStandards === null) loadFailedStandards();
                      }}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-foreground hover:bg-secondary transition-colors min-h-[44px]"
                    >
                      <AlertTriangle className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
                      <div className="flex-1 text-left">
                        <span className="block">Failed Extractions</span>
                        <span className="block text-xs text-muted-foreground font-normal mt-0.5">Admin only</span>
                      </div>
                      {activePanel === "failed-extractions"
                        ? <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        : <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      }
                    </button>
                    {activePanel === "failed-extractions" && (
                      <div className="px-3 pb-4 pt-1 space-y-3">
                        <p className="text-xs text-muted-foreground">
                          Every standard, across every user, with a figure/table that permanently failed
                          processing (3 retries exhausted — invisible to users beyond the amber note on
                          their own Standards page). Retry re-reads just the pages around each failed
                          item and re-checks whether it's a real table/figure — not free, but a few pages
                          of vision input per failed item, not the whole document. Runs in seconds and
                          reports what happened directly.
                        </p>
                        {failedStandardsLoading && (
                          <div className="flex items-center justify-center py-6">
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                          </div>
                        )}
                        {!failedStandardsLoading && failedStandards && failedStandards.length === 0 && (
                          <p className="text-xs text-muted-foreground">Nothing outstanding — all clear.</p>
                        )}
                        {!failedStandardsLoading && failedStandards && failedStandards.length > 0 && (
                          <div className="space-y-2">
                            {failedStandards.map((s) => (
                              <div key={s.id} className="rounded-lg border border-border p-3 space-y-2">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="text-xs font-semibold text-foreground truncate">
                                      {s.standard_code || s.title}
                                    </p>
                                    <p className="text-[11px] text-muted-foreground truncate" title={s.email}>
                                      {s.email}
                                    </p>
                                  </div>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 gap-1.5 text-xs flex-shrink-0"
                                    disabled={retryingStandardId === s.id}
                                    onClick={() => retryFailedStandard(s.id)}
                                  >
                                    {retryingStandardId === s.id
                                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      : <RefreshCw className="h-3.5 w-3.5" />}
                                    Retry
                                  </Button>
                                </div>
                                <p className="text-[11px] text-amber-600 dark:text-amber-500">
                                  {s.failed_chunks_labels?.length
                                    ? s.failed_chunks_labels.slice(0, 6).join(", ") + (s.failed_chunks_labels.length > 6 ? ` and ${s.failed_chunks_labels.length - 6} more` : "")
                                    : `${s.failed_chunks_count} item${s.failed_chunks_count === 1 ? "" : "s"}`}
                                </p>
                                <p className="text-[11px] text-muted-foreground">
                                  {s.indexed_chunks ?? 0}/{s.total_chunks ?? 0} indexed
                                  {s.extraction_quality_score != null ? ` · ${Math.round(s.extraction_quality_score)}% quality` : ""}
                                  {" · "}
                                  {new Date(s.created_at).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                        <p className="text-[11px] text-muted-foreground">
                          {failedStandards ? `${failedStandards.length} standard${failedStandards.length === 1 ? "" : "s"}` : ""} · showing latest 200
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Sign Out */}
                <button
                  onClick={handleSignOut}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors min-h-[44px]"
                >
                  <LogOut className="h-5 w-5 flex-shrink-0 text-destructive" />
                  <div className="flex-1 text-left">
                    <span className="block">Sign Out</span>
                    {user?.email && (
                      <span className="block text-xs text-muted-foreground font-normal mt-0.5">{user.email}</span>
                    )}
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                </button>

              </Card>
            </div>

            <p className="text-center text-[10px] text-muted-foreground mt-auto">
              StandAId v1.0 · Australian Standards AI Assistant
            </p>
          </div>

        </div>
      </div>
    </div>
  );
};

export default Profile;
