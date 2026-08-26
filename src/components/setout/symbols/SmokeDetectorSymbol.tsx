import type { SetoutSymbolProps } from "./types";

const SmokeDetectorSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <text
      x="12"
      y="12"
      textAnchor="middle"
      dominantBaseline="central"
      fontSize="8"
      fontWeight="600"
      letterSpacing="-0.3"
      fill="currentColor"
      stroke="none"
    >
      SD
    </text>
  </svg>
);

export default SmokeDetectorSymbol;
