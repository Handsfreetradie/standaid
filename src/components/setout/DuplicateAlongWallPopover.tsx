import { useState } from "react";
import { Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { DuplicateAlongWallMode } from "@/lib/setoutGeometry";

interface DuplicateAlongWallPopoverProps {
  /** false when the selected fitting has no wall to walk along yet — hides the trigger entirely. */
  available: boolean;
  /** True for a fitting mounted ON the wall (GPO, switch, ...); false for a ceiling fitting just borrowing a nearby wall's direction. */
  onWall: boolean;
  onConfirm: (input: { count: number; spacingMm: number; mode: DuplicateAlongWallMode }) => void;
}

// Offered alongside the other selected-fitting actions (Delete/Rotate/Lock
// live in FittingPalette) whenever exactly one wall-mounted or ceiling
// fitting is selected — copies it along the wall it's on (or, for a
// downlight, along a line parallel to the nearest wall) toward whichever end
// has more room.
const DuplicateAlongWallPopover = ({ available, onWall, onConfirm }: DuplicateAlongWallPopoverProps) => {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(3);
  const [spacingMm, setSpacingMm] = useState(1000);
  const [toEnd, setToEnd] = useState(false);

  if (!available) return null;

  const handleConfirm = () => {
    onConfirm({ count, spacingMm, mode: toEnd ? "toEnd" : "spacing" });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 w-full gap-1.5 justify-start text-muted-foreground">
          <Repeat className="h-3.5 w-3.5" />
          Repeat along wall
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="start">
        <p className="text-xs font-semibold text-foreground mb-1">Repeat along wall</p>
        <p className="text-[11px] text-muted-foreground mb-3">
          {onWall
            ? "Adds copies further along this wall, toward whichever end has more room."
            : "This is a ceiling fitting — copies are spaced along a straight line parallel to the nearest wall, not on it."}
        </p>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="repeat-count" className="text-xs">How many copies</Label>
            <Input
              id="repeat-count"
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              value={count}
              onChange={(e) => setCount(Math.max(1, Math.round(Number(e.target.value) || 1)))}
              className="h-9"
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="repeat-to-end" className="text-xs">To end of wall, evenly</Label>
            <Switch id="repeat-to-end" checked={toEnd} onCheckedChange={setToEnd} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="repeat-spacing" className="text-xs">Spacing (mm)</Label>
            <Input
              id="repeat-spacing"
              type="number"
              inputMode="numeric"
              min="1"
              step="10"
              disabled={toEnd}
              value={spacingMm}
              onChange={(e) => setSpacingMm(Math.max(1, Number(e.target.value) || 1))}
              className="h-9"
            />
            {toEnd && (
              <p className="text-[10px] text-muted-foreground">
                Spacing is worked out automatically so the last copy lands right on the wall's end.
              </p>
            )}
          </div>
          <Button size="sm" className="w-full" onClick={handleConfirm}>
            Add {count} {count === 1 ? "copy" : "copies"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default DuplicateAlongWallPopover;
