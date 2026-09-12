import type { SetoutSymbolProps } from "./types";

// Same dial-and-drop-leg shape as ThermostatSymbol (wall-mount convention,
// baseline at y=19) but with a wavy floor-line under it instead of the
// plain baseline, so it doesn't read as a duplicate of the AC/ducted stat
// once both are sitting in the same palette section.
const UnderfloorHeatingStatSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <circle cx="12" cy="9" r="5" />
    <path d="M12 9 14.8 6.2" />
    <circle cx="12" cy="9" r="1" fill="currentColor" stroke="none" />
    <path d="M12 14V16.5" />
    <path d="M4 19.5c1.2-1.3 2.4-1.3 3.6 0s2.4 1.3 3.6 0 2.4-1.3 3.6 0 2.4 1.3 3.6 0" />
  </svg>
);

export default UnderfloorHeatingStatSymbol;
