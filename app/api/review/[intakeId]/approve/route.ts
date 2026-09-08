import { NextResponse } from "next/server";
import { handleError } from "@/lib/http";
import { logAudit } from "@/lib/audit";
import { syncDossier } from "@/lib/db/dossier";
import { freezeReport } from "@/lib/report/freeze";
import { isIntakeId, requireCoach } from "@/lib/review/access";
import { appDb } from "@/lib/supabase/service";

// De goedkeuring maakt een rapportversie aan, en die doet een modelcall voor de
// samenvatting. Dat past niet in de standaardlimiet.
export const maxDuration = 300;

/**
 * De coach keurt de intake goed.
 *
 * Dit is het moment waarop het dossier van "wat het systeem eruit haalde" naar
 * "wat de behandelaar heeft nagekeken" gaat. Drie dingen gebeuren, in deze
 * volgorde, en de volgorde is inhoudelijk:
 *
 * 1. Tegenstrijdigheden moeten weg zijn. Het reviewscherm zegt dat al tegen de
 *    coach, en indienen dwingt het al af, dus goedkeuren mag niet de plek zijn
 *    waar die regel stilletjes niet geldt. Oplossen kost één correctie, dus de
 *    eis is geen last.
 * 2. `status`, `approved_at` en `approved_by` in EEN statement. De
 *    check-constraint intakes_approval_complete eist dat alle drie samen
 *    kloppen; in twee updates faalt de eerste al.
 * 3. Daarna bevriezen. `intake.status` zit in de gehashte inhoud van het
 *    snapshot (lib/report/collect.ts), dus na de statuswijziging levert
 *    freezeReport een echt nieuwe versie op. Andersom zou het een versie
 *    opleveren met dezelfde hash als de indien-versie, en dan is er geen
 *    vastlegging van waar de goedkeuring precies op rustte.
 *
 * freezeReport en niet ensureFrozenReport: dit verdient een eigen versie, ook al
 * was het dossier al eens vastgelegd.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ intakeId: string }> },
) {
  try {
    const { intakeId } = await context.params;
    const coach = await requireCoach();

    if (!isIntakeId(intakeId)) {
      return NextResponse.json({ error: "intake niet gevonden" }, { status: 404 });
    }

    const { data: intake } = await appDb()
      .from("intakes")
      .select("id, status, submitted_at, locale")
      .eq("id", intakeId)
      .maybeSingle();

    if (!intake) {
      return NextResponse.json({ error: "intake niet gevonden" }, { status: 404 });
    }

    if (intake.status === "approved") {
      return NextResponse.json(
        { error: "deze intake is al goedgekeurd" },
        { status: 409 },
      );
    }

    // De databank weigert een goedkeuring zonder submitted_at, maar dat komt
    // eruit als een pg-fout en dus als een generieke 500. Hier is de uitleg nog
    // te geven.
    if (!intake.submitted_at) {
      return NextResponse.json(
        { error: "deze intake is nog niet ingediend" },
        { status: 409 },
      );
    }

    const state = await syncDossier(intakeId, intake.locale as "nl" | "en");
    if (state.completeness.conflicts > 0) {
      return NextResponse.json(
        {
          error:
            state.completeness.conflicts === 1
              ? "er staat nog een tegenstrijdigheid open"
              : `er staan nog ${state.completeness.conflicts} tegenstrijdigheden open`,
          conflicts: state.completeness.conflicts,
        },
        { status: 409 },
      );
    }

    const approvedAt = new Date().toISOString();

    // .eq op de oude status en de rij terugvragen: zonder die twee is een
    // tweede gelijktijdige goedkeuring stil, en dan staat er een andere coach in
    // approved_by dan degene die de melding kreeg.
    const { data: updated, error: updateError } = await appDb()
      .from("intakes")
      .update({ status: "approved", approved_at: approvedAt, approved_by: coach.id })
      .eq("id", intakeId)
      .eq("status", intake.status)
      .select("id")
      .maybeSingle();

    if (updateError) {
      throw new Error(`goedkeuren mislukt: ${updateError.message}`);
    }

    if (!updated) {
      return NextResponse.json(
        { error: "de intake is inmiddels door iemand anders bijgewerkt" },
        { status: 409 },
      );
    }

    // De trigger audit_intakes logt deze update ook, maar via de service role is
    // auth.uid() null, dus die regel zegt actor_kind 'system'. Deze regel zegt
    // wie. Geen waarden in het detail.
    await logAudit({
      action: "update",
      actorKind: coach.role === "admin" ? "admin" : "coach",
      actorId: coach.id,
      entitySchema: "public",
      entityTable: "intakes",
      entityId: intakeId,
      detail: { transition: "approved" },
    });

    const report = await freezeReport(intakeId, "approval", coach.id);

    return NextResponse.json({
      approvedAt,
      approvedBy: coach.fullName ?? coach.email,
      reportVersion: report.version,
    });
  } catch (error) {
    return handleError(error);
  }
}
