import type { SetoutSymbolProps } from "./types";

const WallBattenHolderSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <path d="M5 3.5v17" />
    <path d="M5 6.5a5.5 5.5 0 0 1 0 11" />
  </svg>
);

export default WallBattenHolderSymbol;
