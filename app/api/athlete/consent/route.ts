import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, toLocale } from "@/lib/i18n/locale";
import { badRequest, handleError } from "@/lib/http";
import { currentAthlete } from "@/lib/intake/athlete";
import { consentContext, recordAccountConsent } from "@/lib/intake/consent";

/**
 * De accountconsent van een uitgenodigde atleet.
 *
 * Bij zelfaanmelding gebeurt dit in /api/athlete/register, in dezelfde aanvraag
 * als het aanmaken. Bij een uitnodiging kan dat niet: het account bestaat dan al
 * dagen, gemaakt door de praktijk, en de enige die de toestemming kan geven is
 * degene die hier nu inlogt.
 *
 * Een eigen route en niet register hergebruiken. Die maakt ook een profiel en een
 * atleetrij aan en schrijft daarbij een naam mee; hier bestaat dat allemaal al,
 * en dan is "bijna hetzelfde eindpunt" een manier om per ongeluk een naam te
 * overschrijven die de praktijk net heeft ingevuld.
 *
 * Wat hier niet staat is een controle of hij al consent gaf. Die zit in
 * recordAccountConsent: twee keer aanroepen is geen fout maar hetzelfde
 * eindresultaat, en daar hoort dit endpoint geen eigen versie van te hebben.
 */
export async function POST(request: Request) {
  try {
    const athlete = await currentAthlete();
    if (!athlete) {
      return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as { consented?: boolean };

    // Precies zoals bij aanmelden: het vinkje is de hele grond waarop hierna
    // iets verwerkt mag worden, en de server neemt het woord van de client
    // daarover niet aan.
    if (body.consented !== true) {
      return badRequest("Consent is required to continue.");
    }

    // Uit het cookie en niet uit de body: de taal waarin het scherm de
    // consenttekst toonde is de taal die in het register hoort.
    const store = await cookies();
    const locale = toLocale(store.get(LOCALE_COOKIE)?.value);

    await recordAccountConsent({
      athleteId: athlete.athleteId,
      context: consentContext(request, locale),
    });

    return NextResponse.json({ ok: true });
  } catch (caught) {
    return handleError(caught);
  }
}
