import type { SetoutSymbolProps } from "./types";

export interface GpoSymbolProps extends SetoutSymbolProps {
  count?: 1 | 2;
}

const GpoSymbol = ({ size = 24, count = 1, className, ...props }: GpoSymbolProps) => (
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
    <path d="M3 20h18" />
    <path d="M6 20a6 6 0 0 1 12 0" />
    {count === 2 ? (
      <>
        <path d="M9.5 14.6V8" />
        <path d="M14.5 14.6V8" />
      </>
    ) : (
      <path d="M12 14V7" />
    )}
  </svg>
);

export default GpoSymbol;
