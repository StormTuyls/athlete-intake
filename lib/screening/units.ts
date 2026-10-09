/**
 * Eenheden, als gesloten type.
 *
 * Dit spiegelt public.metric_unit uit
 * supabase/migrations/20261009090000_screening_types.sql, en dat is geen
 * toevalligheid: spec §10 noemt het door elkaar gebruiken van N/kg, xBW en
 * "system weight" een HIGH-gap. Met vrije tekst zijn 'N/kg', 'N kg-1' en 'Nkg'
 * drie eenheden die de motor voor dezelfde aanziet, of erger, voor
 * verschillende.
 *
 * De belangrijkste regel in dit bestand staat in `convert`: n_per_kg en xbw
 * converteren NIET naar elkaar. Ze schelen een factor g, ze zijn in de
 * bronbestanden door elkaar gehaald, en ze zijn per spec §8 twee metrieken en
 * niet twee namen voor hetzelfde. De enige weg naar xbw is `per_body_weight`
 * over de ruwe newton.
 */

export const UNITS = [
  "n",
  "n_per_kg",
  "xbw",
  "nm",
  "nm_per_kg",
  "deg",
  "cm",
  "mm",
  "m",
  "s",
  "ms",
  "m_per_s",
  "w",
  "n_per_s",
  "kg",
  "reps",
  "count",
  "ratio",
  "percent",
  "score",
  "hand_lengths",
] as const;

export type Unit = (typeof UNITS)[number];

/**
 * Standaardzwaartekracht, CODATA. Hardgecodeerd en niet afgerond naar 9,81:
 * spec §8 schrijft de waarde voluit (`mass × 9.80665`), en een afwijkende
 * constante levert een stille afwijking van 0,07% op elke xBW-waarde.
 */
export const GRAVITY = 9.80665;

/**
 * Welke eenheden dezelfde grootheid meten en dus onderling om te rekenen zijn.
 *
 * Bewust klein gehouden. Alleen schaalverschillen binnen dezelfde grootheid
 * staan hier; alles wat een lichaamsmaat nodig heeft (n -> n_per_kg, n -> xbw)
 * is een FORMULE en geen conversie, want die heeft de massa van die sessie nodig
 * en kan dus mislukken. Zie lib/screening/derive.ts.
 */
const SCALE: Partial<Record<Unit, { to: Unit; factor: number }>> = {
  mm: { to: "cm", factor: 0.1 },
  ms: { to: "s", factor: 0.001 },
};

/** Naar welke eenheid een waarde genormaliseerd wordt om te vergelijken. */
export function canonicalUnit(unit: Unit): Unit {
  return SCALE[unit]?.to ?? unit;
}

/**
 * Twee waarden zijn vergelijkbaar als ze na normalisatie dezelfde eenheid
 * hebben. n_per_kg en xbw zijn dat met opzet NIET.
 */
export function comparable(a: Unit, b: Unit): boolean {
  return canonicalUnit(a) === canonicalUnit(b);
}

/**
 * Schaalt een waarde naar de canonieke eenheid van zijn grootheid.
 * Een eenheid zonder schaalregel is al canoniek en komt ongewijzigd terug.
 */
export function toCanonical(value: number, unit: Unit): { value: number; unit: Unit } {
  const scale = SCALE[unit];
  if (!scale) return { value, unit };
  return { value: value * scale.factor, unit: scale.to };
}
