import type { SetoutSymbolProps } from "./types";

const ReturnAirSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <rect x="3" y="6" width="18" height="12" rx="1" />
    <path d="M5.5 12h8" />
    <path d="M10.5 9 13.5 12l-3 3" />
  </svg>
);

export default ReturnAirSymbol;
