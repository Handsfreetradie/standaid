import { useState } from "react";
import { Calculator, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import VoltageDropTool from "@/components/tools/VoltageDropTool";
import ConcreteVolumeTool from "@/components/tools/ConcreteVolumeTool";
import PipeSizingTool from "@/components/tools/PipeSizingTool";
import CableSizerTool from "@/components/tools/CableSizerTool";
import ConduitFillTool from "@/components/tools/ConduitFillTool";
import MaxDemandTool from "@/components/tools/MaxDemandTool";
import BrickCalculatorTool from "@/components/tools/BrickCalculatorTool";
import TimberSpanTool from "@/components/tools/TimberSpanTool";
import RoofPitchTool from "@/components/tools/RoofPitchTool";
import HeatLoadTool from "@/components/tools/HeatLoadTool";
import DuctSizingTool from "@/components/tools/DuctSizingTool";
import GasPipeSizingTool from "@/components/tools/GasPipeSizingTool";
import DrainageFallTool from "@/components/tools/DrainageFallTool";

type ToolMode = "menu" | "voltage-drop" | "concrete-volume" | "pipe-sizing" | "cable-sizer" | "conduit-fill" | "max-demand" | "brick-calc" | "timber-span" | "roof-pitch" | "heat-load" | "duct-sizing" | "gas-pipe" | "drainage-fall";

const TOOLS: { id: ToolMode; title: string; desc: string; category: string }[] = [
  // Electrical
  { id: "voltage-drop", title: "Voltage Drop", desc: "AC/DC, full cable spec & derating", category: "Electrical" },
  { id: "cable-sizer", title: "Cable Sizer", desc: "Auto-select cable by load, run & conditions", category: "Electrical" },
  { id: "max-demand", title: "Maximum Demand", desc: "Diversity & main breaker sizing", category: "Electrical" },
  { id: "conduit-fill", title: "Conduit Fill", desc: "AS/NZS 3080 multi-cable fill check", category: "Electrical" },
  // HVAC / Refrigeration
  { id: "heat-load", title: "Heat Load", desc: "Cooling & heating capacity estimator", category: "HVAC" },
  { id: "duct-sizing", title: "Duct Sizing", desc: "Round & rectangular duct by airflow", category: "HVAC" },
  // Plumbing / Gas
  { id: "pipe-sizing", title: "Pipe Sizing", desc: "Flow rate to pipe diameter", category: "Plumbing / Gas" },
  { id: "gas-pipe", title: "Gas Pipe Sizing", desc: "AS/NZS 5601 — size by load & run", category: "Plumbing / Gas" },
  { id: "drainage-fall", title: "Drainage Fall", desc: "AS/NZS 3500.2 pipe grades & fall", category: "Plumbing / Gas" },
  // Building / Carpentry
  { id: "brick-calc", title: "Brick & Block", desc: "Estimate bricks, mortar & sand", category: "Building" },
  { id: "timber-span", title: "Timber Span", desc: "AS 1684 — joist, rafter & bearer spans", category: "Building" },
  { id: "roof-pitch", title: "Roof Pitch", desc: "Pitch, rafter length & roof area", category: "Building" },
  { id: "concrete-volume", title: "Concrete Volume", desc: "Slabs, footings & pads with waste", category: "Building" },
];


const TOOL_COMPONENTS: Record<string, React.FC<{ onBack: () => void }>> = {
  "voltage-drop": VoltageDropTool,
  "cable-sizer": CableSizerTool,
  "conduit-fill": ConduitFillTool,
  "max-demand": MaxDemandTool,
  "concrete-volume": ConcreteVolumeTool,
  "pipe-sizing": PipeSizingTool,
  "brick-calc": BrickCalculatorTool,
  "timber-span": TimberSpanTool,
  "roof-pitch": RoofPitchTool,
  "heat-load": HeatLoadTool,
  "duct-sizing": DuctSizingTool,
  "gas-pipe": GasPipeSizingTool,
  "drainage-fall": DrainageFallTool,
};

const Tools = () => {
  const [mode, setMode] = useState<ToolMode>("menu");

  if (mode !== "menu") {
    const ToolComponent = TOOL_COMPONENTS[mode];
    if (ToolComponent) return <ToolComponent onBack={() => setMode("menu")} />;
  }

  const categories = [...new Set(TOOLS.map(t => t.category))];

  return (
    <div className="h-full overflow-y-auto px-5 py-6 pb-24 md:pb-8 max-w-md md:max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Calculator className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="font-sans text-xl font-extrabold text-foreground">Trade Tools</h1>
          <p className="text-sm text-muted-foreground">{TOOLS.length} professional calculators</p>
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
    </div>
  );
};

export default Tools;
