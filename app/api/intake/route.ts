import { NextResponse } from "next/server";
import { appDb } from "@/lib/supabase/service";
import { newToken, setSessionCookie } from "@/lib/intake/session";
import { badRequest, handleError } from "@/lib/http";
import { currentAthlete } from "@/lib/intake/athlete";

/**
 * Start een intake voor de ingelogde atleet.
 *
 * Maakte eerst een lege atleet zonder eigenaar, met alleen een capability token
 * in een cookie. Dat kon maar één ding: één intake invullen op één toestel.
 * Nu hangt een intake aan het account, zodat het thuisscherm eerdere intakes
 * kan tonen en zodat een gekopieerd cookie niet volstaat om er een te openen.
 *
 * Het cookie blijft, met een andere rol: het zegt welke intake je open hebt
 * staan, niet wie je bent. Twee vragen, twee antwoorden. currentIntake()
 * controleert bovendien dat de intake bij de ingelogde gebruiker hoort.
 *
 * De korte bewaartermijn wordt bij het aanmaken van het account gezet, niet
 * hier: wie een intake start en halverwege afhaakt laat mogelijk medische
 * documenten achter waar nooit toestemming voor gegeven is, en die horen op te
 * ruimen. Pas bij het geven van consent wordt de termijn onbeperkt, met een
 * benoemde grond. De constraint athletes_indefinite_needs_basis dwingt dat af.
 */
export async function POST(request: Request) {
  try {
    const athlete = await currentAthlete();
    if (!athlete) {
      return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as { locale?: string };
    const locale = body.locale === "en" || body.locale === "nl" ? body.locale : athlete.locale;

    const db = appDb();

    // Eén intake tegelijk. Twee openstaande concepten naast elkaar levert een
    // thuisscherm op waar de atleet moet kiezen welk half ingevuld dossier hij
    // bedoelt, en dat is geen keuze die iemand kan maken.
    const { data: open } = await db
      .from("intakes")
      .select("id")
      .eq("athlete_id", athlete.athleteId)
      .eq("status", "draft")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { token, hash } = newToken();

    if (open) {
      // Bestaand concept hervatten: nieuw token, zodat dit toestel verder kan
      // zonder dat een ouder cookie elders geldig blijft.
      const { error } = await db
        .from("intakes")
        .update({ access_token_hash: hash })
        .eq("id", open.id);
      if (error) throw new Error(`intake hervatten mislukt: ${error.message}`);

      await setSessionCookie(token);
      return NextResponse.json({ intakeId: open.id, locale, resumed: true });
    }

    const { data: intake, error: intakeError } = await db
      .from("intakes")
      .insert({ athlete_id: athlete.athleteId, locale, access_token_hash: hash })
      .select("id")
      .single();

    if (intakeError || !intake) {
      throw new Error(`intake aanmaken mislukt: ${intakeError?.message}`);
    }

    await setSessionCookie(token);

    return NextResponse.json({ intakeId: intake.id, locale, resumed: false });
  } catch (error) {
    return handleError(error);
  }
}

export async function GET() {
  return badRequest("Use POST to start an intake.");
}
