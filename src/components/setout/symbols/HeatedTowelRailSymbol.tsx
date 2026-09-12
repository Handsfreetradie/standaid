import type { SetoutSymbolProps } from "./types";

// Wall-mount convention shared with HotWaterUnitSymbol/GpoSymbol — baseline
// at y=20, body above. A ladder-rail frame (rounded rect + horizontal
// rungs) for a heated towel rail's isolator/connection point.
const HeatedTowelRailSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <rect x="6" y="3" width="12" height="17" rx="2" />
    <path d="M8 7h8" />
    <path d="M8 10.5h8" />
    <path d="M8 14h8" />
    <path d="M8 17.5h8" />
  </svg>
);

export default HeatedTowelRailSymbol;
