import { NextResponse } from "next/server";
import { handleError } from "@/lib/http";
import { ensureFrozenReport, getReport } from "@/lib/report/freeze";
import { toCsv } from "@/lib/report/csv";
import { logAudit } from "@/lib/audit";
import { isIntakeId, reviewAccessAllowed } from "@/lib/review/access";

export const maxDuration = 120;

/**
 * Het rapport downloaden als JSON of CSV.
 *
 * Eén route voor beide formaten, en niet twee. De poort, het oplossen van de
 * versie en de auditregel zijn identiek, en dat is precies waar een vergeten
 * auditcall ontstaat: in de tweede route die iemand later toevoegt.
 *
 * Beide lezen een vastgelegde versie, nooit de live stand. Zonder `version`
 * wordt de nieuwste gebruikt (en aangemaakt als het dossier sinds de vorige
 * versie gewijzigd is); met `?version=1` komt exact die versie terug, ook als
 * het dossier daarna veranderd is. Dat is de hele reden dat versies bestaan.
 *
 * BEPERKING: er is nog geen coach-login. Zie lib/review/access.ts. Elke
 * auditregel zegt daarom `unauthenticated: true`; er is geen actor om te loggen
 * en het spoor hoort niet te suggereren dat er wel een was.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ intakeId: string }> },
) {
  try {
    const { intakeId } = await context.params;

    if (!reviewAccessAllowed() || !isIntakeId(intakeId)) {
      return NextResponse.json({ error: "niet gevonden" }, { status: 404 });
    }

    const url = new URL(request.url);
    const format = url.searchParams.get("format") ?? "json";
    if (format !== "json" && format !== "csv") {
      return NextResponse.json({ error: "format must be json or csv" }, { status: 400 });
    }

    const requested = url.searchParams.get("version");
    let report;

    if (requested !== null) {
      const version = Number(requested);
      if (!Number.isInteger(version) || version < 1) {
        return NextResponse.json({ error: "version must be a positive integer" }, { status: 400 });
      }
      report = await getReport(intakeId, version);
      if (!report) {
        return NextResponse.json({ error: "niet gevonden" }, { status: 404 });
      }
    } else {
      report = await ensureFrozenReport(intakeId, "export");
    }

    // Vóór het antwoord, en een mislukte auditwrite gooit door. lib/audit.ts
    // doet dat met opzet: een export van artikel 9-data die niet in het spoor
    // staat is erger dan een mislukte download.
    await logAudit({
      action: "export",
      actorKind: "coach",
      entitySchema: "medical",
      entityTable: "intake_reports",
      entityId: intakeId,
      detail: {
        format,
        version: report.version,
        contentHash: report.snapshot.contentHash.slice(0, 16),
        unauthenticated: true,
      },
    });

    // Naam met versie erin, zodat twee downloads van hetzelfde dossier niet
    // dezelfde bestandsnaam krijgen en in het downloadmapje door elkaar lopen.
    const reference = intakeId.slice(0, 8);
    const filename = `intake-report-${reference}-v${report.version}.${format}`;

    const headers: Record<string, string> = {
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Een medisch dossier hoort niet in een cache of een zoekmachine.
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    };

    if (format === "csv") {
      return new NextResponse(toCsv(report.snapshot), {
        headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" },
      });
    }

    // Het snapshot letterlijk. Dat is het punt van het ontwerp: het snapshot
    // is het exportformaat, dus er zit geen tweede weergave tussen die kan
    // afwijken van wat er vastgelegd is.
    return new NextResponse(JSON.stringify(report.snapshot, null, 2), {
      headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error) {
    return handleError(error);
  }
}
