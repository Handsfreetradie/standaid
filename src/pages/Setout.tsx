import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, ChevronRight, Loader2, Trash2, FileImage, PencilRuler, Zap } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import CalibrationImportFlow from "@/components/setout/CalibrationImportFlow";
import DrawWallsFlow from "@/components/setout/DrawWallsFlow";
import { useCreateSetoutPlan, useDeleteSetoutPlan, useSetoutPlans } from "@/hooks/useSetoutPlans";
import type { PlanSourceType, SetoutPlan as SetoutPlanRow } from "@/lib/setoutTypes";

type ViewState = { kind: "list" } | { kind: "create" } | { kind: "setup"; plan: SetoutPlanRow };

const Setout = () => {
  const navigate = useNavigate();
  const { data: plans, isLoading } = useSetoutPlans();
  const createPlan = useCreateSetoutPlan();
  const deletePlan = useDeleteSetoutPlan();

  const [view, setView] = useState<ViewState>({ kind: "list" });
  const [name, setName] = useState("");
  const [jobReference, setJobReference] = useState("");
  const [sourceType, setSourceType] = useState<PlanSourceType>("draw");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) return;
    const plan = await createPlan.mutateAsync({
      name: name.trim(),
      job_reference: jobReference.trim() || undefined,
      source_type: sourceType,
    });
    setName("");
    setJobReference("");
    setView({ kind: "setup", plan });
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this plan? This cannot be undone.")) return;
    setDeletingId(id);
    await deletePlan.mutateAsync(id).finally(() => setDeletingId(null));
  };

  if (view.kind === "setup") {
    const onComplete = () => navigate(`/setout/${view.plan.id}`);
    const onBack = () => setView({ kind: "list" });
    return view.plan.source_type === "import" ? (
      <CalibrationImportFlow plan={view.plan} onBack={onBack} onComplete={onComplete} />
    ) : (
      <DrawWallsFlow plan={view.plan} onBack={onBack} onComplete={onComplete} />
    );
  }

  return (
    <div className="h-full overflow-y-auto px-5 py-6 pb-24 md:pb-10">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-extrabold text-foreground flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" /> Rough-In Setout
          </h1>
          <Button size="sm" onClick={() => setView({ kind: view.kind === "create" ? "list" : "create" })} className="gap-1.5">
            <Plus className="h-4 w-4" /> New Plan
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mb-5">
          Wall-locked measurements for laser-up — not a certified lighting or lux calculation. Always verify on site.
        </p>

        {view.kind === "create" && (
          <Card className="p-4 mb-5 space-y-3">
            <Input placeholder="Plan name (e.g. 12 Smith St — Lounge)" value={name} onChange={(e) => setName(e.target.value)} />
            <Input placeholder="Job reference (optional)" value={jobReference} onChange={(e) => setJobReference(e.target.value)} />
            <div>
              <p className="text-xs font-semibold text-foreground mb-1.5">How do you want to set out this room?</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSourceType("draw")}
                  className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition-colors ${
                    sourceType === "draw" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
                  }`}
                >
                  <PencilRuler className="h-5 w-5" />
                  <span className="text-xs font-semibold">Draw on site</span>
                  <span className="text-[11px]">Sketch the frame, type real lengths</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSourceType("import")}
                  className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition-colors ${
                    sourceType === "import" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
                  }`}
                >
                  <FileImage className="h-5 w-5" />
                  <span className="text-xs font-semibold">Upload plan</span>
                  <span className="text-[11px]">Builder's PDF or photo, calibrate scale</span>
                </button>
              </div>
            </div>
            <Button className="w-full gap-1.5" onClick={handleCreate} disabled={createPlan.isPending || !name.trim()}>
              {createPlan.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Create plan
            </Button>
          </Card>
        )}

        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : !plans || plans.length === 0 ? (
          <div className="text-center py-16 text-sm text-muted-foreground">
            No plans yet. Tap <span className="font-semibold text-foreground">New Plan</span> to start one.
          </div>
        ) : (
          <div className="space-y-2">
            {plans.map((p) => {
              const hasWalls = p.walls.length > 0;
              return (
                <Card
                  key={p.id}
                  className="p-3 flex items-center gap-3 cursor-pointer hover:bg-secondary/50 transition-colors"
                  onClick={() => (hasWalls ? navigate(`/setout/${p.id}`) : setView({ kind: "setup", plan: p }))}
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 flex-shrink-0">
                    <Zap className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{p.name}</p>
                    <div className="flex items-center gap-1.5">
                      {p.job_reference && <p className="text-xs text-muted-foreground truncate">{p.job_reference}</p>}
                      {!hasWalls && <Badge variant="outline" className="text-[10px] px-1.5 py-0">Setup incomplete</Badge>}
                    </div>
                  </div>
                  <Button
                    size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive flex-shrink-0"
                    onClick={(e) => { e.stopPropagation(); handleDelete(p.id); }}
                    disabled={deletingId === p.id}
                  >
                    {deletingId === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </Button>
                  <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default Setout;
