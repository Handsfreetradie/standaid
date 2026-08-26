import type { SVGProps } from "react";

export interface SetoutSymbolProps extends Omit<SVGProps<SVGSVGElement>, "ref"> {
  size?: number;
  className?: string;
}

export type FittingType =
  | "downlight"
  | "gpo"
  | "switch"
  | "smoke_detector"
  | "data"
  | "exhaust_fan";
