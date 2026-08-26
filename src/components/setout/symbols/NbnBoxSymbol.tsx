import type { SetoutSymbolProps } from "./types";

const NbnBoxSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <rect x="3.5" y="7" width="13" height="10" rx="1" />
    <path d="M16.5 12h4" />
  </svg>
);

export default NbnBoxSymbol;
