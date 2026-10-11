import { createHash } from "node:crypto";

/**
 * Het bevroren screeningrapport.
 *
 * Zelfde belofte als lib/report/snapshot.ts voor de intake: wat je exporteert
 * is een opgeslagen versie, niet de stand van nu. Voor een screening weegt dat
 * zwaarder dan voor een dossier, en om een reden die uniek is voor dit domein:
 *
 *   DE DREMPELS VERANDEREN.
 *
 * De praktijk kan op /coach/library een referentieregel bijstellen of aanzetten.
 * Zou een rapport bij het printen opnieuw classificeren, dan vertelt een afdruk
 * van vorig jaar een ander verhaal dan toen hij getekend werd. Daarom draagt
 * dit snapshot niet alleen de waarde en de band, maar ook de REGEL die hem gaf,
 * met zijn versie en zijn citatie.
 *
 * En zelfdragend, net als het intakerapport: labels in beide talen, testnamen
 * opgelost, zodat een renderer nergens hoeft terug te joinen. Een rapport dat
 * een query nodig heeft om zichzelf te tonen is geen vastlegging.
 */

export const SCREENING_SNAPSHOT_VERSION = 1;

export interface SnapshotResult {
  metricKey: string;
  testLabelNl: string;
  testLabelEn: string;
  block: string;
  side: string;
  kind: "absolute" | "asymmetry" | "delta";
  value: number | null;
  unit: string;
  decimals: number;
  status: string;
  unavailableReason: string | null;
  bandStatus: string | null;
  bandScore: number | null;
  /** Welke regel deze band gaf, opgelost. Leeg als er niet ingedeeld is. */
  ruleVersion: number | null;
  ruleCitation: string | null;
  ruleNote: string | null;
  ruleEvidence: string | null;
  protocolConfirmed: boolean;
  inputs: Record<string, number | null> | null;
}

export interface ScreeningSnapshot {
  schemaVersion: number;
  contentHash: string;
  generatedAt: string;
  sessionId: string;
  athleteId: string;
  athleteName: string | null;
  occurredOn: string;
  bodyMassKg: number | null;
  notes: string | null;
  results: SnapshotResult[];
  /** Hoeveel metingen geen band kregen, en dus niet beoordeeld zijn. */
  unclassified: number;
}

const frozen = Symbol("frozenScreening");
export type FrozenScreeningSnapshot = ScreeningSnapshot & { readonly [frozen]: true };

/**
 * De hash gaat over de INHOUD, niet over het moment.
 *
 * generatedAt blijft er met opzet buiten: twee keer exporteren zonder dat er
 * iets veranderd is hoort dezelfde versie op te leveren. Verandert een meting,
 * of stelt de praktijk een drempel bij waardoor de band anders uitvalt, dan
 * verandert de hash wel en komt er een nieuwe, benoemde versie bij.
 */
export function contentHashOf(snapshot: Omit<ScreeningSnapshot, "contentHash" | "generatedAt">): string {
  const canonical = {
    schemaVersion: snapshot.schemaVersion,
    sessionId: snapshot.sessionId,
    occurredOn: snapshot.occurredOn,
    bodyMassKg: snapshot.bodyMassKg,
    notes: snapshot.notes,
    results: snapshot.results.map((r) => [
      r.metricKey, r.side, r.kind, r.value, r.unit, r.status,
      r.unavailableReason, r.bandStatus, r.bandScore, r.ruleVersion,
    ]),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
