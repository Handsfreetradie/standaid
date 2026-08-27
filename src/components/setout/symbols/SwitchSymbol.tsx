import type { SetoutSymbolProps } from "./types";

export interface SwitchSymbolProps extends SetoutSymbolProps {
  gangCount?: 1 | 2 | 3 | 4;
}

// One flick-mark per gang, evenly spaced along the shared plate baseline —
// a 2-gang switch draws two independent toggle marks side by side, etc.
const SwitchSymbol = ({ size = 24, gangCount = 1, className, ...props }: SwitchSymbolProps) => {
  const spacing = 18 / (gangCount + 1);
  const positions = Array.from({ length: gangCount }, (_, i) => 3 + spacing * (i + 1));

  return (
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
      <path d="M3 21h18" />
      {positions.map((x, i) => (
        <g key={i}>
          <path d={`M${x} 21v-3.2`} />
          <circle cx={x} cy={16.5} r={1.4} fill="currentColor" stroke="none" />
          <path d={`M${x + 1} 15.7 L${x + 5} 10.5`} />
        </g>
      ))}
    </svg>
  );
};

export default SwitchSymbol;
