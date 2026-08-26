import type { SetoutSymbolProps } from "./types";

const MeterBoxSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <rect x="3.5" y="6.5" width="17" height="11" rx="1" />
    <path d="M3.5 11 8 6.5" />
    <path d="M3.5 15.5 12.5 6.5" />
  </svg>
);

export default MeterBoxSymbol;
