import type { SetoutSymbolProps } from "./types";

const TvPointSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    {/* AS/NZS convention: a small box on a stem rising from the wall —
        matches the antenna/TV outlet symbol used on a real electrical
        drawing, not a screen-and-stand illustration. */}
    <path d="M12 20V12.5" />
    <rect x="9.5" y="8.5" width="5" height="4" />
  </svg>
);

export default TvPointSymbol;
