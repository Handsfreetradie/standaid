import type { SetoutSymbolProps } from "./types";

const HeaterFanLight2Symbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <circle cx="12" cy="12" r="7" />
    <path d="M5 12h14" />
  </svg>
);

export default HeaterFanLight2Symbol;
