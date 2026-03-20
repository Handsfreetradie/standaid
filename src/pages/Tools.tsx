import { useState } from "react";
import { Calculator, Zap, Construction, Droplets, ChevronRight, Cable, Gauge, Activity } from "lucide-react";
import { Card } from "@/components/ui/card";
import VoltageDropTool from "@/components/tools/VoltageDropTool";
import ConcreteVolumeTool from "@/components/tools/ConcreteVolumeTool";
import PipeSizingTool from "@/components/tools/PipeSizingTool";
import CableSizerTool from "@/components/tools/CableSizerTool";
import ConduitFillTool from "@/components/tools/ConduitFillTool";
import MaxDemandTool from "@/components/tools/MaxDemandTool";

type ToolMode = "menu" | "voltage-drop" | "concrete-volume" | "pipe-sizing" | "cable-sizer" | "conduit-fill" | "max-demand";

const TOOLS: { id: ToolMode; title: string; desc: string; icon: React.ReactNode; category: string }[] = [
  {
    id: "voltage-drop", title: "Voltage Drop", icon: <Zap className="h-5 w-5 text-yellow-600" />,
    desc: "AS/NZS 3008 — AC/DC, full cable spec & derating", category: "Electrical",
  },
  {
    id: "cable-sizer", title: "Cable Sizer", icon: <Cable className="h-5 w-5 text-blue-600" />,
    desc: "Auto-select cable by load, run & conditions", category: "Electrical",
  },
  {
    id: "max-demand", title: "Maximum Demand", icon: <Activity className="h-5 w-5 text-red-600" />,
    desc: "AS/NZS 3000 — Diversity & main breaker sizing", category: "Electrical",
  },
  {
    id: "conduit-fill", title: "Conduit Fill", icon: <Gauge className="h-5 w-5 text-purple-600" />,
    desc: "AS/NZS 3080 — Multi-cable fill check", category: "Electrical",
  },
  {
    id: "concrete-volume", title: "Concrete Volume", icon: <Construction className="h-5 w-5 text-orange-600" />,
    desc: "Slabs, footings & pads — with waste & rebar", category: "General",
  },
  {
    id: "pipe-sizing", title: "Pipe Sizing", icon: <Droplets className="h-5 w-5 text-blue-500" />,
    desc: "Flow rate to pipe diameter by application", category: "Plumbing",
  },
];

const ICON_BG: Record<string, string> = {
  Electrical: "bg-yellow-500/10",
  Plumbing: "bg-blue-500/10",
  General: "bg-orange-500/10",
};

const Tools = () => {
  const [mode, setMode] = useState<ToolMode>("menu");

  if (mode === "voltage-drop") return <VoltageDropTool onBack={() => setMode("menu")} />;
  if (mode === "cable-sizer") return <CableSizerTool onBack={() => setMode("menu")} />;
  if (mode === "conduit-fill") return <ConduitFillTool onBack={() => setMode("menu")} />;
  if (mode === "max-demand") return <MaxDemandTool onBack={() => setMode("menu")} />;
  if (mode === "concrete-volume") return <ConcreteVolumeTool onBack={() => setMode("menu")} />;
  if (mode === "pipe-sizing") return <PipeSizingTool onBack={() => setMode("menu")} />;

  const categories = [...new Set(TOOLS.map(t => t.category))];

  return (
    <div className="px-5 py-6 pb-24 max-w-md mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Calculator className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="font-display text-xl font-extrabold text-foreground">Trade Tools</h1>
          <p className="text-sm text-muted-foreground">Professional-grade — AC/DC, full cable spec</p>
        </div>
      </div>

      {categories.map(cat => (
        <div key={cat} className="mb-5">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">{cat}</p>
          <div className="space-y-2">
            {TOOLS.filter(t => t.category === cat).map(tool => (
              <Card key={tool.id} className="p-4 cursor-pointer hover:border-primary/50 transition-colors active:scale-[0.99]"
                onClick={() => setMode(tool.id)}>
                <div className="flex items-center gap-3">
                  <div className={`h-10 w-10 rounded-lg flex items-center justify-center flex-shrink-0 ${ICON_BG[cat] || "bg-muted"}`}>
                    {tool.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-foreground text-sm">{tool.title}</p>
                    <p className="text-xs text-muted-foreground truncate">{tool.desc}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                </div>
              </Card>
            ))}
          </div>
        </div>
      ))}

      <p className="text-xs text-muted-foreground text-center mt-4">
        All calculations run locally — no tokens used, no internet needed.
      </p>
    </div>
  );
};

export default Tools;
