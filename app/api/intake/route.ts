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
 *
 * De bewaartermijn staat hier bewust op een korte einddatum. Wie de intake
 * start en halverwege afhaakt, laat mogelijk medische documenten achter waar
 * nooit toestemming voor gegeven is. Die horen op te ruimen, niet te blijven
 * liggen. Pas bij het geven van consent wordt de termijn onbeperkt, met een
 * benoemde grond. De constraint athletes_indefinite_needs_basis dwingt dat af
 * en ving deze fout tijdens de eerste UI-test.
 */
const DRAFT_RETENTION_DAYS = 30;
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { locale?: string };
    const locale = body.locale === "en" ? "en" : "nl";

    const db = appDb();

    const draftUntil = new Date();
    draftUntil.setDate(draftUntil.getDate() + DRAFT_RETENTION_DAYS);

    const { data: athlete, error: athleteError } = await db
      .from("athletes")
      .insert({
        locale,
        retention_mode: "until_date",
        retention_until: draftUntil.toISOString().slice(0, 10),
      })
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
