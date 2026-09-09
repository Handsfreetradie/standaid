import type { SetoutSymbolProps } from "./types";

const LedStripSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <rect x="2" y="9" width="20" height="6" rx="3" />
    <g fill="currentColor" stroke="none">
      <circle cx="5" cy="12" r="1.1" />
      <circle cx="8.5" cy="12" r="1.1" />
      <circle cx="12" cy="12" r="1.1" />
      <circle cx="15.5" cy="12" r="1.1" />
      <circle cx="19" cy="12" r="1.1" />
    </g>
  </svg>
);

export default LedStripSymbol;
