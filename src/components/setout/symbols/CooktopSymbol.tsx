import type { SetoutSymbolProps } from "./types";

// Wall-mount convention shared with GpoSymbol/SwitchSymbol — a horizontal
// baseline at y=20 is the wall-contact edge, body projects into the room
// above it. Represents the isolator/connection point for a cooktop, not the
// appliance itself.
const CooktopSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <rect x="6" y="9" width="12" height="9" rx="1" />
    <circle cx="9.5" cy="12.5" r="1" fill="currentColor" stroke="none" />
    <circle cx="14.5" cy="12.5" r="1" fill="currentColor" stroke="none" />
    <circle cx="9.5" cy="15.5" r="1" fill="currentColor" stroke="none" />
    <circle cx="14.5" cy="15.5" r="1" fill="currentColor" stroke="none" />
  </svg>
);

export default CooktopSymbol;
