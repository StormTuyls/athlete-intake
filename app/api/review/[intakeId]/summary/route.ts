import { NextResponse } from "next/server";
import { handleError } from "@/lib/http";
import { ensureFrozenReport } from "@/lib/report/freeze";
import { logAudit } from "@/lib/audit";
import { isIntakeId, reviewAccessAllowed } from "@/lib/review/access";

export const maxDuration = 120;

/**
 * De klinische samenvatting van dit dossier.
 *
 * Genereert niet meer bij elke klik. De samenvatting hoort bij een vastgelegde
 * rapportversie, en zolang het dossier niet veranderd is komt precies dezelfde
 * tekst terug. Twee coaches die hetzelfde dossier openen lezen dus hetzelfde,
 * en van wat er goedgekeurd is bestaat een versie om naar te wijzen.
 *
 * BEPERKING, bewust en expliciet: er is nog geen coach-login. Tot die er is
 * staat deze route dicht, tenzij REVIEW_UNAUTHENTICATED aan staat, en in
 * productie sowieso. Zie lib/review/access.ts.
 *
 * De auditregel schrijft actor_kind 'coach' zonder actor_id, en `unauthenticated`
 * staat er expliciet bij: er is nog geen identiteit om te loggen, en het spoor
 * hoort niet te suggereren dat er wel een was.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ intakeId: string }> },
) {
  try {
    const { intakeId } = await context.params;

    if (!reviewAccessAllowed() || !isIntakeId(intakeId)) {
      return NextResponse.json({ error: "niet gevonden" }, { status: 404 });
    }

    const report = await ensureFrozenReport(intakeId, "export");
    const summary = report.snapshot.summary;

    if (!summary) {
      throw new Error("rapportversie zonder samenvatting");
    }

    await logAudit({
      action: "read",
      actorKind: "coach",
      entitySchema: "medical",
      entityTable: "intake_reports",
      entityId: intakeId,
      detail: {
        purpose: "clinical_summary",
        version: report.version,
        regenerated: report.created,
        kind: summary.kind,
        model: summary.modelId,
        unauthenticated: true,
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
