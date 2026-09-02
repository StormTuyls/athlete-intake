import { NextResponse } from "next/server";
import { appDb } from "@/lib/supabase/service";
import { newToken, setSessionCookie } from "@/lib/intake/session";
import { badRequest, handleError } from "@/lib/http";

/**
 * Start een intake.
 *
 * Maakt een lege atleet en een intake, en zet het capability token in een
 * httpOnly cookie. De atleet heeft nog niets ingevuld, ook geen naam: die komt
 * uit de consent-stap of uit de documenten. Een intake zonder consent kan niets
 * anders dan bestaan; de databank blokkeert indienen.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { locale?: string };
    const locale = body.locale === "en" ? "en" : "nl";

    const db = appDb();

    const { data: athlete, error: athleteError } = await db
      .from("athletes")
      .insert({ locale })
      .select("id")
      .single();

    if (athleteError || !athlete) {
      throw new Error(`atleet aanmaken mislukt: ${athleteError?.message}`);
    }

    const { token, hash } = newToken();

    const { data: intake, error: intakeError } = await db
      .from("intakes")
      .insert({ athlete_id: athlete.id, locale, access_token_hash: hash })
      .select("id")
      .single();

    if (intakeError || !intake) {
      throw new Error(`intake aanmaken mislukt: ${intakeError?.message}`);
    }

    await setSessionCookie(token);

    return NextResponse.json({ intakeId: intake.id, locale });
  } catch (error) {
    return handleError(error);
  }
}

export async function GET() {
  return badRequest("gebruik POST om een intake te starten");
}
