import type { SetoutSymbolProps } from "./types";

const EvapCoolingDuctSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <path d="M6 14.5 9 10l3 4.5 3-4.5 3 4.5" />
  </svg>
);

export default EvapCoolingDuctSymbol;
