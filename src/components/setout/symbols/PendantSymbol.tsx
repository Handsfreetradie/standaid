import type { SetoutSymbolProps } from "./types";

const PendantSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <path d="M5 3h14" />
    <path d="M12 3v8" />
    <path d="M10 11h4l3.5 8h-11z" />
  </svg>
);

export default PendantSymbol;
