import {
  getSession,
  insertScreeningReport,
  readLatestScreeningReport,
  readScreeningReport,
} from "@/lib/db/screening";
import {
  SCREENING_SNAPSHOT_VERSION,
  type FrozenScreeningSnapshot,
  type ScreeningSnapshot,
  contentHashOf,
} from "@/lib/report/screeningSnapshot";

/**
 * Screeningrapporten vastleggen en hergebruiken.
 *
 * Dezelfde regel als bij de intake: je exporteert nooit iets dat geen
 * opgeslagen versie is. Het verschil is wat er kan verschuiven. Bij een intake
 * was dat de modelsamenvatting; hier zijn het de DREMPELS. De praktijk stelt op
 * /coach/library een referentieregel bij, en vanaf dat moment zou dezelfde
 * meting een andere band krijgen. Een afdruk van vorig jaar hoort dat niet mee
 * te maken.
 *
 * Geen modelcall, anders dan bij het intakerapport. Een screening is meting en
 * classificatie, allebei deterministisch, dus bevriezen is hier puur en gratis.
 */

const frozen = Symbol.for("frozenScreening");

function markFrozen(snapshot: ScreeningSnapshot): FrozenScreeningSnapshot {
  return snapshot as FrozenScreeningSnapshot;
}

export interface FrozenScreeningReport {
  version: number;
  snapshot: FrozenScreeningSnapshot;
  created: boolean;
}

/** De huidige stand als snapshot, nog niet bevroren. */
export async function collectScreening(
  sessionId: string,
  actor: { id: string | null },
): Promise<ScreeningSnapshot | null> {
  const session = await getSession(sessionId, actor);
  if (!session) return null;

  const results = session.results.map((row) => ({
    metricKey: row.metricKey,
    testLabelNl: row.testLabelNl,
    testLabelEn: row.testLabelEn,
    block: row.block,
    side: row.side,
    kind: row.kind,
    value: row.value,
    unit: row.unit,
    decimals: row.decimals,
    status: row.status,
    unavailableReason: row.unavailableReason,
    bandStatus: row.bandStatus,
    bandScore: row.bandScore,
    // De regel reist mee, opgelost. Dit is waarom dit snapshot bestaat.
    ruleVersion: row.ruleVersion,
    ruleCitation: row.ruleSource,
    ruleNote: row.ruleNote,
    ruleEvidence: row.ruleEvidence,
    protocolConfirmed: row.protocolConfirmed,
    inputs: row.inputs ?? null,
  }));

  const body = {
    schemaVersion: SCREENING_SNAPSHOT_VERSION,
    sessionId: session.id,
    athleteId: session.athleteId,
    athleteName: session.athleteName,
    occurredOn: session.occurredOn,
    bodyMassKg: session.bodyMassKg,
    notes: session.notes,
    results,
    unclassified: results.filter(
      (r) => r.kind === "absolute" && r.status === "computed" && r.bandStatus === null,
    ).length,
  };

  return { ...body, contentHash: contentHashOf(body), generatedAt: new Date().toISOString() };
}

/**
 * Een bruikbare versie: de nieuwste als er niets veranderd is, anders een
 * nieuwe. Twee keer exporteren zonder wijziging levert dus hetzelfde bestand.
 */
export async function ensureFrozenScreening(
  sessionId: string,
  actor: { id: string | null },
  generatedBy: string | null = null,
): Promise<FrozenScreeningReport | null> {
  const current = await collectScreening(sessionId, actor);
  if (!current) return null;

  const latest = await readLatestScreeningReport(sessionId);
  if (latest) {
    const stored = latest.snapshot as ScreeningSnapshot;
    if (stored.contentHash === current.contentHash) {
      return { version: latest.version, snapshot: markFrozen(stored), created: false };
    }
  }

  const inserted = await insertScreeningReport({
    sessionId,
    athleteId: current.athleteId,
    contentHash: current.contentHash,
    snapshot: current,
    generatedBy,
  });

  if (!inserted) {
    // Iemand anders won de race op het versienummer. Zelfde inhoud is dan geen
    // fout maar precies de bedoeling.
    const again = await readLatestScreeningReport(sessionId);
    if (again) {
      const stored = again.snapshot as ScreeningSnapshot;
      if (stored.contentHash === current.contentHash) {
        return { version: again.version, snapshot: markFrozen(stored), created: false };
      }
    }
    const retry = await insertScreeningReport({
      sessionId,
      athleteId: current.athleteId,
      contentHash: current.contentHash,
      snapshot: current,
      generatedBy,
    });
    if (!retry) throw new Error("screeningrapport kon niet worden vastgelegd");
    return { version: retry.version, snapshot: markFrozen(current), created: true };
  }

  return { version: inserted.version, snapshot: markFrozen(current), created: true };
}

/** Een bepaalde versie terugzien, zodat een oud rapport reproduceerbaar is. */
export async function getScreeningReport(
  sessionId: string,
  version: number,
): Promise<FrozenScreeningReport | null> {
  const stored = await readScreeningReport(sessionId, version);
  if (!stored) return null;
  return {
    version: stored.version,
    snapshot: markFrozen(stored.snapshot as ScreeningSnapshot),
    created: false,
  };
}

export { frozen };
