import type { SetoutSymbolProps } from "./types";

const VacuumUnitSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <rect x="6.5" y="4.5" width="9" height="15" rx="3" />
    <path d="M6.5 11h9" />
    <path d="M15.5 8.2h2.2l2 -2.2" />
  </svg>
);

export default VacuumUnitSymbol;
