import { NextResponse } from "next/server";
import { requireIntake } from "@/lib/intake/session";
import { handleError } from "@/lib/http";
import { syncDossier } from "@/lib/db/dossier";
import { logAudit } from "@/lib/audit";

/**
 * De huidige stand van de intake voor de atleet.
 *
 * Geeft de velden terug met hun status en betrouwbaarheid, maar zonder de
 * herkomstcitaten: die horen in het reviewscherm van de coach, niet in het
 * scherm van de atleet. Een atleet die zijn eigen dossier terugleest met
 * letterlijke fragmenten uit een medisch verslag erbij is een gesprek dat een
 * behandelaar hoort te voeren, niet een webpagina.
 */
export async function GET() {
  try {
    const session = await requireIntake();
    const state = await syncDossier(session.intakeId, session.locale);

    await logAudit({
      action: "read",
      actorKind: "athlete",
      entitySchema: "medical",
      entityTable: "dossier_fields",
      entityId: session.intakeId,
    });

    const fields = state.definitions.map((definition) => {
      const resolved = state.resolved.get(definition.key);
      return {
        key: definition.key,
        section: definition.section,
        label: session.locale === "nl" ? definition.labelNl : definition.labelEn,
        required: definition.required,
        dataType: definition.dataType,
        enumOptions: definition.enumOptions,
        value: resolved?.value ?? null,
        status: resolved?.status ?? "missing",
        confidence: resolved?.confidence ?? "low",
        conflictCount: resolved?.conflicts.length ?? 0,
      };
    });

    return NextResponse.json({
      intakeId: session.intakeId,
      status: session.status,
      locale: session.locale,
      consentGrantedAt: session.consentGrantedAt,
      completeness: state.completeness,
      gaps: state.gaps,
      fields,
    });
  } catch (error) {
    return handleError(error);
  }
}
