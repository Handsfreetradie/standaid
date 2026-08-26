import type { SetoutSymbolProps } from "./types";

export interface ParaFloodSymbolProps extends SetoutSymbolProps {
  count?: 1 | 2;
}

const ParaFloodSymbol = ({ size = 24, count = 1, className, ...props }: ParaFloodSymbolProps) => (
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
    {count === 2 ? (
      <>
        <path d="M7.2 16.8L3.8 8.4h6.8z" />
        <path d="M16.8 16.8L13.4 8.4h6.8z" />
        <circle cx="7.2" cy="18.8" r="1" fill="currentColor" stroke="none" />
        <circle cx="16.8" cy="18.8" r="1" fill="currentColor" stroke="none" />
      </>
    ) : (
      <>
        <path d="M12 16.8L6.5 6.5h11z" />
        <circle cx="12" cy="18.8" r="1.1" fill="currentColor" stroke="none" />
      </>
    )}
  </svg>
);

export default ParaFloodSymbol;
