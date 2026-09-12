import type { SetoutSymbolProps } from "./types";

// A single plate combining a double GPO with a switch rocker between the two
// outlets (trade code "25XA") — a genuinely different physical device from a
// plain double GPO, not just a variant of it, so it gets its own glyph
// rather than a GpoSymbol spec option.
const GpoSwitchComboSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    {/* Left GPO outlet */}
    <path d="M6 20a2 2 0 0 1 4 0" />
    <path d="M8 18V15" />
    {/* Right GPO outlet */}
    <path d="M14 20a2 2 0 0 1 4 0" />
    <path d="M16 18V15" />
    {/* Centre switch toggle */}
    <path d="M12 20v-3.2" />
    <circle cx="12" cy="16.3" r="1.1" fill="currentColor" stroke="none" />
    <path d="M12.7 15.6 14.5 13.2" />
  </svg>
);

export default GpoSwitchComboSymbol;
