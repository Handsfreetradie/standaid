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
    {/* A screen-on-a-stand — was a triangle before, too easily mistaken
        for the data outlet's triangle at a glance. */}
    <rect x="4" y="5.5" width="16" height="10.5" rx="1.5" />
    <path d="M9 19.5h6" />
    <path d="M12 16v3.5" />
  </svg>
);

export default TvPointSymbol;
