import { NextResponse } from "next/server";
import { handleError } from "@/lib/http";
import { getReviewData } from "@/lib/db/review";
import { isIntakeId, reviewAccessAllowed } from "@/lib/review/access";

export const maxDuration = 60;

/**
 * Het dossier voor het reviewscherm.
 *
 * BEPERKING, bewust en expliciet: dit endpoint heeft nog geen authenticatie.
 * De coach-login (Supabase Auth met rol via public.profiles) staat in M6. Tot
 * die er is staat de route dicht tenzij REVIEW_UNAUTHENTICATED expliciet aan
 * staat, en in productie weigert hij altijd. Zie lib/review/access.ts.
 *
 * Hier stond eerder alleen deze waarschuwing in een comment. Dat las als een
 * afspraak, maar het was er geen: het endpoint gaf het volledige dossier met
 * bronciteten aan iedereen die een intake-id kende, en lib/notion/sync.ts zet
 * die id in de Notion-rij van de atleet.
 *
 * De audit-entry schrijft actor_kind 'coach' zonder actor_id, en dat is precies
 * wat er te zien valt: er is nog geen identiteit om te loggen.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ intakeId: string }> },
) {
  try {
    const { intakeId } = await context.params;

    // 404 en geen 403: een 403 bevestigt dat de intake bestaat.
    if (!reviewAccessAllowed() || !isIntakeId(intakeId)) {
      return NextResponse.json({ error: "intake niet gevonden" }, { status: 404 });
    }

    const data = await getReviewData(intakeId);

    if (!data) {
      return NextResponse.json({ error: "intake niet gevonden" }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (error) {
    return handleError(error);
  }
}
