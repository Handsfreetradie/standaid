import type { SetoutSymbolProps } from "./types";

// Wall-mount convention shared with HotWaterUnitSymbol/CooktopSymbol —
// baseline at y=20, body above. Represents the isolator/connection point for
// a spa or pool heater, not the heater itself (pool-side equipment).
const SpaPoolHeaterSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <rect x="5" y="6" width="14" height="12" rx="1.5" />
    <path d="M8 16.5c1-1 2-1 3 0s2 1 3 0 2-1 3 0" />
    <path d="M12 12.5V9" />
    <path d="M10.5 10 12 8.3 13.5 10" />
  </svg>
);

export default SpaPoolHeaterSymbol;
