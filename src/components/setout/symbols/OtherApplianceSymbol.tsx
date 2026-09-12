import type { SetoutSymbolProps } from "./types";

// Wall-mount convention shared with GpoSymbol/SwitchSymbol — baseline at
// y=20, body above. A generic isolator/connection point for an appliance
// with no dedicated symbol of its own (pool pump, spa, EV charger, etc.).
const OtherApplianceSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <rect x="7" y="9" width="10" height="9" rx="1.5" />
    <circle cx="12" cy="13.5" r="2" />
  </svg>
);

export default OtherApplianceSymbol;
