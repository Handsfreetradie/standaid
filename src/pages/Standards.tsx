import { BookOpen, Upload, Lock, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

const mockStandards = [
  {
    id: 1,
    title: "AS/NZS 3000:2018",
    subtitle: "Wiring Rules",
    trade: "Electrical",
    indexed: "30%",
    uploadDate: "12 Jan 2026",
    locked: false,
  },
];

const Standards = () => {
  return (
    <div className="px-5 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-foreground">
            Standards Library
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            1 of 1 standard uploaded (Free tier)
          </p>
        </div>
        <Button size="sm" className="h-9 gap-1.5">
          <Upload className="h-4 w-4" />
          Upload
        </Button>
      </div>

      {/* Search */}
      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search standards..."
          className="pl-9 h-11"
        />
      </div>

      {/* Standards List */}
      <div className="space-y-3 mb-6">
        {mockStandards.map((s) => (
          <Card key={s.id} className="p-4">
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-primary" />
                <div>
                  <p className="text-sm font-bold text-foreground">{s.title}</p>
                  <p className="text-xs text-muted-foreground">{s.subtitle}</p>
                </div>
              </div>
              <Badge variant="secondary" className="text-xs">
                {s.trade}
              </Badge>
            </div>
            <div className="flex items-center justify-between mt-3">
              <span className="text-xs text-muted-foreground">
                Uploaded {s.uploadDate}
              </span>
              <div className="flex items-center gap-1.5">
                <div className="h-1.5 w-20 rounded-full bg-secondary overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: s.indexed }}
                  />
                </div>
                <span className="text-xs font-medium text-primary">
                  {s.indexed} indexed
                </span>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Upgrade CTA */}
      <Card className="border-primary/20 bg-primary/5 p-4">
        <div className="flex items-start gap-3">
          <Lock className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-foreground">
              Unlock full indexing
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Your standard is only 30% indexed on the Free tier. Upgrade to Pro
              for full document access and unlimited uploads.
            </p>
            <Button size="sm" className="mt-3 h-9 text-xs font-semibold">
              Upgrade to Pro
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default Standards;
