import { NextResponse } from "next/server";
import { handleError } from "@/lib/http";
import { getInjuries } from "@/lib/db/review";
import { syncDossier } from "@/lib/db/dossier";
import { clinicalSummary } from "@/lib/claude/summarise";
import { logAudit } from "@/lib/audit";

export const maxDuration = 120;

export async function POST(
  _request: Request,
  context: { params: Promise<{ intakeId: string }> },
) {
  try {
    const { intakeId } = await context.params;

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
      detail: { purpose: "clinical_summary", model: summary.modelId },
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
