import type { SetoutSymbolProps } from "./types";

const EvapCoolingUnitSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <rect x="3" y="3" width="18" height="18" rx="1" />
    <circle cx="12" cy="12" r="9" />
  </svg>
);

export default EvapCoolingUnitSymbol;
