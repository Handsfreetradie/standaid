import type { SetoutSymbolProps } from "./types";

const MotionSensorSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <circle cx="12" cy="5.2" r="1.5" fill="currentColor" stroke="none" />
    <path d="M12 7.5L6.2 17a8 8 0 0 0 11.6 0z" />
  </svg>
);

export default MotionSensorSymbol;
