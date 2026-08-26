import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import SetoutCanvas from "@/components/setout/SetoutCanvas";
import FittingPalette from "@/components/setout/FittingPalette";
import type { FittingType } from "@/components/setout/symbols";
import type { Point } from "@/lib/setoutTypes";
import {
  useSetoutPlan,
  useSetoutFittings,
  useCreateSetoutFitting,
  useUpdateSetoutFittingPosition,
  useDeleteSetoutFitting,
} from "@/hooks/useSetoutPlans";

const SetoutPlan = () => {
  const { planId } = useParams();
  const navigate = useNavigate();

  const { data: plan, isLoading: planLoading } = useSetoutPlan(planId);
  const { data: fittings = [], isLoading: fittingsLoading } = useSetoutFittings(planId);

  const createFitting = useCreateSetoutFitting(planId || "");
  const updateFittingPosition = useUpdateSetoutFittingPosition(planId || "");
  const deleteFitting = useDeleteSetoutFitting(planId || "");

  const [selectedType, setSelectedType] = useState<FittingType | null>(null);
  const [selectedFittingId, setSelectedFittingId] = useState<string | null>(null);

  const handlePlaceFitting = (point: Point) => {
    if (!selectedType) return;
    createFitting.mutate({ type: selectedType, position: point });
    // Deliberately kept selected rather than cleared — tradies place several
    // of the same fitting (e.g. a run of downlights) in a row, so forcing a
    // re-tap of the palette after every single placement would be worse UX.
    // Tap the already-selected type again (or select a different one) to
    // switch/deselect.
  };

  const handleFittingDrag = (fittingId: string, position: Point) => {
    updateFittingPosition.mutate({ fittingId, position });
  };

  const handleDeleteSelected = () => {
    if (!selectedFittingId) return;
    deleteFitting.mutate(selectedFittingId);
    setSelectedFittingId(null);
  };

  if (planLoading || fittingsLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="h-full overflow-y-auto px-5 py-6 pb-24 md:pb-8">
        <div className="max-w-2xl mx-auto">
          <button
            onClick={() => navigate("/setout")}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <p className="text-sm text-muted-foreground">Plan not found.</p>
        </div>
      </div>
    );
  }

  if (!plan.walls || plan.walls.length === 0) {
    return (
      <div className="h-full overflow-y-auto px-5 py-6 pb-24 md:pb-8">
        <div className="max-w-2xl mx-auto">
          <button
            onClick={() => navigate("/setout")}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <h2 className="font-sans text-lg font-extrabold text-foreground mb-1">{plan.name}</h2>
          <p className="text-xs text-muted-foreground mb-5">
            This plan doesn't have any walls set up yet. Set out the walls first, then come back here to place fittings.
          </p>
          <Button className="w-full h-12 font-bold rounded-xl text-base" onClick={() => navigate("/setout")}>
            Set up walls
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-5 py-6 pb-24 md:pb-8 max-w-2xl mx-auto flex flex-col h-full">
        <button
          onClick={() => navigate("/setout")}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <h2 className="font-sans text-lg font-extrabold text-foreground mb-4">{plan.name}</h2>

        <div className="flex-1 min-h-[420px] mb-4">
          <SetoutCanvas
            walls={plan.walls}
            fittings={fittings}
            mode="place-fittings"
            selectedFittingType={selectedType}
            onPlaceFitting={handlePlaceFitting}
            onFittingDrag={handleFittingDrag}
            selectedFittingId={selectedFittingId}
            onFittingSelect={setSelectedFittingId}
            className="h-full min-h-[420px]"
          />
        </div>

        <FittingPalette
          selectedType={selectedType}
          onSelectType={setSelectedType}
          selectedFittingId={selectedFittingId}
          onDeleteSelected={handleDeleteSelected}
        />
      </div>
    </div>
  );
};

export default SetoutPlan;
