import type { SetoutSymbolProps } from "./types";

const AcCondenserSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <rect x="2.5" y="7.5" width="19" height="9" rx="1" />
    <circle cx="17" cy="12" r="2.8" />
  </svg>
);

export default AcCondenserSymbol;
