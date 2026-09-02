import type { SetoutSymbolProps } from "./types";

// Same panel convention as HeaterFanLight4Symbol, just the 2-globe layout —
// keeps the pair visually related (same unit family, fewer lamps) rather
// than two unrelated-looking glyphs.
const HeaterFanLight2Symbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <circle cx="12" cy="8.5" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="12" cy="15.5" r="1.5" fill="currentColor" stroke="none" />
  </svg>
);

export default HeaterFanLight2Symbol;
