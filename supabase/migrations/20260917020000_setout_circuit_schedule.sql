-- Structured circuit schedule fields — replaces the free-text-only
-- breaker_rating with the fields a licensed sparky actually expects on a
-- switchboard schedule (device type, poles, cable size/type, RCD
-- protection, notes). All nullable and additive: breaker_rating stays
-- exactly as-is (existing data untouched, still the fallback display for a
-- circuit that predates this migration), and every existing plan renders
-- and exports fine with these columns null — CircuitsPanel/
-- SwitchboardLegendPreview/setoutReport.ts all degrade to "—" when unset.

ALTER TABLE public.setout_circuits ADD COLUMN IF NOT EXISTS device_type TEXT
  CHECK (device_type IN ('mcb', 'rcbo', 'rcd_mcb', 'main_switch', 'other'));

ALTER TABLE public.setout_circuits ADD COLUMN IF NOT EXISTS rcd_protected BOOLEAN;

-- 1 = single-phase final subcircuit (the domestic norm), 3 = three-phase
-- (e.g. a 3-phase oven/cooktop/EV charger circuit on a 3-phase supply). No
-- CHECK beyond the column type — smallint keeps it compact, the 1-or-3
-- constraint is enforced client-side same as every other small closed set
-- in this schema (setout_fittings.type/category have none either).
ALTER TABLE public.setout_circuits ADD COLUMN IF NOT EXISTS poles SMALLINT;

ALTER TABLE public.setout_circuits ADD COLUMN IF NOT EXISTS cable_csa_mm2 NUMERIC;

-- 'tps', 'xlpe', 'orange_circular' (underground/flexible circular) etc —
-- open text rather than a CHECK, matching circuit_type/setout_fittings.type
-- elsewhere in this schema (gated by the TypeScript union client-side).
ALTER TABLE public.setout_circuits ADD COLUMN IF NOT EXISTS cable_type TEXT;

ALTER TABLE public.setout_circuits ADD COLUMN IF NOT EXISTS notes TEXT;

COMMENT ON COLUMN public.setout_circuits.device_type IS
  'Protective device fitted for this circuit — mcb/rcbo/rcd_mcb/main_switch/other. Null on circuits saved before this column existed.';
COMMENT ON COLUMN public.setout_circuits.rcd_protected IS
  'Whether this circuit has 30mA RCD protection, either built into the device (rcbo/rcd_mcb) or from a separate shared RCD. Null = unknown (old plan).';
COMMENT ON COLUMN public.setout_circuits.poles IS
  '1 (single-phase) or 3 (three-phase) — number of poles the device switches.';
COMMENT ON COLUMN public.setout_circuits.cable_csa_mm2 IS
  'Conductor cross-sectional area in mm^2, e.g. 1.5, 2.5, 6.';
COMMENT ON COLUMN public.setout_circuits.cable_type IS
  'Cable construction/insulation, e.g. tps, xlpe, orange_circular.';
