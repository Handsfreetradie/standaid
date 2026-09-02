import type { SetoutSymbolProps } from "./types";

const DataCabinetSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <rect x="5.5" y="10.5" width="2" height="3" rx="0.4" fill="currentColor" stroke="none" />
    <rect x="9" y="10.5" width="2" height="3" rx="0.4" fill="currentColor" stroke="none" />
    <rect x="12.5" y="10.5" width="2" height="3" rx="0.4" fill="currentColor" stroke="none" />
    <rect x="16" y="10.5" width="2" height="3" rx="0.4" fill="currentColor" stroke="none" />
  </svg>
);

export default DataCabinetSymbol;
