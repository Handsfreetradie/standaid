import { User, ChevronRight, Shield, Zap, Settings, HelpCircle, LogOut, CreditCard } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/useAuth";

const Profile = () => {
  const { signOut } = useAuth();

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch {
      // signOut clears local state even if server call fails
    }
  };

  return (
    <div className="h-full overflow-y-auto px-5 py-6">
      {/* User Info */}
      <div className="flex items-center gap-4 mb-6">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          <User className="h-7 w-7 text-primary" />
        </div>
        <div>
          <h1 className="font-sans text-xl font-bold text-foreground">
            Jake Mitchell
          </h1>
          <p className="text-sm text-muted-foreground">Licensed Electrician</p>
        </div>
      </div>

      {/* Current Plan */}
      <Card className="border-primary/20 bg-primary/5 p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <span className="text-sm font-bold text-foreground">Free Plan</span>
          </div>
          <Badge className="bg-primary text-primary-foreground text-xs">
            Current
          </Badge>
        </div>
        <div className="space-y-2 mb-4">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Standards uploaded</span>
            <span className="font-semibold text-foreground">1 / 1</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Daily queries</span>
            <span className="font-semibold text-foreground">3 / 5 used</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Clause references</span>
            <span className="font-semibold text-primary">Teaser only</span>
          </div>
        </div>
        <Button className="w-full h-11 text-sm font-semibold gap-1.5">
          <Zap className="h-4 w-4" />
          Upgrade to Pro — $19.99/mo
        </Button>
      </Card>

      {/* Plan Comparison */}
      <h2 className="font-sans text-lg font-bold text-foreground mb-3">
        Compare Plans
      </h2>
      <div className="grid grid-cols-3 gap-2 mb-6">
        {[
          { name: "Free", price: "$0", features: ["1 standard", "5 queries/day", "Partial indexing"] },
          { name: "Pro", price: "$19.99", features: ["Unlimited", "Unlimited", "Full clauses", "Voice & Photo", "Job management"], highlight: true },
          { name: "Business", price: "$49.99", features: ["Unlimited", "Unlimited", "Full clauses", "Team libraries", "PDF reports"] },
        ].map((plan) => (
          <Card
            key={plan.name}
            className={`p-3 text-center ${plan.highlight ? "border-primary ring-1 ring-primary" : ""}`}
          >
            <p className="text-xs font-bold text-foreground">{plan.name}</p>
            <p className="text-lg font-extrabold text-foreground mt-1">
              {plan.price}
            </p>
            <p className="text-[10px] text-muted-foreground">/month</p>
            <Separator className="my-2" />
            <div className="space-y-1">
              {plan.features.map((f) => (
                <p key={f} className="text-[10px] text-muted-foreground">
                  {f}
                </p>
              ))}
            </div>
          </Card>
        ))}
      </div>

      {/* Menu Items */}
      <div className="space-y-1">
        {[
          { icon: CreditCard, label: "Subscription & Billing", onClick: undefined },
          { icon: Settings, label: "Settings", onClick: undefined },
          { icon: HelpCircle, label: "Help & Support", onClick: undefined },
          { icon: LogOut, label: "Sign Out", onClick: handleSignOut },
        ].map(({ icon: Icon, label, onClick }) => (
          <button
            key={label}
            onClick={onClick}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-foreground hover:bg-secondary transition-colors min-h-[44px]"
          >
            <Icon className="h-5 w-5 text-muted-foreground" />
            <span className="flex-1 text-left">{label}</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
        ))}
      </div>
    </div>
  );
};

export default Profile;
