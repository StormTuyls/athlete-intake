import { NextResponse } from "next/server";
import { apiMessages } from "@/lib/i18n/server";
import { appDb } from "@/lib/supabase/service";
import { requireIntake } from "@/lib/intake/session";
import { badRequest, handleError } from "@/lib/http";
import { syncDossier } from "@/lib/db/dossier";
import { syncIntakeToNotion } from "@/lib/notion/sync";
import { freezeReport } from "@/lib/report/freeze";
import { addProposals } from "@/lib/db/dossier";
import { consentContext, recordSharingChoice } from "@/lib/intake/consent";

/**
 * Intake indienen.
 *
 * Indienen mag met open optionele velden, niet met open verplichte velden of
 * openstaande conflicten. Een conflict doorlaten zou betekenen dat de coach een
 * dossier krijgt waarin twee bronnen elkaar tegenspreken zonder dat iemand het
 * gezien heeft.
 *
 * De databank houdt hier een tweede slot op: intakes_submit_requires_consent.
 */
export async function POST(request: Request) {
  try {
    const t = await apiMessages();
    const session = await requireIntake();

    if (session.status !== "draft") {
      return badRequest(t("alreadySubmitted"));
    }

    const body = (await request.json().catch(() => ({}))) as { share?: boolean };

    // De keuze om een samenvatting met een behandelaar te delen hoort hier en
    // niet bij het starten: dit is het moment waarop het dossier naar de coach
    // gaat. Een expliciete boolean, geen ontbrekende waarde die als ja telt.
    if (typeof body.share !== "boolean") {
      return badRequest(t("chooseSharing"));
    }

    const state = await syncDossier(session.intakeId, session.locale);

    if (!state.completeness.readyToSubmit) {
      return NextResponse.json(
        {
          error: t("notComplete"),
          completeness: state.completeness,
          gaps: state.gaps.filter((gap) => gap.required || gap.reason === "conflicting"),
        },
        { status: 409 },
      );
    }

    const { error } = await appDb()
      .from("intakes")
      .update({ status: "submitted", submitted_at: new Date().toISOString() })
      .eq("id", session.intakeId)
      .eq("status", "draft");

    if (error) throw new Error(`indienen mislukt: ${error.message}`);

    // Eerst vastleggen, dan pas het rapport bevriezen: de deelkeuze bepaalt of
    // de samenvatting klinisch of zakelijk mag zijn, en die staat in het
    // snapshot. Andersom zou versie 1 de verkeerde soort tekst dragen.
    await recordSharingChoice({
      athleteId: session.athleteId,
      intakeId: session.intakeId,
      share: body.share,
      context: consentContext(request),
    });

    await addProposals(session.intakeId, [
      {
        fieldKey: "consent.share_with_practitioners",
        value: body.share,
        proposedBy: "athlete",
      },
    ]);

    // Vastleggen wat de atleet heeft ingeleverd, voordat er iets naar buiten
    // gaat. Dit is versie 1: de stand van het dossier op het moment van
    // indienen, met de samenvatting erbij. Alles wat daarna exporteert leest
    // deze versie in plaats van opnieuw te genereren.
    //
    // Mislukt het, dan is de intake nog steeds ingediend. Hetzelfde argument als
    // bij Notion hieronder: een atleet buitensluiten omdat een samenvatting niet
    // gelukt is, is de verkeerde afweging. De volgende export legt hem alsnog
    // vast.
    let report: { version: number } | { error: string } | null = null;
    try {
      const frozen = await freezeReport(session.intakeId, "submit");
      report = { version: frozen.version };
    } catch (reportError) {
      console.error("[report]", reportError);
      report = {
        error: reportError instanceof Error ? reportError.message : "onbekende fout",
      };
    }

    // Notion is een weergave, geen bron van waarheid. Ligt het plat of is de
    // koppeling niet geconfigureerd, dan is de intake alsnog ingediend. Anders
    // zou een storing bij een derde partij een atleet buitensluiten.
    let notion: { pageId: string; created: boolean } | { error: string } | null = null;
    if (process.env.NOTION_API_KEY && process.env.NOTION_ATHLETES_DB) {
      try {
        notion = await syncIntakeToNotion(session.intakeId);
      } catch (notionError) {
        console.error("[notion]", notionError);
        notion = {
          error:
            notionError instanceof Error ? notionError.message : "onbekende fout",
        };
      }
    }

    return NextResponse.json({
      status: "submitted",
      completeness: state.completeness,
      report,
      notion,
    });
  } catch (error) {
    return handleError(error);
  }
}
