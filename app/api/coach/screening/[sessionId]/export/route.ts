import { NextResponse } from "next/server";
import { handleError } from "@/lib/http";
import { logAudit } from "@/lib/audit";
import { isUuid, requireCoach } from "@/lib/review/access";
import { ensureFrozenScreening } from "@/lib/report/screeningFreeze";
import type { SnapshotResult } from "@/lib/report/screeningSnapshot";

export const maxDuration = 60;

/**
 * Een screening exporteren als JSON of CSV.
 *
 * Altijd uit een bevroren versie, nooit uit de huidige stand. Twee keer
 * exporteren zonder dat er iets veranderd is levert daardoor hetzelfde bestand
 * en hetzelfde versienummer.
 *
 * De kolommen dragen de REGEL mee, niet alleen de band. Een bestand met
 * "poor" erin en geen drempel erbij is in een medisch dossier niet veel waard,
 * en wie het later naleest moet kunnen zien waartegen beoordeeld is.
 */

const COLUMNS = [
  "test", "metric_key", "side", "kind", "value", "unit",
  "status", "unavailable_reason", "band", "band_score",
  "rule_version", "rule_evidence", "rule_citation", "protocol_confirmed",
] as const;

/**
 * Formule-injectie afdekken, net als lib/report/csv.ts.
 *
 * Een cel die met = + - of @ begint wordt door Excel als formule uitgevoerd.
 * Bij een testnaam is dat onwaarschijnlijk, bij een vrij ingevoerde toelichting
 * niet.
 */
function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  const risky = /^[=+\-@\t\r]/.test(text);
  const escaped = text.replace(/"/g, '""');
  return `"${risky ? `'${escaped}` : escaped}"`;
}

function toCsv(results: SnapshotResult[], locale: string): string {
  const rows = results.map((r) =>
    [
      locale === "nl" ? r.testLabelNl : r.testLabelEn,
      r.metricKey, r.side, r.kind, r.value, r.unit,
      r.status, r.unavailableReason, r.bandStatus, r.bandScore,
      r.ruleVersion, r.ruleEvidence, r.ruleCitation, r.protocolConfirmed,
    ].map(cell).join(","),
  );
  // BOM, anders leest Excel de accenten verkeerd.
  return `﻿${COLUMNS.join(",")}\n${rows.join("\n")}\n`;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await context.params;
    if (!isUuid(sessionId)) return NextResponse.json({ error: "not found" }, { status: 404 });

    const coach = await requireCoach();
    const url = new URL(request.url);
    const format = url.searchParams.get("format") === "csv" ? "csv" : "json";

    const report = await ensureFrozenScreening(sessionId, { id: coach.id }, coach.id);
    if (!report) return NextResponse.json({ error: "not found" }, { status: 404 });

    await logAudit({
      actorId: coach.id,
      actorKind: coach.role === "admin" ? "admin" : "coach",
      action: "export",
      entitySchema: "medical",
      entityTable: "screening_reports",
      entityId: sessionId,
      detail: { version: report.version, format },
    });

    const base = `screening-${report.snapshot.occurredOn}-v${report.version}`;

    if (format === "csv") {
      return new NextResponse(toCsv(report.snapshot.results, "nl"), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${base}.csv"`,
        },
      });
    }

    return new NextResponse(JSON.stringify(report.snapshot, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${base}.json"`,
      },
    });
  } catch (caught) {
    return handleError(caught);
  }
}
