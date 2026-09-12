import type { ComponentType } from "react";
import AcCondenserSymbol from "./AcCondenserSymbol";
import AcHeadUnitSymbol from "./AcHeadUnitSymbol";
import BattenHolderSymbol from "./BattenHolderSymbol";
import CeilingFanLightSymbol from "./CeilingFanLightSymbol";
import CeilingFanSymbol from "./CeilingFanSymbol";
import CooktopIsolatorSymbol from "./CooktopIsolatorSymbol";
import CooktopSymbol from "./CooktopSymbol";
import CoolingUnitSymbol from "./CoolingUnitSymbol";
import DataCabinetSymbol from "./DataCabinetSymbol";
import DataOutletSymbol from "./DataOutletSymbol";
import DownlightSymbol from "./DownlightSymbol";
import DuctedHeatingUnitSymbol from "./DuctedHeatingUnitSymbol";
import EvapCoolingDuctSymbol from "./EvapCoolingDuctSymbol";
import EvapCoolingUnitSymbol from "./EvapCoolingUnitSymbol";
import ExhaustFanLightSymbol from "./ExhaustFanLightSymbol";
import ExhaustFanSymbol from "./ExhaustFanSymbol";
import ExternalLightSymbol from "./ExternalLightSymbol";
import Fluoro1200Symbol from "./Fluoro1200Symbol";
import GpoSwitchComboSymbol from "./GpoSwitchComboSymbol";
import GpoSymbol from "./GpoSymbol";
import HeatCoolDuctSymbol from "./HeatCoolDuctSymbol";
import HeatedTowelRailSymbol from "./HeatedTowelRailSymbol";
import HeaterFanLight2Symbol from "./HeaterFanLight2Symbol";
import HeaterFanLight4Symbol from "./HeaterFanLight4Symbol";
import HeatingDuctSymbol from "./HeatingDuctSymbol";
import HotWaterUnitSymbol from "./HotWaterUnitSymbol";
import JunctionBoxSymbol from "./JunctionBoxSymbol";
import LedStripSymbol from "./LedStripSymbol";
import MeterBoxSymbol from "./MeterBoxSymbol";
import MotionSensorSymbol from "./MotionSensorSymbol";
import NbnBoxSymbol from "./NbnBoxSymbol";
import OtherApplianceSymbol from "./OtherApplianceSymbol";
import OvenSymbol from "./OvenSymbol";
import ParaFloodSymbol from "./ParaFloodSymbol";
import PendantSymbol from "./PendantSymbol";
import PhonePointSymbol from "./PhonePointSymbol";
import ReturnAirSymbol from "./ReturnAirSymbol";
import RevCycleUnitSymbol from "./RevCycleUnitSymbol";
import RoundFluoroSymbol from "./RoundFluoroSymbol";
import SmokeDetectorSymbol from "./SmokeDetectorSymbol";
import SolarInverterSymbol from "./SolarInverterSymbol";
import SpaPoolHeaterSymbol from "./SpaPoolHeaterSymbol";
import SwitchboardSymbol from "./SwitchboardSymbol";
import SwitchSymbol from "./SwitchSymbol";
import ThermostatSymbol from "./ThermostatSymbol";
import TvPointSymbol from "./TvPointSymbol";
import UboRhoodSymbol from "./UboRhoodSymbol";
import UnderfloorHeatingStatSymbol from "./UnderfloorHeatingStatSymbol";
import WallBattenHolderSymbol from "./WallBattenHolderSymbol";
import WallStairLightSymbol from "./WallStairLightSymbol";
import WifiApSymbol from "./WifiApSymbol";
import type { FittingType, SetoutSymbolProps } from "./types";

export const FITTING_SYMBOLS: Record<FittingType, ComponentType<SetoutSymbolProps>> = {
  // Lighting
  downlight: DownlightSymbol,
  batten_holder: BattenHolderSymbol,
  wall_batten_holder: WallBattenHolderSymbol,
  wall_stair_light: WallStairLightSymbol,
  external_light: ExternalLightSymbol,
  heater_fan_light_2: HeaterFanLight2Symbol,
  heater_fan_light_4: HeaterFanLight4Symbol,
  junction_box: JunctionBoxSymbol,
  ceiling_fan: CeilingFanSymbol,
  ceiling_fan_light: CeilingFanLightSymbol,
  para_flood: ParaFloodSymbol,
  round_fluoro: RoundFluoroSymbol,
  fluoro_1200: Fluoro1200Symbol,
  motion_sensor: MotionSensorSymbol,
  exhaust_fan: ExhaustFanSymbol,
  exhaust_fan_light: ExhaustFanLightSymbol,
  pendant: PendantSymbol,
  led_strip: LedStripSymbol,
  // Switches
  switch: SwitchSymbol,
  cooktop_isolator: CooktopIsolatorSymbol,
  // Power
  gpo: GpoSymbol,
  gpo_switch_combo: GpoSwitchComboSymbol,
  tv_point: TvPointSymbol,
  phone_point: PhonePointSymbol,
  meter_box: MeterBoxSymbol,
  nbn_box: NbnBoxSymbol,
  ubo_rhood: UboRhoodSymbol,
  switchboard: SwitchboardSymbol,
  cooktop: CooktopSymbol,
  oven: OvenSymbol,
  hot_water_unit: HotWaterUnitSymbol,
  spa_pool_heater: SpaPoolHeaterSymbol,
  other_appliance: OtherApplianceSymbol,
  solar_inverter: SolarInverterSymbol,
  // Data
  data: DataOutletSymbol,
  data_cabinet: DataCabinetSymbol,
  // Safety
  smoke_detector: SmokeDetectorSymbol,
  // Heat/cool
  heating_duct: HeatingDuctSymbol,
  ducted_heating_unit: DuctedHeatingUnitSymbol,
  heat_cool_duct: HeatCoolDuctSymbol,
  rev_cycle_unit: RevCycleUnitSymbol,
  thermostat: ThermostatSymbol,
  return_air: ReturnAirSymbol,
  evap_cooling_duct: EvapCoolingDuctSymbol,
  evap_cooling_unit: EvapCoolingUnitSymbol,
  ac_condenser: AcCondenserSymbol,
  ac_head_unit: AcHeadUnitSymbol,
  cooling_unit: CoolingUnitSymbol,
  heated_towel_rail: HeatedTowelRailSymbol,
  underfloor_heating_stat: UnderfloorHeatingStatSymbol,
  // Network
  wifi_ap: WifiApSymbol,
};

export const FITTING_LABELS: Record<FittingType, string> = {
  // Lighting
  downlight: "Downlight",
  batten_holder: "Batten holder",
  wall_batten_holder: "Wall light",
  wall_stair_light: "Wall stair light",
  external_light: "External light point",
  heater_fan_light_2: "Heater/fan/light (2 globe)",
  heater_fan_light_4: "Heater/fan/light (4 globe)",
  junction_box: "Junction box",
  ceiling_fan: "Ceiling fan",
  ceiling_fan_light: "Ceiling fan with light",
  para_flood: "Para flood light",
  round_fluoro: "Round fluoro",
  fluoro_1200: "1200mm fluoro",
  motion_sensor: "Motion sensor",
  exhaust_fan: "Exhaust fan",
  exhaust_fan_light: "Exhaust fan with light",
  pendant: "Suspended pendant",
  led_strip: "LED strip",
  // Switches
  switch: "Light switch",
  cooktop_isolator: "Cooktop isolating switch",
  // Power
  gpo: "GPO",
  gpo_switch_combo: "Double GPO + switch (25XA)",
  tv_point: "TV point",
  phone_point: "Telephone point",
  meter_box: "Meter box",
  nbn_box: "NBN box",
  ubo_rhood: "UBO/RHOOD connection",
  switchboard: "MSB",
  cooktop: "Cooktop",
  oven: "Oven",
  hot_water_unit: "Hot water system",
  spa_pool_heater: "Spa/pool heater",
  other_appliance: "Other appliance",
  solar_inverter: "Solar inverter",
  // Data
  data: "Data outlet",
  data_cabinet: "Data cabinet",
  // Safety
  smoke_detector: "Smoke alarm",
  // Heat/cool
  heating_duct: "Heating duct",
  ducted_heating_unit: "Ducted heating unit",
  heat_cool_duct: "Heat/cool duct",
  rev_cycle_unit: "Rev-cycle unit",
  thermostat: "Thermostat",
  return_air: "Return air",
  evap_cooling_duct: "Evap cooling duct",
  evap_cooling_unit: "Evap cooling unit",
  ac_condenser: "AC condenser",
  ac_head_unit: "AC head unit",
  cooling_unit: "Cooling unit",
  heated_towel_rail: "Heated towel rail",
  underfloor_heating_stat: "Underfloor heating stat",
  // Network
  wifi_ap: "WiFi access point",
};
