import type { Unit } from "./units";

/**
 * Een gemeten waarde, of de reden dat er geen is.
 *
 * Dit is het type waar de hele rekenmotor op draait, en het bestaat voor één
 * zin uit spec §12.1:
 *
 *   "A metric can be unavailable rather than zero. Missing data and true zero
 *    are different states."
 *
 * Met `number | null` is dat een afspraak. Met dit type is het een eigenschap:
 * er is geen functie in lib/screening/ die `number | null` teruggeeft, dus er is
 * geen plek waar een ontbrekende waarde stilletjes als 0 verder kan rekenen.
 *
 * De reden reist mee omdat het scherm er iets anders mee moet. "Alleen links
 * gemeten" is een actie voor de tester, "classificatie uitgezet" is een
 * beslissing van de praktijk, en "geen regel voor dit protocol" is een gat in de
 * seed. Drie keer geen waarde, drie verschillende vervolgstappen.
 */

/** Spiegelt public.unavailable_reason uit 20261009090000_screening_types.sql. */
export type UnavailableReason =
  | "missing_input"
  | "zero_denominator"
  | "single_side_only"
  | "protocol_mismatch"
  | "unit_mismatch"
  | "no_body_mass"
  | "classification_disabled"
  | "no_rule_for_protocol"
  | "no_baseline";

export type Measured =
  | { readonly ok: true; readonly value: number; readonly unit: Unit }
  | { readonly ok: false; readonly reason: UnavailableReason };

export function measured(value: number, unit: Unit): Measured {
  return { ok: true, value, unit };
}

export function unavailable(reason: UnavailableReason): Measured {
  return { ok: false, reason };
}

/**
 * Een ruwe waarde uit de databank naar een Measured.
 *
 * `null` betekent daar: hoorde bij deze test, niet gemeten. Dat is precies
 * `missing_input` en niet 0. Zie de kolomopmerking op medical.measurements.value.
 */
export function fromNullable(
  value: number | null | undefined,
  unit: Unit,
  reason: UnavailableReason = "missing_input",
): Measured {
  if (value === null || value === undefined) return unavailable(reason);
  // NaN en Infinity horen niet in een meting. Ze ontstaan uit een deling door
  // nul die ergens anders niet opgevangen is, en als ze hier doorglippen komen
  // ze in een grafiek terecht als een gat zonder uitleg.
  if (!Number.isFinite(value)) return unavailable("missing_input");
  return measured(value, unit);
}

/** Alle invoer aanwezig, of de eerste reden dat dat niet zo is. */
export function allOk(
  inputs: readonly Measured[],
): { ok: true; values: Array<{ value: number; unit: Unit }> } | { ok: false; reason: UnavailableReason } {
  const values: Array<{ value: number; unit: Unit }> = [];
  for (const input of inputs) {
    if (!input.ok) return { ok: false, reason: input.reason };
    values.push({ value: input.value, unit: input.unit });
  }
  return { ok: true, values };
}

/**
 * Een berekend getal naar een Measured, met de deling-door-nul-wacht erin.
 *
 * Elke formule in derive.ts loopt hier doorheen, zodat `Infinity` nooit als
 * waarde de databank in kan. Een ratio met noemer 0 is geen oneindig grote
 * ratio maar een onberekenbare.
 */
export function finite(value: number, unit: Unit): Measured {
  if (!Number.isFinite(value)) return unavailable("zero_denominator");
  return measured(value, unit);
}
