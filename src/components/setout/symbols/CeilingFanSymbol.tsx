import type { SetoutSymbolProps } from "./types";

const CeilingFanSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <circle cx="12" cy="12" r="8" />
    {/* Three solid paddle blades around the hub — reads as a fan from
        below at a glance, unlike the old thin curved strokes. */}
    <g fill="currentColor" stroke="none">
      <ellipse cx="12" cy="7.2" rx="1.7" ry="4" />
      <ellipse cx="12" cy="7.2" rx="1.7" ry="4" transform="rotate(120 12 12)" />
      <ellipse cx="12" cy="7.2" rx="1.7" ry="4" transform="rotate(240 12 12)" />
    </g>
    <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
  </svg>
);

export default CeilingFanSymbol;
