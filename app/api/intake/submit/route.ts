import { NextResponse } from "next/server";
import { appDb } from "@/lib/supabase/service";
import { requireIntake } from "@/lib/intake/session";
import { badRequest, handleError } from "@/lib/http";
import { syncDossier } from "@/lib/db/dossier";
import { syncIntakeToNotion } from "@/lib/notion/sync";

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
export async function POST() {
  try {
    const session = await requireIntake();

    if (session.status !== "draft") {
      return badRequest("deze intake is al ingediend");
    }

    const state = await syncDossier(session.intakeId, session.locale);

    if (!state.completeness.readyToSubmit) {
      return NextResponse.json(
        {
          error: "intake is nog niet volledig",
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
      notion,
    });
  } catch (error) {
    return handleError(error);
  }
}
