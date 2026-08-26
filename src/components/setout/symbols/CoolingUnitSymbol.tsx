import type { SetoutSymbolProps } from "./types";

const CoolingUnitSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <rect x="4" y="6" width="16" height="12" rx="1" />
    <path d="M12 8.5v7" />
    <path d="M8.97 10.25 15.03 13.75" />
    <path d="M8.97 13.75 15.03 10.25" />
  </svg>
);

export default CoolingUnitSymbol;
