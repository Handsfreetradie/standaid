import { BookOpen, MessageSquare, Zap, Shield, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const Index = () => {
  const navigate = useNavigate();

  return (
    <div className="px-5 py-6">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <Shield className="h-7 w-7 text-primary" />
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-foreground">
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
        <h2 className="font-display text-lg font-bold text-foreground mb-3">
          Recent Activity
        </h2>
        <div className="space-y-3">
          {[
            {
              title: "Bathroom circuit protection",
              standard: "AS/NZS 3000",
              time: "2 hours ago",
            },
            {
              title: "Cable sizing for 32A circuit",
              standard: "AS/NZS 3008",
              time: "Yesterday",
            },
            {
              title: "Smoke alarm placement",
              standard: "AS 3786",
              time: "2 days ago",
            },
          ].map((item, i) => (
            <Card
              key={i}
              className="flex items-center justify-between p-4 cursor-pointer hover:shadow-sm transition-shadow"
              onClick={() => navigate("/chat")}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">
                  {item.title}
                </p>
                <p className="text-xs text-muted-foreground">
                  {item.standard} · {item.time}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            </Card>
          ))}
        </div>
      </div>

      {/* Free Tier Banner */}
      <Card className="border-primary/20 bg-primary/5 p-4">
        <div className="flex items-start gap-3">
          <Zap className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground">
              Free Plan — 3 of 5 queries used today
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
    </div>
  );
};

export default Index;
