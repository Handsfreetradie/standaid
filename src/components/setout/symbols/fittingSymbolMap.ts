import type { ComponentType } from "react";
import DataOutletSymbol from "./DataOutletSymbol";
import DownlightSymbol from "./DownlightSymbol";
import ExhaustFanSymbol from "./ExhaustFanSymbol";
import GpoSymbol from "./GpoSymbol";
import SmokeDetectorSymbol from "./SmokeDetectorSymbol";
import SwitchSymbol from "./SwitchSymbol";
import type { FittingType, SetoutSymbolProps } from "./types";

export const FITTING_SYMBOLS: Record<FittingType, ComponentType<SetoutSymbolProps>> = {
  downlight: DownlightSymbol,
  gpo: GpoSymbol,
  switch: SwitchSymbol,
  smoke_detector: SmokeDetectorSymbol,
  data: DataOutletSymbol,
  exhaust_fan: ExhaustFanSymbol,
};

export const FITTING_LABELS: Record<FittingType, string> = {
  downlight: "Downlight",
  gpo: "GPO",
  switch: "Light switch",
  smoke_detector: "Smoke alarm",
  data: "Data outlet",
  exhaust_fan: "Exhaust fan",
};
