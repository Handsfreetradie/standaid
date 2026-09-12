import type { SetoutSymbolProps } from "./types";

// Same wall-contact convention as every other wall-mount symbol (Gpo,
// Switch, Thermostat...): a horizontal baseline near the bottom of the
// 24-unit box, body projecting up from it — never a wall line of its own.
// SetoutCanvas rotates the whole icon around that baseline to match the
// real wall's angle, so drawing a fixed vertical "wall" here (as this used
// to) rotates right along with it and ends up pointing off at whatever
// angle the wall actually is, instead of lying flush against it.
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
    <path d="M6 20.5h12" />
    <path d="M8 20.5v-8.5a4 4 0 0 1 8 0v8.5" />
  </svg>
);

export default WallBattenHolderSymbol;
