import type { SetoutSymbolProps } from "./types";

const RevCycleUnitSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <path d="M8 11.4a4 4 0 0 1 8 0" />
    <path d="M14.8 10.2 16 11.4l1.2-1.2" />
    <path d="M16 12.6a4 4 0 0 1-8 0" />
    <path d="M9.2 13.8 8 12.6l-1.2 1.2" />
  </svg>
);

export default RevCycleUnitSymbol;
