import type { SetoutSymbolProps } from "./types";

// A ceiling-mounted heat/vent/light panel (e.g. IXL Tastic-style) as seen
// from below: a square unit with its 4 heat lamp globes in the corners —
// drawn from what the fixture actually looks like rather than an abstract
// glyph, since AS1102 doesn't publish a specific pictogram for these combo
// units (just a labelled square).
const HeaterFanLight4Symbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <circle cx="8.5" cy="8.5" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="15.5" cy="8.5" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="8.5" cy="15.5" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="15.5" cy="15.5" r="1.3" fill="currentColor" stroke="none" />
  </svg>
);

export default HeaterFanLight4Symbol;
