import type { SetoutSymbolProps } from "./types";

export interface DataOutletSymbolProps extends SetoutSymbolProps {
  ports?: 1 | 2 | 3 | 4 | 5 | 6;
}

const round = (n: number) => Math.round(n * 100) / 100;

// Same apex-triangle glyph as the single-port outlet, scaled down and
// repeated evenly along the baseline so multi-port outlets stay legible
// and inside x=3..21 with no overlap between triangles.
const portTrianglePath = (cx: number, halfBase: number, height: number) => {
  const apexY = round(20 - height);
  return `M${round(cx)} ${apexY} ${round(cx + halfBase)} 20h${round(-2 * halfBase)}Z`;
};

const DataOutletSymbol = ({ size = 24, ports = 1, className, ...props }: DataOutletSymbolProps) => {
  const triangles: string[] = [];
  if (ports <= 1) {
    triangles.push("M12 7.5 18.5 20h-13Z");
  } else {
    const slotWidth = 18 / ports;
    const halfBase = slotWidth * 0.38;
    const height = halfBase * (12.5 / 6.5);
    for (let i = 0; i < ports; i++) {
      const cx = 3 + slotWidth * (i + 0.5);
      triangles.push(portTrianglePath(cx, halfBase, height));
    }
  }

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
      <path d="M3 20h18" />
      {triangles.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
};

export default DataOutletSymbol;
