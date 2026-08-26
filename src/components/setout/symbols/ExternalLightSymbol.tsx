import type { SetoutSymbolProps } from "./types";

const ExternalLightSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <path d="M4 8 12 3l8 5" />
    <circle cx="12" cy="14.5" r="5.5" />
  </svg>
);

export default ExternalLightSymbol;
