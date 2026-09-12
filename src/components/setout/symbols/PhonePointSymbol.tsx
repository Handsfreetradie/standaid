import type { SetoutSymbolProps } from "./types";

// Same wall-contact convention as every other wall-mount symbol — see
// WallBattenHolderSymbol. This used to draw its pole off-centre (base at
// x=7, not the shared anchor's x=12), so rotating it to face a wall at a
// different angle swung the whole glyph sideways off its mount point.
// Centred on the anchor here, baseline at y=20.5, body rising above it.
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
    <path d="M9 20.5h6" />
    <path d="M12 20.5V6" />
    <path d="M12 6 19 9 12 12Z" />
  </svg>
);

export default PhonePointSymbol;
