import { User, ChevronRight, Shield, Zap, HelpCircle, LogOut, CreditCard, Bell } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useData";
import { toast } from "sonner";

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

const Profile = () => {
  const { user, signOut } = useAuth();
  const { data: profile } = useProfile();

  const handleSignOut = async () => {
    await signOut();
  };

  const handleComingSoon = (feature: string) => {
    toast.info(`${feature} — coming soon!`);
  };

  const displayName = profile?.display_name || user?.email?.split("@")[0] || "Tradie";
  const tradeLabel = profile?.trade_type
    ? profile.trade_type.split(",").filter(Boolean).map((id) => TRADE_LABELS[id] || id).join(", ")
    : null;
  const tier = profile?.subscription_tier || "free";
  const queriesUsed = profile?.daily_query_count || 0;
  const isPro = tier === "pro" || tier === "business";

  return (
    <div className="h-full overflow-y-auto px-5 py-6">
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
          <Button
            className="w-full h-11 text-sm font-semibold gap-1.5"
            onClick={() => handleComingSoon("Upgrade to Pro")}
          >
            <Zap className="h-4 w-4" />
            Upgrade to Pro — $19.99/mo
          </Button>
        )}
      </Card>

      {/* Plan Comparison */}
      {!isPro && (
        <>
          <h2 className="font-sans text-lg font-bold text-foreground mb-3">Compare Plans</h2>
          <div className="grid grid-cols-3 gap-2 mb-6">
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

      {/* Menu Items */}
      <div className="space-y-1">
        {[
          {
            icon: CreditCard,
            label: "Subscription & Billing",
            sub: isPro ? `${tier.charAt(0).toUpperCase() + tier.slice(1)} plan active` : "Free plan",
            onClick: () => handleComingSoon("Subscription & Billing"),
            danger: false,
          },
          {
            icon: Bell,
            label: "Notifications",
            sub: null,
            onClick: () => handleComingSoon("Notifications"),
            danger: false,
          },
          {
            icon: HelpCircle,
            label: "Help & Support",
            sub: null,
            onClick: () => handleComingSoon("Help & Support"),
            danger: false,
          },
          {
            icon: LogOut,
            label: "Sign Out",
            sub: user?.email || null,
            onClick: handleSignOut,
            danger: true,
          },
        ].map(({ icon: Icon, label, sub, onClick, danger }) => (
          <button
            key={label}
            onClick={onClick}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors min-h-[44px] ${
              danger ? "text-destructive hover:bg-destructive/10" : "text-foreground hover:bg-secondary"
            }`}
          >
            <Icon className={`h-5 w-5 flex-shrink-0 ${danger ? "text-destructive" : "text-muted-foreground"}`} />
            <div className="flex-1 text-left">
              <span className="block">{label}</span>
              {sub && <span className="block text-xs text-muted-foreground font-normal mt-0.5">{sub}</span>}
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          </button>
        ))}
      </div>

      <p className="text-center text-[10px] text-muted-foreground mt-8">
        StandAId v1.0 · Australian Standards AI Assistant
      </p>
    </div>
  );
};

export default Profile;
