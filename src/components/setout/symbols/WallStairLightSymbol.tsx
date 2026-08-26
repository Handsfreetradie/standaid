import type { SetoutSymbolProps } from "./types";

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
    <path d="M4.5 3.5v17" />
    <rect x="4.5" y="8" width="12" height="8" rx="1.5" />
    <path d="M6.5 12h8" />
  </svg>
);

export default WallStairLightSymbol;
