import { NextResponse } from "next/server";
import { handleError } from "@/lib/http";
import { getInjuries } from "@/lib/db/review";
import { syncDossier } from "@/lib/db/dossier";
import { clinicalSummary } from "@/lib/claude/summarise";
import { logAudit } from "@/lib/audit";
import { isIntakeId, reviewAccessAllowed } from "@/lib/review/access";

export const maxDuration = 120;

/**
 * De klinische samenvatting laten schrijven.
 *
 * BEPERKING, bewust en expliciet: er is nog geen coach-login. Tot die er is
 * staat deze route dicht, tenzij REVIEW_UNAUTHENTICATED aan staat, en in
 * productie sowieso. Zie lib/review/access.ts.
 *
 * Deze route weegt zwaarder dan de GET ernaast: hij leest niet alleen het
 * dossier, hij stuurt het naar een model en kost geld. Onbeveiligd is dat een
 * knop waarmee een vreemde artikel 9-gegevens laat samenvatten op onze rekening.
 *
 * De auditregel schrijft actor_kind 'coach' zonder actor_id. Dat is geen
 * slordigheid maar de waarheid: er is nog geen identiteit om te loggen, en
 * `unauthenticated` staat er expliciet bij zodat een lezer van het spoor niet
 * denkt dat hier iemand bekend was.
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

    const [state, injuries] = await Promise.all([
      syncDossier(intakeId),
      getInjuries(intakeId),
    ]);

    const summary = await clinicalSummary({
      definitions: state.definitions,
      resolved: state.resolved,
      injuries,
    });

    await logAudit({
      action: "read",
      actorKind: "coach",
      entitySchema: "medical",
      entityTable: "dossier_fields",
      entityId: intakeId,
      detail: {
        purpose: "clinical_summary",
        model: summary.modelId,
        unauthenticated: true,
      },
    });

    return NextResponse.json({
      summary: summary.text,
      modelId: summary.modelId,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return handleError(error);
  }
}
