import type { SetoutSymbolProps } from "./types";

// Wall-mount convention shared with SwitchboardSymbol/HotWaterUnitSymbol —
// baseline at y=20, body above. A box with a sun glyph reads as "solar" at
// a glance without needing a label.
const SolarInverterSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <rect x="4" y="4" width="16" height="16" rx="1.5" />
    <circle cx="12" cy="12" r="3" />
    <path d="M12 6.5V5" />
    <path d="M12 19V17.5" />
    <path d="M17.5 12H19" />
    <path d="M5 12H6.5" />
    <path d="M15.9 8.1 17 7" />
    <path d="M7 17 8.1 15.9" />
    <path d="M15.9 15.9 17 17" />
    <path d="M7 7l1.1 1.1" />
  </svg>
);

export default SolarInverterSymbol;
