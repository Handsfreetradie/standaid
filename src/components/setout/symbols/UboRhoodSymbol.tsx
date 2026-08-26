import type { SetoutSymbolProps } from "./types";

const UboRhoodSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <circle cx="12" cy="8.5" r="3.25" />
    <circle cx="12" cy="8.5" r="1" fill="currentColor" stroke="none" />
    <path d="M12 20.5v-8.75" />
    <path d="M7.5 20.5h9" />
  </svg>
);

export default UboRhoodSymbol;
