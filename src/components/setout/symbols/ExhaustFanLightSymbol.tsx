import type { SetoutSymbolProps } from "./types";

const ExhaustFanLightSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <circle cx="11" cy="11" r="8" />
    <path d="M4.5 11a3.25 3.25 0 0 1 6.5 0 3.25 3.25 0 0 0 6.5 0" />
    <circle cx="11" cy="11" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="20.6" cy="20.6" r="1.7" fill="currentColor" stroke="none" />
  </svg>
);

export default ExhaustFanLightSymbol;
