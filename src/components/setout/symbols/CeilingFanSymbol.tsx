import type { SetoutSymbolProps } from "./types";

const CeilingFanSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <circle cx="12" cy="12" r="8" />
    <path d="M13.97 9.74Q14.6 6.8 12 4.6" />
    <path d="M12.97 14.84Q15.2 16.85 18.41 15.7" />
    <path d="M9.06 11.42Q6.2 12.35 5.59 15.7" />
  </svg>
);

export default CeilingFanSymbol;
