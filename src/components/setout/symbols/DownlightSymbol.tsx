import type { SetoutSymbolProps } from "./types";

export interface DownlightSymbolProps extends SetoutSymbolProps {
  sizeMm?: 50 | 70 | 90 | 100;
  twin?: boolean;
  twinSpacingRatio?: number;
}

// Radius scales with the real fitting diameter (100/90/70/50mm) so the sizes
// read apart at a glance, matching how a drafted legend shows them. 100mm is
// the older-style "can" downlight — the biggest of the four.
const RADIUS_FOR_SIZE_MM: Record<50 | 70 | 90 | 100, number> = { 100: 8, 90: 7, 70: 5.5, 50: 4 };

const DownlightSymbol = ({
  size = 24,
  sizeMm = 90,
  twin = false,
  twinSpacingRatio = 0.55,
  className,
  ...props
}: DownlightSymbolProps) => {
  const r = RADIUS_FOR_SIZE_MM[sizeMm];

  // Twin glyphs sit either side of centre, spaced by twinSpacingRatio * 24,
  // shrunk from the base radius and clamped so neither circle clips the
  // viewBox edge or overlaps its twin.
  let leftCx = 12;
  let rightCx = 12;
  let twinRadius = r;
  if (twin) {
    const spacing = twinSpacingRatio * 24;
    leftCx = 12 - spacing / 2;
    rightCx = 12 + spacing / 2;
    const maxByGap = spacing / 2 - 1;
    const maxByEdge = Math.min(leftCx, 24 - rightCx) - 0.5;
    twinRadius = Math.min(r * 0.6, maxByGap, maxByEdge);
  }

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
      {twin ? (
        <>
          <circle cx={leftCx} cy="12" r={twinRadius} />
          <path d={`M${leftCx} ${12 - twinRadius}v${twinRadius * 2}`} />
          <path d={`M${leftCx - twinRadius} 12h${twinRadius * 2}`} />
          <circle cx={rightCx} cy="12" r={twinRadius} />
          <path d={`M${rightCx} ${12 - twinRadius}v${twinRadius * 2}`} />
          <path d={`M${rightCx - twinRadius} 12h${twinRadius * 2}`} />
        </>
      ) : (
        <>
          <circle cx="12" cy="12" r={r} />
          <path d={`M12 ${12 - r}v${r * 2}`} />
          <path d={`M${12 - r} 12h${r * 2}`} />
        </>
      )}
    </svg>
  );
};

export default DownlightSymbol;
