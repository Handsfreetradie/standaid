import type { SetoutSymbolProps } from "./types";

export interface DataOutletSymbolProps extends SetoutSymbolProps {
  ports?: 1 | 2 | 3 | 4 | 5 | 6;
}

const round = (n: number) => Math.round(n * 100) / 100;

// AS/NZS convention draws a data/telecoms outlet as a downward-pointing
// triangle — apex touching the wall, base away from it — the opposite of
// what this used to draw (apex at the wall side, pointing away). Same
// scaled-down, evenly-repeated glyph for multi-port outlets as before, just
// flipped to match.
const portTrianglePath = (cx: number, halfBase: number, height: number) => {
  const baseY = round(20 - height);
  return `M${round(cx)} 20 ${round(cx + halfBase)} ${baseY}H${round(cx - halfBase)}Z`;
};

const DataOutletSymbol = ({ size = 24, ports = 1, className, ...props }: DataOutletSymbolProps) => {
  const triangles: string[] = [];
  if (ports <= 1) {
    triangles.push("M12 20 18.5 7.5H5.5Z");
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
