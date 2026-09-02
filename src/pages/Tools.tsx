import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Calculator, ChevronRight, Loader2, Zap, Lock } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { useProfile } from "@/hooks/useData";
import { supabase } from "@/integrations/supabase/client";
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
import EarthConductorTool from "@/components/tools/EarthConductorTool";
import BackflowPreventionTool from "@/components/tools/BackflowPreventionTool";
import SteelLintelTool from "@/components/tools/SteelLintelTool";
import StairComplianceTool from "@/components/tools/StairComplianceTool";
import StormwaterSizingTool from "@/components/tools/StormwaterSizingTool";
import VentilationSizingTool from "@/components/tools/VentilationSizingTool";
import FaultLoopTool from "@/components/tools/FaultLoopTool";
import PVStringSizingTool from "@/components/tools/PVStringSizingTool";
import DCIsolatorTool from "@/components/tools/DCIsolatorTool";
import BatteryComplianceTool from "@/components/tools/BatteryComplianceTool";
import ProjectManager from "@/components/tools/ProjectManager";

type ToolMode = "menu" | "earth-conductor" | "voltage-drop" | "concrete-volume" | "pipe-sizing" | "cable-sizer" | "conduit-fill" | "max-demand" | "brick-calc" | "timber-span" | "roof-pitch" | "heat-load" | "duct-sizing" | "gas-pipe" | "drainage-fall" | "backflow" | "steel-lintel" | "stair-compliance" | "stormwater" | "ventilation" | "fault-loop" | "pv-string" | "dc-isolator" | "battery-check" | "projects";

const TOOLS: { id: ToolMode; title: string; desc: string; category: string }[] = [
  // Project Management
  { id: "projects", title: "Projects", desc: "Create & manage calculation jobs", category: "Management" },
  // Electrical
  { id: "voltage-drop", title: "Voltage Drop", desc: "AC/DC, full cable spec & derating", category: "Electrical" },
  { id: "cable-sizer", title: "Cable Sizer", desc: "Auto-select cable by load, run & conditions", category: "Electrical" },
  { id: "max-demand", title: "Maximum Demand", desc: "Diversity & main breaker sizing", category: "Electrical" },
  { id: "conduit-fill", title: "Conduit Fill", desc: "Space-factor multi-cable fill check", category: "Electrical" },
  { id: "earth-conductor", title: "Earth Conductor Size", desc: "AS/NZS 3000 Table 5.1 minimum earth", category: "Electrical" },
  { id: "fault-loop", title: "Fault Loop Impedance", desc: "AS/NZS 3000 App B — max Zs check", category: "Electrical" },
  // Solar / Battery
  { id: "pv-string", title: "PV String Sizing", desc: "Temp-corrected string voltage vs inverter", category: "Solar / Battery" },
  { id: "dc-isolator", title: "DC Isolator Rating", desc: "Min ratings from array datasheet values", category: "Solar / Battery" },
  { id: "battery-check", title: "Battery Install Checker", desc: "AS/NZS 5139 location screening", category: "Solar / Battery" },
  // HVAC / Refrigeration
  { id: "heat-load", title: "Heat Load", desc: "Cooling & heating capacity estimator", category: "HVAC" },
  { id: "duct-sizing", title: "Duct Sizing", desc: "Round & rectangular duct by airflow", category: "HVAC" },
  { id: "ventilation", title: "Ventilation Sizing", desc: "AS 1668.2 exhaust & outside-air rates", category: "HVAC" },
  // Plumbing / Gas
  { id: "pipe-sizing", title: "Pipe Sizing", desc: "Flow rate to pipe diameter", category: "Plumbing / Gas" },
  { id: "gas-pipe", title: "Gas Pipe Sizing", desc: "AS/NZS 5601 — size by load & run", category: "Plumbing / Gas" },
  { id: "drainage-fall", title: "Drainage Fall", desc: "AS/NZS 3500.2 pipe grades & fall", category: "Plumbing / Gas" },
  { id: "backflow", title: "Backflow Prevention", desc: "AS/NZS 3500.1 device by hazard rating", category: "Plumbing / Gas" },
  { id: "stormwater", title: "Stormwater Sizing", desc: "AS/NZS 3500.3 gutters & downpipes", category: "Plumbing / Gas" },
  // Building / Carpentry
  { id: "brick-calc", title: "Brick & Block", desc: "Estimate bricks, mortar & sand", category: "Building" },
  { id: "timber-span", title: "Timber Span", desc: "AS 1684 — joist, rafter & bearer spans", category: "Building" },
  { id: "roof-pitch", title: "Roof Pitch", desc: "Pitch, rafter length & roof area", category: "Building" },
  { id: "concrete-volume", title: "Concrete Volume", desc: "Slabs, footings & pads with waste", category: "Building" },
  { id: "steel-lintel", title: "Steel Lintel Sizing", desc: "Indicative lintel guide — engineer to verify", category: "Building" },
  { id: "stair-compliance", title: "Stair Rise & Going", desc: "NCC riser, going & 2R+G check", category: "Building" },
];


const TOOL_COMPONENTS: Record<string, React.FC<{ onBack: () => void }>> = {
  "projects": ProjectManager,
  "voltage-drop": VoltageDropTool,
  "earth-conductor": EarthConductorTool,
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
  "backflow": BackflowPreventionTool,
  "steel-lintel": SteelLintelTool,
  "stair-compliance": StairComplianceTool,
  "stormwater": StormwaterSizingTool,
  "ventilation": VentilationSizingTool,
  "fault-loop": FaultLoopTool,
  "pv-string": PVStringSizingTool,
  "dc-isolator": DCIsolatorTool,
  "battery-check": BatteryComplianceTool,
};

const Tools = () => {
  const [mode, setMode] = useState<ToolMode>("menu");
  const [checkingId, setCheckingId] = useState<ToolMode | null>(null);
  const navigate = useNavigate();
  const { data: profile } = useProfile();
  const isFree = (profile?.subscription_tier || "free") === "free";
  const profileTrades = profile?.trade_type ? profile.trade_type.split(",").filter(Boolean) : [];
  const isElectrical = profileTrades.includes("electrical");
  // has_setout_addon isn't in the generated Supabase types yet (new column) —
  // same `as any` escape hatch used elsewhere in this repo for newer columns.
  const hasSetoutAddon = Boolean((profile as { has_setout_addon?: boolean } | null)?.has_setout_addon);
  // Setout feature gated to electricians and HVAC techs
  const hasSetoutAccess = (profileTrades.includes("electrical") || profileTrades.includes("hvac")) && hasSetoutAddon;

  // Deep-link from Learn's Scenario Walkthrough ("Work this out in the
  // Cable Sizer tool" button) — same ?q= prefill pattern Chat.tsx uses.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const toolId = params.get("tool");
    if (toolId && TOOL_COMPONENTS[toolId]) {
      openTool(toolId as ToolMode);
      window.history.replaceState({}, "", window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (mode !== "menu") {
    const ToolComponent = TOOL_COMPONENTS[mode];
    if (ToolComponent) return <ToolComponent onBack={() => setMode("menu")} />;
  }

  const openTool = async (toolId: ToolMode) => {
    if (!isFree) { setMode(toolId); return; }
    setCheckingId(toolId);
    try {
      const { data, error } = await supabase.functions.invoke("check-tool-access", { body: { tool_id: toolId } });
      if (error || data?.allowed === false) {
        toast.error("You've used today's free access to this tool.", {
          description: "Upgrade to Pro for unlimited tool access.",
          action: { label: "Upgrade", onClick: () => navigate("/profile") },
        });
        return;
      }
      setMode(toolId);
    } catch {
      // Fail open — a network hiccup shouldn't lock a user out of a tool.
      setMode(toolId);
    } finally {
      setCheckingId(null);
    }
  };

  const categories = [...new Set(TOOLS.map(t => t.category))];

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-5 py-6 pb-24 md:pb-8 md:px-8 max-w-md md:max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Calculator className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="font-sans text-xl font-extrabold text-foreground">Trade Tools</h1>
          <p className="text-sm text-muted-foreground">{TOOLS.length} professional calculators</p>
        </div>
      </div>

      {hasSetoutAccess && (
        <Card
          className="p-4 mb-5 cursor-pointer hover:border-primary/50 transition-colors active:scale-[0.99] border-primary/20 bg-primary/5"
          onClick={() => navigate("/setout")}
        >
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Zap className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-foreground text-sm flex items-center gap-1.5">
                Rough-In Setout Assistant
                {!hasSetoutAddon && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {hasSetoutAddon
                  ? "Wall-locked measurements, spacing & circuit tagging for laser-up"
                  : "Add-on — unlock wall-locked setout measurements"}
              </p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          </div>
        </Card>
      )}

      {categories.map(cat => (
        <div key={cat} className="mb-5">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">{cat}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
            {TOOLS.filter(t => t.category === cat).map(tool => (
              <Card key={tool.id} className="p-4 cursor-pointer hover:border-primary/50 transition-colors active:scale-[0.99]"
                onClick={() => openTool(tool.id)}>
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-foreground text-sm">{tool.title}</p>
                    <p className="text-xs text-muted-foreground truncate">{tool.desc}</p>
                  </div>
                  {checkingId === tool.id
                    ? <Loader2 className="h-4 w-4 text-muted-foreground flex-shrink-0 animate-spin" />
                    : <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
                </div>
              </Card>
            ))}
          </div>
        </div>
      ))}
      </div>
    </div>
  );
};

export default Tools;
