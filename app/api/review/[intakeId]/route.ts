import { NextResponse } from "next/server";
import { apiMessages, requestLocale } from "@/lib/i18n/server";
import { handleError } from "@/lib/http";
import { getReviewData } from "@/lib/db/review";
import { isIntakeId, requireCoach } from "@/lib/review/access";

export const maxDuration = 60;

/**
 * Het dossier voor het reviewscherm.
 *
 * Achter een coachlogin. requireCoach() gooit als er geen geldige sessie met
 * rol coach of admin is, en de RLS-policies in de databank houden een tweede
 * slot op dezelfde vraag.
 *
 * De audit-entry heeft nu een echte actor_id, dus het spoor zegt wie het
 * dossier gelezen heeft in plaats van alleen dat het gelezen is.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ intakeId: string }> },
) {
  try {
    const t = await apiMessages();
    const { intakeId } = await context.params;

    const coach = await requireCoach();

    if (!isIntakeId(intakeId)) {
      return NextResponse.json({ error: t("intakeNotFound") }, { status: 404 });
    }

    const data = await getReviewData(intakeId, coach.id, await requestLocale());

    if (!data) {
      return NextResponse.json({ error: t("intakeNotFound") }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (error) {
    return handleError(error);
  }
}
