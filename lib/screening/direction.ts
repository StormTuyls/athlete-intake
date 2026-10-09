/**
 * De richting waarin een metriek beter wordt.
 *
 * Spiegelt public.metric_direction. Dit is de kolom waar spec §8 om draait:
 *
 *   "LSI - lower time is better: uninvolved time / involved time x100 (rehab)
 *    [...] Avoid using the higher-is-better formula on time."
 *
 * De faalwijze is stil. Een verkeerd gerichte LSI op een timed hop levert geen
 * foutmelding, alleen een getal dat de verkeerde kant op wijst: 93% waar 107%
 * hoorde te staan, en beide zien er plausibel uit.
 *
 * Daarom komt de richting ALTIJD uit metric_definitions.direction en nooit van
 * de aanroepplek. Er is in dit bestand geen functie die hem als optionele
 * parameter neemt.
 */

export type Direction = "higher_better" | "lower_better" | "target_range" | "neutral";

/** Of een richting een ordening op de getallenlijn geeft. */
export function isOrdered(direction: Direction): boolean {
  return direction === "higher_better" || direction === "lower_better";
}
