import { NextResponse } from "next/server";
import { handleError } from "@/lib/http";
import { getReviewData } from "@/lib/db/review";

export const maxDuration = 60;

/**
 * Het dossier voor het reviewscherm.
 *
 * BEPERKING, bewust en expliciet: dit endpoint heeft nog geen authenticatie.
 * De coach-login (Supabase Auth met rol via public.profiles) staat in M6. Tot
 * die er is mag dit niet naar een publieke omgeving. De audit-entry schrijft
 * actor_kind 'coach' zonder actor_id, en dat is precies wat er te zien valt:
 * er is nog geen identiteit om te loggen.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ intakeId: string }> },
) {
  try {
    const { intakeId } = await context.params;
    const data = await getReviewData(intakeId);

    if (!data) {
      return NextResponse.json({ error: "intake niet gevonden" }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (error) {
    return handleError(error);
  }
}
