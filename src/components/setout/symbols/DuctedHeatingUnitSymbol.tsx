import type { SetoutSymbolProps } from "./types";

const DuctedHeatingUnitSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <rect x="3" y="5" width="18" height="14" rx="1" />
    <path d="M4.5 6.5 19.5 17.5" />
    <path d="M19.5 6.5 4.5 17.5" />
  </svg>
);

export default DuctedHeatingUnitSymbol;
