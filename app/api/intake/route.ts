import { NextResponse } from "next/server";
import { apiMessages } from "@/lib/i18n/server";
import { appDb } from "@/lib/supabase/service";
import { newToken, setSessionCookie } from "@/lib/intake/session";
import { badRequest, handleError } from "@/lib/http";
import { currentAthlete } from "@/lib/intake/athlete";
import { ACCOUNT_PURPOSES, hasAccountConsent } from "@/lib/intake/consent";
import { addProposals, getFieldDefinitions } from "@/lib/db/dossier";
import { loadProfile, syncProfileToDossier } from "@/lib/intake/profile";
import { missingRequiredProfileFields } from "@/lib/intake/profileFields";

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
    const t = await apiMessages();
    const athlete = await currentAthlete();
    if (!athlete) {
      return NextResponse.json({ error: t("signIn") }, { status: 401 });
    }

    // De toestemming om gezondheidsgegevens te verwerken is gegeven bij het
    // aanmaken van het account. Bestaat die registratie niet, dan is er iets
    // misgegaan bij het aanmelden en mag hier niets beginnen: de databank
    // blokkeert indienen zonder consent, maar wachten tot dat moment betekent
    // een dossier vol medische documenten waar geen grond voor is.
    if (!(await hasAccountConsent(athlete.athleteId))) {
      return NextResponse.json(
        { error: t("consentMissing") },
        { status: 409 },
      );
    }

    // Het profiel is de bron van identiteit, dus het moet er zijn voor er een
    // intake begint.
    //
    // Naam, geboortedatum, sport: dat verandert zo goed als nooit, en het in
    // een gesprek uitvragen kost negen beurten voor gegevens die de praktijk na
    // de eerste keer al heeft. Acht invulvakjes in een formulier zijn daar het
    // juiste gereedschap voor. Wie hier strandt gaat naar /profile en komt
    // daarna terug; de client leest `missing` om te weten wat er ontbreekt.
    //
    // Welke velden verplicht zijn komt uit de taxonomie en staat niet hier:
    // beslist de praktijk morgen dat de federatie verplicht is, dan beweegt
    // deze poort mee zonder dat iemand aan deze route denkt.
    const [definitions, profile] = await Promise.all([
      getFieldDefinitions(),
      loadProfile({ athleteId: athlete.athleteId, email: athlete.email }),
    ]);

    const missing = missingRequiredProfileFields(definitions, {
      full_name: profile.values.fullName,
      date_of_birth: profile.values.dateOfBirth,
      email: profile.email,
      phone: profile.values.phone,
      sport: profile.values.sport,
      discipline: profile.values.discipline,
      club: profile.values.club,
      federation: profile.values.federation,
      coach_name: profile.values.coachName,
    });

    if (missing.length > 0) {
      return NextResponse.json(
        { error: t("profileIncomplete"), missing, profileUrl: "/profile" },
        { status: 409 },
      );
    }

    // De taal van de atleet, niet die van de client. Stond hier omgekeerd: de
    // body kreeg voorrang, en HomeScreen stuurde altijd "en" mee.
    const locale = athlete.locale;

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

      // Ook bij hervatten, want het profiel kan sinds de vorige keer gewijzigd
      // zijn en dit concept is nog niet ingediend.
      await syncProfileToDossier({ intakeId: open.id as string, athleteId: athlete.athleteId });

      await setSessionCookie(token);
      return NextResponse.json({ intakeId: open.id, locale, resumed: true });
    }

    // consent_granted_at wordt hier gezet en niet in een aparte stap: de
    // toestemming bestaat al op accountniveau, dus een intake die er zonder
    // begint zou een toestand zijn die niet voorkomt.
    const { data: intake, error: intakeError } = await db
      .from("intakes")
      .insert({
        athlete_id: athlete.athleteId,
        locale,
        access_token_hash: hash,
        consent_granted_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (intakeError || !intake) {
      throw new Error(`intake aanmaken mislukt: ${intakeError?.message}`);
    }

    // De consentvelden ook als dossiervelden, zodat het rapport en het
    // coachscherm kunnen tonen waar deze atleet mee heeft ingestemd zonder in
    // een tweede tabel te hoeven kijken.
    await addProposals(
      intake.id as string,
      ACCOUNT_PURPOSES.map((key) => ({
        fieldKey: `consent.${key}`,
        value: true,
        proposedBy: "athlete" as const,
      })),
    );

    // Identiteit komt uit het profiel en wordt niet meer gevraagd, dus ze moet
    // hier het dossier in. Gebeurt dit niet, dan is het een dossier zonder naam.
    await syncProfileToDossier({
      intakeId: intake.id as string,
      athleteId: athlete.athleteId,
    });

    await setSessionCookie(token);

    return NextResponse.json({ intakeId: intake.id, locale, resumed: false });
  } catch (error) {
    return handleError(error);
  }
}

export async function GET() {
  return badRequest((await apiMessages())("usePost"));
}
