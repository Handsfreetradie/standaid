import type { SetoutSymbolProps } from "./types";

const VacuumOutletSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <circle cx="12" cy="12" r="5.5" />
    <path d="M9.3 12h5.4" />
  </svg>
);

export default VacuumOutletSymbol;
