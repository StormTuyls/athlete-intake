import { type Direction, isOrdered } from "./direction";
import { type Measured, measured, unavailable } from "./measured";
import type { Unit } from "./units";

/**
 * Welke proef de representatieve waarde wordt. FR-04.
 *
 * Spiegelt public.trial_selection. De regel hoort bij het PROTOCOL en niet bij
 * de invoerder: "beste van drie" is een eigenschap van de test, en wie het per
 * sessie mag kiezen maakt twee sessies onvergelijkbaar zonder dat iemand het
 * ziet.
 *
 * De val in dit bestand is `best`. Bij een sprong is de beste de hoogste, bij
 * een 5-10-5 de snelste. Daarom neemt pickBest() de richting van de metriek mee
 * en is er geen variant die zonder richting werkt: dat zou bij elke tijdmetriek
 * stil de slechtste proef kiezen. Spec §8 waarschuwt voor exact deze fout bij
 * LSI; hij zit hier net zo goed.
 */

export type TrialSelection = "single" | "best" | "mean" | "median" | "last";

export interface Trial {
  readonly trialNumber: number;
  readonly value: number;
  readonly valid: boolean;
}

/**
 * Alleen geldige proeven tellen mee. Een uitgesloten poging ("atleet gleed
 * weg") hoort in de historie te blijven staan maar nooit in het gemiddelde.
 */
export function validTrials(trials: readonly Trial[]): Trial[] {
  return trials.filter((t) => t.valid && Number.isFinite(t.value));
}

export function select(
  trials: readonly Trial[],
  rule: TrialSelection,
  direction: Direction,
  unit: Unit,
): { result: Measured; selected: Trial | null } {
  const usable = validTrials(trials);
  if (usable.length === 0) {
    return { result: unavailable("missing_input"), selected: null };
  }

  switch (rule) {
    case "single":
    case "last": {
      // Bij `single` is er er hoort maar één te zijn; is er toch meer ingevoerd,
      // dan is de laatste de bedoelde. Dezelfde regel als `last`, dus geen apart
      // pad dat stil iets anders doet.
      const picked = [...usable].sort((a, b) => a.trialNumber - b.trialNumber).at(-1)!;
      return { result: measured(picked.value, unit), selected: picked };
    }
    case "best": {
      const picked = pickBest(usable, direction);
      if (!picked) return { result: unavailable("missing_input"), selected: null };
      return { result: measured(picked.value, unit), selected: picked };
    }
    case "mean": {
      const sum = usable.reduce((acc, t) => acc + t.value, 0);
      // Geen `selected`: een gemiddelde is geen proef. Een trial-id erbij zetten
      // zou suggereren dat deze waarde ergens letterlijk gemeten is.
      return { result: measured(sum / usable.length, unit), selected: null };
    }
    case "median": {
      const sorted = [...usable].map((t) => t.value).sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const value =
        sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      return { result: measured(value, unit), selected: null };
    }
  }
}

/**
 * De beste proef, volgens de richting van de metriek.
 *
 * `target_range` en `neutral` hebben geen beste: er is geen kant op waarvan meer
 * beter is. Dan is "beste van drie" een betekenisloze regel en komt er null uit,
 * zodat de seedvalidatie erover klaagt in plaats van dat er stil de hoogste
 * uitrolt.
 */
export function pickBest(trials: readonly Trial[], direction: Direction): Trial | null {
  if (!isOrdered(direction)) return null;
  const higher = direction === "higher_better";
  return trials.reduce((best, t) => {
    if (!best) return t;
    if (higher) return t.value > best.value ? t : best;
    return t.value < best.value ? t : best;
  }, null as Trial | null);
}
