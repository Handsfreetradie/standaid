import type { SetoutSymbolProps } from "./types";
import type { GpoVariant } from "@/lib/setoutTypes";

export interface GpoSymbolProps extends SetoutSymbolProps {
  count?: 1 | 2;
  variant?: GpoVariant;
}

const GpoSymbol = ({ size = 24, count = 1, variant = "standard", className, ...props }: GpoSymbolProps) => (
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
    {/* Weatherproof outline for an external GPO */}
    {variant === "external" && <rect x="2" y="1.5" width="20" height="21" rx="3" strokeDasharray="1.5 1.5" />}
    {/* A short offset tick for appliance-dedicated outlets, distinguishing dishwasher/microwave GPOs from a standard one */}
    {variant === "dishwasher" && <path d="M2 3.5h3" />}
    {variant === "microwave" && <path d="M19 3.5h3" />}
  </svg>
);

export default GpoSymbol;
