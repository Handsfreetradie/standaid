import { useNavigate } from "react-router-dom";
import { BookOpen, MessageSquare, Zap, Shield, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useProfile, useQueries } from "@/hooks/useData";

const Index = () => {
  const navigate = useNavigate();
  const { data: profile, isLoading: profileLoading } = useProfile();
  const { data: recentQueries = [] } = useQueries();

  const tier = profile?.subscription_tier || "free";
  const queriesUsed = profile?.daily_query_count || 0;

  return (
    <div className="px-5 py-6">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <Shield className="h-7 w-7 text-primary" />
          <h1 className="font-sans text-2xl font-extrabold tracking-tight text-foreground">
            StandardsAI
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Your AI compliance assistant
        </p>
      </div>

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
          <span className="text-xs text-muted-foreground text-center">
            Get compliance advice
          </span>
        </Card>
        <Card
          className="flex flex-col items-center gap-2 p-5 cursor-pointer hover:shadow-md transition-shadow active:scale-[0.98]"
          onClick={() => navigate("/standards")}
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <BookOpen className="h-6 w-6 text-primary" />
          </div>
          <span className="text-sm font-semibold text-foreground">Standards</span>
          <span className="text-xs text-muted-foreground text-center">
            Manage your library
          </span>
        </Card>
      </div>

      {/* Recent Activity */}
      <div className="mb-6">
        <h2 className="font-sans text-lg font-bold text-foreground mb-3">
          Recent Activity
        </h2>
        <div className="space-y-3">
          {recentQueries.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No queries yet. Upload a standard and start asking questions!
            </p>
          ) : (
            recentQueries.slice(0, 5).map((q) => (
              <Card
                key={q.id}
                className="flex items-center justify-between p-4 cursor-pointer hover:shadow-sm transition-shadow"
                onClick={() => navigate("/chat")}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">
                    {q.question}
                  </p>
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
                Upgrade to Pro for unlimited queries, full clause references, and
                voice input.
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
