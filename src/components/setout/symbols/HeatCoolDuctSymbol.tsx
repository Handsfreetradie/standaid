import type { SetoutSymbolProps } from "./types";

const HeatCoolDuctSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <path d="M6.6 9h10.8" />
    <path d="M5.5 12h13" />
    <path d="M6.6 15h10.8" />
  </svg>
);

export default HeatCoolDuctSymbol;
