import type { SetoutSymbolProps } from "./types";

// Wall-mount convention shared with OtherApplianceSymbol/SolarInverterSymbol
// — baseline at y=20, body above. "EV" in the box reads as an EV charger at
// a glance, same lettered-glyph convention as SmokeDetectorSymbol's "SD".
const EvChargerSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <path d="M4 20h16" />
    <rect x="5" y="6" width="14" height="12" rx="1.5" />
    <text
      x="12"
      y="12.5"
      textAnchor="middle"
      dominantBaseline="central"
      fontSize="7"
      fontWeight="600"
      letterSpacing="-0.3"
      fill="currentColor"
      stroke="none"
    >
      EV
    </text>
  </svg>
);

export default EvChargerSymbol;
