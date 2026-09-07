// Everything is STORED in metres, because that's what the geometry works in.
// Everything is SHOWN in millimetres, because that's what a tradie works in —
// a setout is "2400", never "2.4". These are the only places the two meet, so
// conversions don't get scattered through the UI.

/** Metres to whole millimetres. */
export function toMm(metres: number): number {
  return Math.round(metres * 1000);
}

/** Millimetres back to metres, for anything typed in. */
export function fromMm(mm: number): number {
  return mm / 1000;
}

/** A measurement for display, in millimetres, with the unit. */
export function formatMm(metres: number): string {
  return `${toMm(metres)}mm`;
}

/** The same number without the unit, for input fields and table cells. */
export function mmValue(metres: number): string {
  return String(toMm(metres));
}
