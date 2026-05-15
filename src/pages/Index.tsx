import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, MessageSquare, Zap, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useProfile, useQueries } from "@/hooks/useData";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";

const TRADES = [
  { id: "electrical", icon: "⚡", name: "Electrical" },
  { id: "plumbing", icon: "🔧", name: "Plumbing" },
  { id: "building", icon: "🏗️", name: "Building & Construction" },
  { id: "carpentry", icon: "🔩", name: "Carpentry" },
  { id: "gas", icon: "🔥", name: "Gas Fitting" },
  { id: "hvac", icon: "🌡️", name: "HVAC" },
  { id: "health_safety", icon: "⚕️", name: "Health & Safety" },
  { id: "engineering", icon: "🏭", name: "Engineering" },
  { id: "food_safety", icon: "🍽️", name: "Food Safety" },
  { id: "other", icon: "📐", name: "Other" },
];

const TRADE_MAP = Object.fromEntries(TRADES.map((t) => [t.id, t]));

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

const Index = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: profile, isLoading: profileLoading } = useProfile();
  const { data: recentQueries = [] } = useQueries();
  const [savingTrade, setSavingTrade] = useState(false);
  const [pickingTrade, setPickingTrade] = useState(false);

  const tier = profile?.subscription_tier || "free";
  const queriesUsed = profile?.daily_query_count || 0;
  const firstName = profile?.display_name?.split(" ")[0] || "";
  const selectedTrades = profile?.trade_type
    ? profile.trade_type.split(",").filter(Boolean).map((id) => TRADE_MAP[id]).filter(Boolean)
    : [];
  const noTradeSet = !profileLoading && selectedTrades.length === 0;

  const saveTrade = async (tradeId: string) => {
    if (!user) return;
    setSavingTrade(true);
    const existing = profile?.trade_type ? profile.trade_type.split(",").filter(Boolean) : [];
    const updated = existing.includes(tradeId) ? existing : [...existing, tradeId];
    await supabase
      .from("profiles")
      .update({ trade_type: updated.join(",") })
      .eq("user_id", user.id);
    queryClient.invalidateQueries({ queryKey: ["profile"] });
    setSavingTrade(false);
    setPickingTrade(false);
  };

  return (
    <div className="px-5 py-6">
      {/* Greeting */}
      <div className="mb-6">
        <h1 className="font-sans text-2xl font-extrabold text-foreground">
          {getGreeting()}{firstName ? `, ${firstName}` : ""}
        </h1>
        {selectedTrades.length > 0 ? (
          <div className="flex flex-wrap gap-2 mt-2">
            {selectedTrades.map((t) => (
              <span
                key={t.id}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-semibold"
              >
                {t.icon} {t.name}
              </span>
            ))}
            <button
              onClick={() => setPickingTrade(true)}
              className="text-xs text-muted-foreground hover:text-foreground underline self-center"
            >
              Change
            </button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground mt-1">Your AI compliance assistant</p>
        )}
      </div>

      {/* Trade picker — shown for new users or when changing */}
      {(noTradeSet || pickingTrade) && (
        <Card className="mb-6 p-4 border-primary/30 bg-primary/5">
          <p className="text-sm font-semibold text-foreground mb-3">
            {noTradeSet ? "What's your trade? We'll personalise your experience." : "Select your trades:"}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {TRADES.map((t) => {
              const isSelected = selectedTrades.some((s) => s.id === t.id);
              return (
                <button
                  key={t.id}
                  onClick={() => saveTrade(t.id)}
                  disabled={savingTrade}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-semibold text-left transition-all ${
                    isSelected
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card hover:border-primary/40 text-foreground"
                  }`}
                >
                  <span>{t.icon}</span>
                  <span className="truncate">{t.name}</span>
                </button>
              );
            })}
          </div>
          {pickingTrade && (
            <button
              onClick={() => setPickingTrade(false)}
              className="mt-3 text-xs text-muted-foreground hover:text-foreground underline"
            >
              Done
            </button>
          )}
        </Card>
      )}

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-3 mb-8">
        <Card
          className="flex flex-col items-center gap-2 p-5 cursor-pointer hover:shadow-md transition-shadow active:scale-[0.98]"
          onClick={() => navigate("/chat")}
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <MessageSquare className="h-6 w-6 text-primary" />
          </div>
          <span className="text-sm font-semibold text-foreground">Ask AI</span>
          <span className="text-xs text-muted-foreground text-center">Get compliance advice</span>
        </Card>
        <Card
          className="flex flex-col items-center gap-2 p-5 cursor-pointer hover:shadow-md transition-shadow active:scale-[0.98]"
          onClick={() => navigate("/standards")}
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <BookOpen className="h-6 w-6 text-primary" />
          </div>
          <span className="text-sm font-semibold text-foreground">Standards</span>
          <span className="text-xs text-muted-foreground text-center">Manage your library</span>
        </Card>
      </div>

      {/* Recent Activity */}
      <div className="mb-6">
        <h2 className="font-sans text-lg font-bold text-foreground mb-3">Recent Activity</h2>
        <div className="space-y-3">
          {recentQueries.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No queries yet.{" "}
              <button onClick={() => navigate("/standards")} className="text-primary underline">
                Upload a standard
              </button>{" "}
              and start asking questions.
            </p>
          ) : (
            recentQueries.slice(0, 5).map((q) => (
              <Card
                key={q.id}
                className="flex items-center justify-between p-4 cursor-pointer hover:shadow-sm transition-shadow"
                onClick={() => navigate("/chat")}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{q.question}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(q.created_at).toLocaleDateString("en-AU", {
                      day: "numeric",
                      month: "short",
                    })}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              </Card>
            ))
          )}
        </div>
      </div>

      {/* Free Tier Banner */}
      {tier === "free" && (
        <Card className="border-primary/20 bg-primary/5 p-4">
          <div className="flex items-start gap-3">
            <Zap className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-foreground">
                Free Plan — {queriesUsed} of 5 queries used today
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Upgrade to Pro for unlimited queries, full clause references, and voice input.
              </p>
              <Button
                size="sm"
                className="mt-3 h-9 text-xs font-semibold"
                onClick={() => navigate("/profile")}
              >
                Upgrade to Pro
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
};

export default Index;
