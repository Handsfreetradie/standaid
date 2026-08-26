import type { SetoutSymbolProps } from "./types";

export interface Fluoro1200SymbolProps extends SetoutSymbolProps {
  count?: 1 | 2;
}

const Fluoro1200Symbol = ({ size = 24, count = 1, className, ...props }: Fluoro1200SymbolProps) => (
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
    {count === 2 ? (
      <>
        <rect x="2" y="6.5" width="20" height="4.5" rx="2.25" />
        <rect x="2" y="13" width="20" height="4.5" rx="2.25" />
      </>
    ) : (
      <rect x="2" y="9.5" width="20" height="5" rx="2.5" />
    )}
  </svg>
);

export default Fluoro1200Symbol;
