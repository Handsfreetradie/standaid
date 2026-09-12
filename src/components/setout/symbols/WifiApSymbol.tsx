import type { SetoutSymbolProps } from "./types";

// A ceiling-mount AP puck with the standard three-arc wifi glyph — reads as
// "wifi" at a glance the same way the standard icon does everywhere else,
// inside the small round body most ceiling APs actually come in.
const WifiApSymbol = ({ size = 24, className, ...props }: SetoutSymbolProps) => (
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
    <circle cx="12" cy="12" r="9.5" />
    <path d="M7.5 10.3a6.4 6.4 0 0 1 9 0" />
    <path d="M9.5 13a3.6 3.6 0 0 1 5 0" />
    <circle cx="12" cy="15.3" r="1" fill="currentColor" stroke="none" />
  </svg>
);

export default WifiApSymbol;
