import type { SetoutSymbolProps } from "./types";

const CeilingFanLightSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    {/* Identical fan to CeilingFanSymbol — kept pixel-for-pixel the same so
        the "fan" half of this reads consistently. A small sunburst badge
        outside the blade circle (not just a bigger hub dot, too subtle to
        tell apart at small render sizes) marks the light. */}
    <g fill="currentColor" stroke="none">
      <ellipse cx="12" cy="7.2" rx="1.7" ry="4" />
      <ellipse cx="12" cy="7.2" rx="1.7" ry="4" transform="rotate(120 12 12)" />
      <ellipse cx="12" cy="7.2" rx="1.7" ry="4" transform="rotate(240 12 12)" />
    </g>
    <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <g transform="translate(19 5)">
      <circle r="1.6" />
      <path d="M0 -3.2v1" />
      <path d="M0 3.2v-1" />
      <path d="M-3.2 0h1" />
      <path d="M3.2 0h1" />
    </g>
  </svg>
);

export default CeilingFanLightSymbol;
