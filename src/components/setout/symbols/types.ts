import type { SVGProps } from "react";

export interface SetoutSymbolProps extends Omit<SVGProps<SVGSVGElement>, "ref"> {
  size?: number;
  className?: string;
}

export type FittingType =
  // Lighting
  | "downlight"
  | "batten_holder"
  | "wall_batten_holder"
  | "wall_stair_light"
  | "external_light"
  | "heater_fan_light_2"
  | "heater_fan_light_4"
  | "junction_box"
  | "ceiling_fan"
  | "ceiling_fan_light"
  | "para_flood"
  | "round_fluoro"
  | "fluoro_1200"
  | "motion_sensor"
  | "exhaust_fan"
  | "exhaust_fan_light"
  | "pendant"
  // Switches
  | "switch"
  // Power
  | "gpo"
  | "tv_point"
  | "phone_point"
  | "meter_box"
  | "nbn_box"
  | "ubo_rhood"
  | "switchboard"
  // Data
  | "data"
  | "data_cabinet"
  // Safety
  | "smoke_detector"
  // Heat/cool
  | "heating_duct"
  | "ducted_heating_unit"
  | "heat_cool_duct"
  | "rev_cycle_unit"
  | "thermostat"
  | "return_air"
  | "evap_cooling_duct"
  | "evap_cooling_unit"
  | "ac_condenser"
  | "ac_head_unit"
  | "cooling_unit"
  // Ducted vacuum
  | "vacuum_unit"
  | "vacuum_outlet";
