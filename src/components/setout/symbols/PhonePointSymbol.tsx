import type { SetoutSymbolProps } from "./types";

const PhonePointSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <path d="M7 18.6V3.6" />
    <path d="M7 4.2 16 7.4 7 10.6Z" />
    <circle cx="7" cy="20.2" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

export default PhonePointSymbol;
