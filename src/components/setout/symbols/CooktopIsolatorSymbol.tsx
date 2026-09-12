import type { SetoutSymbolProps } from "./types";

// Wall-mount convention shared with SwitchSymbol — baseline at y=20/21, body
// above. A toggle mark inside its own small enclosure (isolators are
// typically their own surface-mount unit, not a flush plate gang like a
// light switch) with a neon-indicator dot, so it reads as a dedicated
// isolator rather than a plain light switch at a glance.
const CooktopIsolatorSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <path d="M3 21h18" />
    <rect x="7" y="9" width="10" height="9" rx="1.5" />
    <path d="M12 15v-2.2" />
    <circle cx="12" cy="12.2" r="1.1" fill="currentColor" stroke="none" />
    <path d="M13 11.4 15.5 8.5" />
    <circle cx="9.3" cy="11" r="0.7" fill="currentColor" stroke="none" />
  </svg>
);

export default CooktopIsolatorSymbol;
