import type { SetoutSymbolProps } from "./types";

// Wall-mount convention shared with GpoSymbol/SwitchSymbol — baseline at
// y=20, body above. A simple cylinder silhouette for a hot water system's
// isolator/connection point.
const HotWaterUnitSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <path d="M3 20h18" />
    <path d="M8 18V9a4 4 0 0 1 8 0v9" />
    <path d="M8 18h8" />
    <ellipse cx="12" cy="9" rx="4" ry="1.3" />
  </svg>
);

export default HotWaterUnitSymbol;
