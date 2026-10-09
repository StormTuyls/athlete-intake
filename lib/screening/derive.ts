import { type Direction, isOrdered } from "./direction";
import {
  type Measured,
  allOk,
  finite,
  measured,
  unavailable,
} from "./measured";
import { GRAVITY, type Unit, comparable, toCanonical } from "./units";

/**
 * De afgeleide-metriekmotor. Spec §8.
 *
 * Elke functie hier is zuiver: invoer erin, Measured eruit, geen IO. Dat is
 * dezelfde opzet als lib/dossier/merge.ts en lib/dossier/completeness.ts, en om
 * dezelfde reden: de tabel uit de spec is dan regel voor regel een test.
 *
 * Drie regels die dit bestand afdwingt in plaats van documenteert:
 *
 *   1. Een deling door nul levert geen Infinity maar `zero_denominator`. Zie
 *      finite() in measured.ts.
 *   2. Een ratio over twee onvergelijkbare eenheden levert `unit_mismatch` en
 *      geen getal. Spec §8 bij H:Q: "Do not combine NordBord N with
 *      knee-extension N blindly."
 *   3. LSI krijgt de richting van de metriek mee en kent geen variant zonder.
 *      Zie lsi() hieronder.
 */

/**
 * Versie van de rekenmotor, geschreven naar medical.derived_results.engine_version.
 *
 * Verhoog dit bij elke wijziging die de UITKOMST van een bestaande formule
 * verandert. Niet bij een refactor, wel bij een correctie: spec §10 voorspelt er
 * al een (de bronbestanden noemen CMJ-RSI waar RSI-mod hoort), en zonder een
 * versienummer is achteraf niet te zien welke rijen nog de oude fout dragen.
 */
export const ENGINE_VERSION = 1;

export type FormulaKind =
  | "ratio"
  | "lsi_higher_better"
  | "lsi_lower_better"
  | "asymmetry"
  | "per_body_mass"
  | "per_body_weight"
  | "per_body_height"
  | "per_limb_length"
  | "sum"
  | "mean_of"
  | "percent_change";

export type LsiConvention = "involved_uninvolved" | "weaker_stronger";

/** Lichaamsmaten van de sessie zelf, niet uit het profiel. Spec §8. */
export interface SessionContext {
  readonly bodyMassKg: number | null;
  readonly bodyHeightCm: number | null;
  readonly limbLengthCm?: number | null;
}

// ── Verhoudingen ──────────────────────────────────────────────────────────────

/**
 * a / b, dimensieloos.
 *
 * Eist vergelijkbare eenheden. ADD:ABD over twee ForceFrame-metingen in N mag;
 * NordBord-N gedeeld door knie-extensie-Nm mag niet, en dat is geen smaak maar
 * spec §8: "Only if units, lever arms, angles and contraction modes are
 * comparable."
 *
 * De hefboom- en hoekcontrole kan dit bestand niet doen, want die staat op het
 * protocol. Die zit in de aanroeper, die beide protocolversies vergelijkt.
 */
export function ratio(a: Measured, b: Measured): Measured {
  const ok = allOk([a, b]);
  if (!ok.ok) return unavailable(ok.reason);
  const [x, y] = ok.values;
  if (!comparable(x.unit, y.unit)) return unavailable("unit_mismatch");
  const cx = toCanonical(x.value, x.unit);
  const cy = toCanonical(y.value, y.unit);
  if (cy.value === 0) return unavailable("zero_denominator");
  return finite(cx.value / cy.value, "ratio");
}

/**
 * Limb Symmetry Index, in procenten.
 *
 * Beide conventies leveren hetzelfde leesbare resultaat op: 100% is symmetrisch,
 * onder 100% is de aangedane (of zwakkere) zijde achter. Dat vraagt om twee
 * verschillende formules, en welke je nodig hebt hangt af van de richting van de
 * metriek:
 *
 *   higher_better (kracht, sprongafstand):  involved / uninvolved x100
 *   lower_better  (tijd, 6 m timed hop):    uninvolved / involved x100
 *
 * Spec §8 noemt het omdraaien hiervan expliciet een fout. Daarom is `direction`
 * een verplicht argument en bestaat er geen overload zonder. De waarde komt uit
 * metric_definitions.direction en niet van de aanroepplek.
 *
 * target_range en neutral hebben geen LSI: zonder ordening op de getallenlijn
 * betekent "symmetrisch beter" niets.
 */
export function lsi(
  involved: Measured,
  uninvolved: Measured,
  direction: Direction,
): Measured {
  if (!isOrdered(direction)) return unavailable("protocol_mismatch");
  const ok = allOk([involved, uninvolved]);
  if (!ok.ok) return unavailable(ok.reason);
  const [inv, uninv] = ok.values;
  if (!comparable(inv.unit, uninv.unit)) return unavailable("unit_mismatch");

  const ci = toCanonical(inv.value, inv.unit);
  const cu = toCanonical(uninv.value, uninv.unit);

  // Bij een tijdmetriek is de SNELLERE de betere, dus staat de aangedane zijde
  // in de noemer. Dit is de hele reden dat deze functie de richting kent.
  const [numerator, denominator] =
    direction === "higher_better" ? [ci.value, cu.value] : [cu.value, ci.value];

  if (denominator === 0) return unavailable("zero_denominator");
  return finite((numerator / denominator) * 100, "percent");
}

/**
 * Asymmetrie: |L-R| / max(L,R) x100.
 *
 * Richtingloos met opzet: dit is een grootte, geen oordeel. Welke zijde lager is
 * reist apart mee, want spec §11 eist dat naast de grootte ook de richting
 * getoond wordt ("Display direction (which side is lower/higher)"). Alleen een
 * percentage laat zien DAT er verschil is en niet waar.
 */
export function asymmetry(
  left: Measured,
  right: Measured,
): { result: Measured; lowerSide: "left" | "right" | null } {
  const ok = allOk([left, right]);
  if (!ok.ok) {
    // Precies de situatie die spec §12.1 benoemt: één zijde gemeten is iets
    // anders dan niets gemeten. De tester kan er nog iets aan doen.
    const reason = ok.reason === "missing_input" ? "single_side_only" : ok.reason;
    return { result: unavailable(reason), lowerSide: null };
  }
  const [l, r] = ok.values;
  if (!comparable(l.unit, r.unit)) {
    return { result: unavailable("unit_mismatch"), lowerSide: null };
  }
  const cl = toCanonical(l.value, l.unit);
  const cr = toCanonical(r.value, r.unit);
  const max = Math.max(Math.abs(cl.value), Math.abs(cr.value));
  if (max === 0) return { result: unavailable("zero_denominator"), lowerSide: null };

  const result = finite((Math.abs(cl.value - cr.value) / max) * 100, "percent");
  const lowerSide =
    cl.value === cr.value ? null : cl.value < cr.value ? "left" : "right";
  return { result, lowerSide };
}

// ── Normalisatie naar lichaamsmaat ────────────────────────────────────────────

/**
 * Kracht per kilogram lichaamsmassa.
 *
 * Gebruikt de massa van DIE SESSIE (spec §8: "use same-day body mass"), die als
 * kopie op medical.screening_sessions staat. Ontbreekt ze, dan is het antwoord
 * `no_body_mass` en niet een stille val terug op het profiel: dat zou een oude
 * meting hernormaliseren met een nieuw gewicht.
 */
export function perBodyMass(force: Measured, ctx: SessionContext): Measured {
  if (!force.ok) return force;
  if (force.unit !== "n") return unavailable("unit_mismatch");
  if (ctx.bodyMassKg === null || ctx.bodyMassKg === undefined) {
    return unavailable("no_body_mass");
  }
  if (ctx.bodyMassKg <= 0) return unavailable("zero_denominator");
  return finite(force.value / ctx.bodyMassKg, "n_per_kg");
}

/**
 * Kracht als veelvoud van het lichaamsgewicht.
 *
 * Let op het verschil met perBodyMass: hier wordt door massa x g gedeeld, dus de
 * uitkomst is dimensieloos en ongeveer een factor 9,8 kleiner. Spec §8: "Do not
 * mix with N/kg." Het zijn twee metrieken, met twee sleutels, en er is met opzet
 * geen conversie tussen n_per_kg en xbw in units.ts.
 */
export function perBodyWeight(force: Measured, ctx: SessionContext): Measured {
  if (!force.ok) return force;
  if (force.unit !== "n") return unavailable("unit_mismatch");
  if (ctx.bodyMassKg === null || ctx.bodyMassKg === undefined) {
    return unavailable("no_body_mass");
  }
  if (ctx.bodyMassKg <= 0) return unavailable("zero_denominator");
  return finite(force.value / (ctx.bodyMassKg * GRAVITY), "xbw");
}

/**
 * Afstand als percentage van de lichaamslengte.
 *
 * Spec §17 noemt dit voor de single hop: genormaliseerde hopafstand als
 * absolute-capaciteitsmaat naast LSI, omdat symmetrie een bilateraal tekort kan
 * maskeren.
 */
export function perBodyHeight(distance: Measured, ctx: SessionContext): Measured {
  return perLength(distance, ctx.bodyHeightCm ?? null);
}

/** Reikafstand als percentage van de ledemaatlengte. Y-balance, spec §8. */
export function perLimbLength(distance: Measured, ctx: SessionContext): Measured {
  return perLength(distance, ctx.limbLengthCm ?? null);
}

function perLength(distance: Measured, lengthCm: number | null): Measured {
  if (!distance.ok) return distance;
  const canonical = toCanonical(distance.value, distance.unit);
  if (canonical.unit !== "cm") return unavailable("unit_mismatch");
  if (lengthCm === null || lengthCm === undefined) return unavailable("missing_input");
  if (lengthCm <= 0) return unavailable("zero_denominator");
  return finite((canonical.value / lengthCm) * 100, "percent");
}

// ── Optellen en middelen ──────────────────────────────────────────────────────

/** a + b in dezelfde eenheid. Totale schouderrotatie: IR ROM + ER ROM. */
export function sum(inputs: readonly Measured[]): Measured {
  const ok = allOk(inputs);
  if (!ok.ok) return unavailable(ok.reason);
  if (ok.values.length === 0) return unavailable("missing_input");
  const unit = ok.values[0].unit;
  if (!ok.values.every((v) => comparable(v.unit, unit))) {
    return unavailable("unit_mismatch");
  }
  const canonical = ok.values.map((v) => toCanonical(v.value, v.unit));
  return finite(
    canonical.reduce((acc, v) => acc + v.value, 0),
    canonical[0].unit,
  );
}

/** Gemiddelde van n invoerwaarden. Y-balance-composiet. */
export function meanOf(inputs: readonly Measured[]): Measured {
  const total = sum(inputs);
  if (!total.ok) return total;
  return finite(total.value / inputs.length, total.unit);
}

// ── Verandering ───────────────────────────────────────────────────────────────

/**
 * (huidig - referentie) / referentie x100.
 *
 * Welke referentie dit is (vorige, baseline, PB, voortschrijdend gemiddelde)
 * bepaalt de aanroeper, en spec §8 eist dat het label expliciet meereist: "label
 * explicitly". Deze functie weet dat niet en hoort dat niet te weten; ze rekent.
 */
export function percentChange(current: Measured, reference: Measured): Measured {
  const ok = allOk([current, reference]);
  if (!ok.ok) {
    const reason = ok.reason === "missing_input" ? "no_baseline" : ok.reason;
    return unavailable(reason);
  }
  const [now, ref] = ok.values;
  if (!comparable(now.unit, ref.unit)) return unavailable("unit_mismatch");
  const cn = toCanonical(now.value, now.unit);
  const cr = toCanonical(ref.value, ref.unit);
  if (cr.value === 0) return unavailable("zero_denominator");
  return finite(((cn.value - cr.value) / cr.value) * 100, "percent");
}

export { measured, unavailable };
