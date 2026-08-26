import type { SetoutSymbolProps } from "./types";

const ThermostatSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <circle cx="12" cy="10" r="5.5" />
    <path d="M12 10 15.2 6.8" />
    <circle cx="12" cy="10" r="1" fill="currentColor" stroke="none" />
    <path d="M12 15.5V19" />
    <path d="M7 19h10" />
  </svg>
);

export default ThermostatSymbol;
