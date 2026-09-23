import type { SetoutSymbolProps } from "./types";

// Palette/legend glyphs for the wet-area reference fixtures (setoutWetZones.ts
// uses these purely to anchor Cl 6.2 zone polygons — they aren't electrical
// points). On the canvas itself these render as a to-scale footprint
// rectangle instead of this fixed-size icon; this is only for the palette
// list, quick-pick chips and any place a small glyph is needed.

export const BathSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <path d="M3 12h18v3a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4v-3Z" />
    <path d="M3 12V9a2 2 0 0 1 2-2" />
    <path d="M17 5.5c0-.83.67-1.5 1.5-1.5S20 4.67 20 5.5 19 8 19 8s-1-1.67-1-2.5Z" />
    <path d="M6 19v1" />
    <path d="M18 19v1" />
  </svg>
);

export const ShowerSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <rect x="4" y="3" width="16" height="18" rx="1.5" />
    <path d="M8 3v18" />
    <path d="M9 10h2" />
    <path d="M9 13h2" />
    <path d="M9 16h2" />
    <path d="M14 10h2" />
    <path d="M14 13h2" />
    <path d="M14 16h2" />
  </svg>
);

export const BasinSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <path d="M3 12h18" />
    <path d="M4 12a8 3 0 0 0 16 0" />
    <path d="M9 12V8a3 3 0 0 1 6 0v4" />
    <path d="M12 5V3" />
  </svg>
);
