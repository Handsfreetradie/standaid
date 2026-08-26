import type { SetoutSymbolProps } from "./types";

export interface DownlightSymbolProps extends SetoutSymbolProps {
  sizeMm?: 50 | 70 | 90;
}

// Radius scales with the real fitting diameter (90/70/50mm) so the three
// sizes read apart at a glance, matching how a drafted legend shows them.
const RADIUS_FOR_SIZE_MM: Record<50 | 70 | 90, number> = { 90: 7, 70: 5.5, 50: 4 };

const DownlightSymbol = ({ size = 24, sizeMm = 90, className, ...props }: DownlightSymbolProps) => {
  const r = RADIUS_FOR_SIZE_MM[sizeMm];
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
      <circle cx="12" cy="12" r={r} />
      <path d={`M12 ${12 - r}v${r * 2}`} />
      <path d={`M${12 - r} 12h${r * 2}`} />
    </svg>
  );
};

export default DownlightSymbol;
