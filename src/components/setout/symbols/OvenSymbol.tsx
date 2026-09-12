import type { SetoutSymbolProps } from "./types";

// Wall-mount convention shared with CooktopSymbol/GpoSymbol — baseline at
// y=20, body above. A door window + control strip distinguishes it from
// CooktopSymbol's four-burner-dot layout at a glance.
const OvenSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <rect x="5" y="4" width="14" height="16" rx="1" />
    <path d="M5 8h14" />
    <rect x="7" y="10.5" width="10" height="7" rx="0.5" />
    <circle cx="8.5" cy="6" r="0.6" fill="currentColor" stroke="none" />
    <circle cx="11" cy="6" r="0.6" fill="currentColor" stroke="none" />
  </svg>
);

export default OvenSymbol;
