import type { SetoutSymbolProps } from "./types";
import type { GpoVariant } from "@/lib/setoutTypes";

export interface GpoSymbolProps extends SetoutSymbolProps {
  count?: 1 | 2 | 4;
  variant?: GpoVariant;
}

// A double/4-gang GPO is drawn as that many separate outlet bodies — each
// its own dome-and-pin "arm" — side by side, the way a real double or quad
// power point plate actually looks (two or four outlets on one plate),
// rather than one wide body with extra tick marks inside it. The arms split
// the same central span a single GPO's body already occupied (6–18, leaving
// the 3–6 and 18–21 baseline "tails" as mounting-plate margin at every gang
// count) — a single GPO is exactly the count=1 case of this same shape.
const BASE_X0 = 3;
const BASE_X1 = 21;
const BASE_Y = 20;
const ARM_REGION_X0 = 6;
const ARM_REGION_X1 = 18;

const GpoSymbol = ({ size = 24, count = 1, variant = "standard", className, ...props }: GpoSymbolProps) => {
  const armWidth = (ARM_REGION_X1 - ARM_REGION_X0) / count;
  const radius = armWidth / 2;
  const pinLength = radius + 1;
  const arms = Array.from({ length: count }, (_, i) => {
    const cx = ARM_REGION_X0 + armWidth * (i + 0.5);
    const peakY = BASE_Y - radius;
    return { cx, peakY, pinTopY: peakY - pinLength };
  });

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      <path d={`M${BASE_X0} ${BASE_Y}h${BASE_X1 - BASE_X0}`} />
      {arms.map((arm, i) => (
        <g key={i}>
          <path d={`M${arm.cx - radius} ${BASE_Y}a${radius} ${radius} 0 0 1 ${radius * 2} 0`} />
          <path d={`M${arm.cx} ${arm.peakY}V${arm.pinTopY}`} />
        </g>
      ))}
      {/* Weatherproof outline for an external GPO */}
      {variant === "external" && <rect x="2" y="1.5" width="20" height="21" rx="3" strokeDasharray="1.5 1.5" />}
    </svg>
  );
};

export default GpoSymbol;
