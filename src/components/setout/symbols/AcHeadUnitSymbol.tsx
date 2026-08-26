import type { SetoutSymbolProps } from "./types";

const AcHeadUnitSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <rect x="3" y="7" width="18" height="5.5" rx="1.5" />
    <path d="M14 14.5 16.5 18" />
    <path d="M17.5 14.5 20 18" />
  </svg>
);

export default AcHeadUnitSymbol;
