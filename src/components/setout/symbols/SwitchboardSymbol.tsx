import type { SetoutSymbolProps } from "./types";

const SwitchboardSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <rect x="3" y="4" width="18" height="16" rx="1" />
    <path d="M13 6.5 8.3 13h3.6l-1 4.5 5.8-7.5h-3.6z" fill="currentColor" stroke="none" />
  </svg>
);

export default SwitchboardSymbol;
