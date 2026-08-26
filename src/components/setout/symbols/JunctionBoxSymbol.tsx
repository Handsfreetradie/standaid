import type { SetoutSymbolProps } from "./types";

const JunctionBoxSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <rect x="4.5" y="4.5" width="15" height="15" rx="2.5" />
    <path d="M12 8v8" />
    <path d="M8 12h8" />
  </svg>
);

export default JunctionBoxSymbol;
