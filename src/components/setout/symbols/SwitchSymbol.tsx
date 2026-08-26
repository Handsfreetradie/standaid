import type { SetoutSymbolProps } from "./types";

const SwitchSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <path d="M3 21h18" />
    <path d="M9 21v-3.2" />
    <circle cx="9" cy="16.5" r="1.4" fill="currentColor" stroke="none" />
    <path d="M10.1 15.6 17 7.5" />
  </svg>
);

export default SwitchSymbol;
