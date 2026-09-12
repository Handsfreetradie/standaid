import type { SetoutSymbolProps } from "./types";

// Same wall-contact convention as every other wall-mount symbol — see
// WallBattenHolderSymbol for why this can't draw its own (fixed-angle)
// wall line the way it used to.
const WallStairLightSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <path d="M5 20.5h14" />
    <rect x="7" y="11" width="10" height="7" rx="1.2" />
    <path d="M9 14.5h6" />
  </svg>
);

export default WallStairLightSymbol;
