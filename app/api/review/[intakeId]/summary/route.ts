import { NextResponse } from "next/server";
import { apiMessages } from "@/lib/i18n/server";
import { handleError } from "@/lib/http";
import { ensureFrozenReport } from "@/lib/report/freeze";
import { logAudit } from "@/lib/audit";
import { isIntakeId, requireCoach } from "@/lib/review/access";

export const maxDuration = 120;

/**
 * De klinische samenvatting van dit dossier.
 *
 * Genereert niet meer bij elke klik. De samenvatting hoort bij een vastgelegde
 * rapportversie, en zolang het dossier niet veranderd is komt precies dezelfde
 * tekst terug. Twee coaches die hetzelfde dossier openen lezen dus hetzelfde,
 * en van wat er goedgekeurd is bestaat een versie om naar te wijzen.
 *
 * Achter een coachlogin, en de auditregel draagt nu wie het was.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ intakeId: string }> },
) {
  try {
    const t = await apiMessages();
    const { intakeId } = await context.params;

    const coach = await requireCoach();

    if (!isIntakeId(intakeId)) {
      return NextResponse.json({ error: t("notFound") }, { status: 404 });
    }

    const report = await ensureFrozenReport(intakeId, "export");
    const summary = report.snapshot.summary;

    if (!summary) {
      throw new Error("rapportversie zonder samenvatting");
    }

    await logAudit({
      action: "read",
      actorKind: "coach",
      actorId: coach.id,
      entitySchema: "medical",
      entityTable: "intake_reports",
      entityId: intakeId,
      detail: {
        purpose: "clinical_summary",
        version: report.version,
        regenerated: report.created,
        kind: summary.kind,
        model: summary.modelId,
      },
    });

    return NextResponse.json({
      summary: summary.text,
      modelId: summary.modelId,
      kind: summary.kind,
      version: report.version,
      generatedAt: summary.generatedAt,
    });
  } catch (error) {
    return handleError(error);
  }
}
