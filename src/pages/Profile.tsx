import { useState } from "react";
import { User, ChevronRight, ChevronDown, Shield, Zap, HelpCircle, LogOut, CreditCard, Bell, Mail, ExternalLink, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useData";

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
    a: "Any Australian Standard in PDF format — AS/NZS 3000, AS 3017, plumbing codes, building codes, NCC, and more. Any trade, any standard.",
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

const Profile = () => {
  const { user, signOut } = useAuth();
  const { data: profile } = useProfile();
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

  const setNotif = (key: string, value: boolean, setter: (v: boolean) => void) => {
    setter(value);
    localStorage.setItem(key, String(value));
  };

  const displayName = profile?.display_name || user?.email?.split("@")[0] || "Tradie";
  const tradeLabel = profile?.trade_type
    ? profile.trade_type.split(",").filter(Boolean).map((id) => TRADE_LABELS[id] || id).join(", ")
    : null;
  const tier = profile?.subscription_tier || "pro";
  const queriesUsed = profile?.daily_query_count || 0;
  const isPro = tier === "pro" || tier === "business";

  return (
    <div className="h-full overflow-y-auto">
      <div className="min-h-full px-5 py-6 pb-24 md:pb-10 max-w-5xl md:mx-auto flex flex-col">
        <div className="md:grid md:grid-cols-5 md:gap-10 md:items-start flex-1">

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
                  {tradeLabel || "Set your trade on the Home tab"}
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
                <Badge className="bg-primary text-primary-foreground text-xs">Current</Badge>
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
              {!isPro && (
                <Button className="w-full h-11 text-sm font-semibold gap-1.5">
                  <Zap className="h-4 w-4" />
                  Upgrade to Pro — $19.99/mo
                </Button>
              )}
            </Card>

            {/* Plan Comparison — free tier only */}
            {!isPro && (
              <>
                <h2 className="font-sans text-lg font-bold text-foreground mb-3">Compare Plans</h2>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { name: "Free", price: "$0", features: ["1 standard", "5 queries/day", "Partial clauses"] },
                    { name: "Pro", price: "$19.99", features: ["Unlimited", "Unlimited", "Full clauses", "Voice & Photo"], highlight: true },
                    { name: "Business", price: "$49.99", features: ["Unlimited", "Unlimited", "Full clauses", "Team libraries"] },
                  ].map((plan) => (
                    <Card
                      key={plan.name}
                      className={`p-3 text-center ${plan.highlight ? "border-primary ring-1 ring-primary" : ""}`}
                    >
                      <p className="text-xs font-bold text-foreground">{plan.name}</p>
                      <p className="text-lg font-extrabold text-foreground mt-1">{plan.price}</p>
                      <p className="text-[10px] text-muted-foreground">/month</p>
                      <Separator className="my-2" />
                      <div className="space-y-1">
                        {plan.features.map((f) => (
                          <p key={f} className="text-[10px] text-muted-foreground">{f}</p>
                        ))}
                      </div>
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
                        {isPro ? `${tier.charAt(0).toUpperCase() + tier.slice(1)} plan active` : "Free plan"}
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
                          <span className="font-semibold capitalize text-foreground">{tier}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Price</span>
                          <span className="font-semibold text-foreground">
                            {isPro ? (tier === "business" ? "$49.99/month" : "$19.99/month") : "Free"}
                          </span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Status</span>
                          <span className="flex items-center gap-1 font-semibold text-green-600">
                            <CheckCircle2 className="h-3 w-3" /> Active
                          </span>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        To manage or cancel your subscription, contact us at{" "}
                        <a href="mailto:hello@standaid.ai" className="text-primary underline">
                          hello@standaid.ai
                        </a>
                      </p>
                      {!isPro && (
                        <Button size="sm" className="w-full gap-1.5">
                          <Zap className="h-3.5 w-3.5" />
                          Upgrade to Pro — $19.99/mo
                        </Button>
                      )}
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
