import { percentChange } from "./derive";
import { type Direction, isOrdered } from "./direction";
import { type Measured, measured, unavailable } from "./measured";
import type { Unit } from "./units";

/**
 * Laag 1 uit spec §5: de atleet tegen zichzelf.
 *
 * Deze laag levert een DELTA en nooit een statusband. Dat is de belangrijkste
 * keuze in dit bestand en hij is niet cosmetisch: zelfvergelijking beantwoordt
 * "is het veranderd", niet "deugt het". Zou hij de band leveren, dan is "gelijk
 * aan vorige keer" groen, ook als de absolute waarde ver onder elke norm ligt.
 * Spec §17 waarschuwt daar expliciet voor bij hop-LSI: symmetrie kan een
 * bilateraal tekort maskeren.
 *
 * De tweede regel staat in sameProtocol(): alleen metingen onder DEZELFDE
 * protocolversie worden vergeleken. Spec §4 is daar onvoorwaardelijk over, en
 * zonder die filter trekt een grafiek een lijn door een protocolwissel heen
 * alsof er niets veranderd is.
 */

/** Waartegen vergeleken wordt. Spec §8: "label explicitly". */
export type BaselineMode = "previous" | "first" | "best";

export interface HistoryPoint {
  /** ISO-tijdstip van de sessie: wanneer er GEMETEN is. */
  readonly occurredAt: string;
  /**
   * Wanneer de sessie INGEVOERD is. Alleen om gelijke stand te breken.
   *
   * Het formulier vraagt een datum en geen tijdstip, dus twee screenings op
   * dezelfde dag krijgen hetzelfde occurredAt. Zonder tweede sleutel is geen
   * van beide "voor" de andere, en dan krijgt de tweede meting van die dag geen
   * baseline terwijl de eerste er wel staat.
   *
   * Hier een verzonnen tijdstip op plakken zou het verschil ook oplossen, maar
   * dat ziet eruit als gegevens: dan staat er dat er om 14:03 gemeten is
   * terwijl niemand dat gezegd heeft. Het invoermoment is wel een feit.
   */
  readonly recordedAt: string;
  /** De protocolVERSIE, niet de test. Zie sameProtocol(). */
  readonly protocolId: string;
  readonly value: number;
}

export interface SelfComparison {
  readonly mode: BaselineMode;
  readonly reference: Measured;
  readonly change: Measured;
  /** Hoeveel eerdere metingen onder hetzelfde protocol er waren. */
  readonly n: number;
}

/**
 * Eerdere metingen onder hetzelfde protocol, oudste eerst.
 *
 * Het onderscheid tussen "geen historie" en "historie onder een ander protocol"
 * is bewust zichtbaar in compare(): dat tweede geval is geen leegte maar een
 * protocolwissel, en een scherm dat daar "nog geen baseline" zegt verbergt
 * precies wat de behandelaar moet weten.
 */
/** Meten eerst, invoeren als tweede sleutel. */
function order(a: { occurredAt: string; recordedAt: string }, b: typeof a): number {
  return a.occurredAt.localeCompare(b.occurredAt) || a.recordedAt.localeCompare(b.recordedAt);
}

function sameProtocol(
  history: readonly HistoryPoint[],
  protocolId: string,
  before: { occurredAt: string; recordedAt: string },
): HistoryPoint[] {
  return history
    .filter((p) => p.protocolId === protocolId && order(p, before) < 0)
    .sort(order);
}

function pick(
  points: readonly HistoryPoint[],
  mode: BaselineMode,
  direction: Direction,
): HistoryPoint | null {
  if (points.length === 0) return null;
  switch (mode) {
    case "previous":
      return points[points.length - 1];
    case "first":
      return points[0];
    case "best": {
      // Een persoonlijk record bestaat alleen als er een betere kant is.
      if (!isOrdered(direction)) return null;
      const higher = direction === "higher_better";
      return points.reduce((best, p) =>
        (higher ? p.value > best.value : p.value < best.value) ? p : best,
      );
    }
  }
}

export function compare(
  current: {
    readonly value: number;
    readonly protocolId: string;
    readonly occurredAt: string;
    readonly recordedAt: string;
  },
  history: readonly HistoryPoint[],
  mode: BaselineMode,
  direction: Direction,
  unit: Unit,
): SelfComparison {
  const points = sameProtocol(history, current.protocolId, current);

  if (points.length === 0) {
    // Is er wel historie, maar onder een andere protocolversie? Dan is dit geen
    // eerste meting maar een breuk, en dat verdient een eigen reden.
    const otherProtocol = history.some((p) => order(p, current) < 0);
    const reason = otherProtocol ? "protocol_mismatch" : "no_baseline";
    return { mode, reference: unavailable(reason), change: unavailable(reason), n: 0 };
  }

  const reference = pick(points, mode, direction);
  if (!reference) {
    return {
      mode,
      reference: unavailable("no_baseline"),
      change: unavailable("no_baseline"),
      n: points.length,
    };
  }

  const ref = measured(reference.value, unit);
  return {
    mode,
    reference: ref,
    change: percentChange(measured(current.value, unit), ref),
    n: points.length,
  };
}
