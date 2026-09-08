import {
  insertReport,
  readLatestReport,
  readReport,
  type StoredReport,
} from "@/lib/db/medical";
import { collectReportData } from "@/lib/report/collect";
import { clinicalSummary, commercialSummary } from "@/lib/claude/summarise";
import { syncDossier } from "@/lib/db/dossier";
import { getInjuries } from "@/lib/db/review";
import type {
  FreezeReason,
  FrozenReportSnapshot,
  ReportSnapshot,
  SnapshotSummary,
} from "@/lib/report/snapshot";

/**
 * Rapportversies vastleggen en hergebruiken.
 *
 * De regel is: je exporteert nooit iets dat geen opgeslagen versie is. Dat lost
 * het probleem op waar dit werk voor bestaat, namelijk dat de klinische
 * samenvatting bij elke sync en elke klik opnieuw gegenereerd werd. Twee coaches
 * konden een andere tekst over hetzelfde dossier lezen, en van wat er naar
 * Notion ging bestond geen vastlegging.
 *
 * Hergebruik loopt via de content-hash, niet via een tijdvenster: zolang het
 * dossier niet veranderd is, blijft dezelfde versie gelden en dus dezelfde
 * samenvattingstekst. Verandert er iets, dan komt er een nieuwe, benoemde versie
 * bij. Oude versies blijven staan, want de vraag "welke tekst keurde de coach
 * goed" moet later te beantwoorden zijn.
 */

/** Alleen deze module mag iets als bevroren bestempelen, en pas na het opslaan. */
function markFrozen(snapshot: ReportSnapshot): FrozenReportSnapshot {
  return snapshot as FrozenReportSnapshot;
}

function asSnapshot(stored: StoredReport): FrozenReportSnapshot {
  return markFrozen(stored.snapshot as ReportSnapshot);
}

export interface FrozenReport {
  version: number;
  snapshot: FrozenReportSnapshot;
  /** Waar als deze aanroep de versie heeft aangemaakt. */
  created: boolean;
}

/**
 * De samenvatting die bij deze stand van het dossier hoort.
 *
 * Klinisch alleen met toestemming, anders zakelijk. Dezelfde poort als
 * lib/notion/sync.ts, en die staat in het snapshot, zodat later na te gaan is
 * op welke grond een klinische tekst gemaakt is.
 */
async function buildSummary(
  intakeId: string,
  snapshot: ReportSnapshot,
): Promise<SnapshotSummary> {
  if (snapshot.consent.sharingAllowed) {
    const [state, injuries] = await Promise.all([
      syncDossier(intakeId, snapshot.intake.locale),
      getInjuries(intakeId),
    ]);
    const result = await clinicalSummary({
      definitions: state.definitions,
      resolved: state.resolved,
      injuries,
    });
    return {
      kind: "clinical",
      text: result.text,
      modelId: result.modelId,
      generatedAt: new Date().toISOString(),
    };
  }

  const values = new Map<string, unknown>();
  for (const field of snapshot.fields) {
    if (!field.isMedical) values.set(field.key, field.value);
  }

  const result = await commercialSummary({
    values,
    documentCount: snapshot.documents.length,
    openFields: snapshot.completeness.total - snapshot.completeness.filled,
    conflicts: snapshot.completeness.conflicts,
  });

  return {
    kind: "commercial",
    text: result.text,
    modelId: result.modelId,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Legt de huidige stand vast als nieuwe versie, met samenvatting.
 *
 * Onvoorwaardelijk: dit is het moment waarop iets gebeurde dat een eigen versie
 * verdient, zoals indienen. Gebruik ensureFrozenReport als je alleen een
 * bruikbare versie nodig hebt.
 */
export async function freezeReport(
  intakeId: string,
  reason: FreezeReason,
  /** De coach bij een goedkeuring. Leeg als het systeem vastlegt. */
  generatedBy?: string | null,
): Promise<FrozenReport> {
  const snapshot = await collectReportData(intakeId, reason);
  snapshot.summary = await buildSummary(intakeId, snapshot);
  return store(intakeId, snapshot, generatedBy);
}

/**
 * Wegschrijven, en omgaan met een gelijktijdige tweede schrijver.
 *
 * Hier wordt met opzet niets naar lib/audit.ts geschreven. De trigger
 * audit_intake_reports logt de insert al (zie 20260902090400_audit.sql), en dat
 * bestand bestaat juist voor wat triggers NIET kunnen zien: leesacties en
 * exports. Er een tweede regel bij schrijven maakt het spoor dubbel in plaats
 * van vollediger. Waar de data het systeem echt verlaat, in de Notion-sync,
 * staat de export-regel al.
 */
async function store(
  intakeId: string,
  snapshot: ReportSnapshot,
  generatedBy?: string | null,
): Promise<FrozenReport> {
  const inserted = await insertReport({ intakeId, snapshot, generatedBy });

  if (!inserted) {
    // Iemand anders won de race op het versienummer. Als zijn versie dezelfde
    // inhoud heeft, is dat geen fout maar precies het gewenste resultaat.
    const latest = await readLatestReport(intakeId);
    if (latest) {
      const stored = latest.snapshot as ReportSnapshot;
      if (stored.contentHash === snapshot.contentHash) {
        return { version: latest.version, snapshot: asSnapshot(latest), created: false };
      }
    }
    // Andere inhoud: één keer opnieuw, want het nummer is nu wel vrij.
    const retry = await insertReport({ intakeId, snapshot, generatedBy });
    if (!retry) throw new Error("rapportversie kon niet worden vastgelegd");
    return { version: retry.version, snapshot: markFrozen(snapshot), created: true };
  }

  return { version: inserted.version, snapshot: markFrozen(snapshot), created: true };
}

/**
 * Geeft een bruikbare versie: de nieuwste als het dossier niet veranderd is,
 * anders een nieuwe.
 *
 * Dit is wat exports en de Notion-sync horen te gebruiken. Twee keer exporteren
 * zonder wijziging levert dus dezelfde versie en dezelfde tekst, en dat is de
 * hele belofte.
 */
export async function ensureFrozenReport(
  intakeId: string,
  reason: FreezeReason = "export",
): Promise<FrozenReport> {
  const latest = await readLatestReport(intakeId);
  const current = await collectReportData(intakeId, reason);

  if (latest) {
    const stored = latest.snapshot as ReportSnapshot;
    // Zelfde dossier en er staat al een samenvatting in: niets te doen. Geen
    // modelcall, geen nieuwe versie, byte-identieke uitvoer.
    if (stored.contentHash === current.contentHash && stored.summary) {
      return { version: latest.version, snapshot: asSnapshot(latest), created: false };
    }
  }

  current.summary = await buildSummary(intakeId, current);
  return store(intakeId, current);
}

/** Een specifieke versie teruglezen, zodat een oud rapport reproduceerbaar is. */
export async function getReport(
  intakeId: string,
  version: number,
): Promise<FrozenReport | null> {
  const stored = await readReport(intakeId, version);
  if (!stored) return null;
  return { version: stored.version, snapshot: asSnapshot(stored), created: false };
}

export async function latestReport(intakeId: string): Promise<FrozenReport | null> {
  const stored = await readLatestReport(intakeId);
  if (!stored) return null;
  return { version: stored.version, snapshot: asSnapshot(stored), created: false };
}
