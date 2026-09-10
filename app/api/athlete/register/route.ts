import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, toLocale } from "@/lib/i18n/locale";
import { createServerSupabase } from "@/lib/supabase/server";
import { badRequest, handleError } from "@/lib/http";
import { ensureAthleteForUser } from "@/lib/intake/athlete";
import { consentContext, recordAccountConsent } from "@/lib/intake/consent";

/**
 * Na het aanmaken van een account: profiel en atleetrij klaarzetten.
 *
 * De client doet signUp zelf, dus het wachtwoord komt hier niet langs. Wat hier
 * gebeurt kan de client juist niet: er is geen insert-policy op `profiles` en
 * `athletes_write` is alleen voor staf. Dat is opzet, want de rol wordt hier
 * vastgezet op 'athlete' in plaats van meegestuurd door de browser.
 *
 * De sessie is de enige input die telt. Wie dit endpoint aanroept zonder
 * ingelogd te zijn krijgt een 401, en wie wel ingelogd is kan alleen zijn eigen
 * profiel klaarzetten: het id komt uit het gevalideerde token, niet uit de body.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createServerSupabase();
    const { data: auth, error } = await supabase.auth.getUser();

    if (error || !auth.user) {
      return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      fullName?: string;
      locale?: string;
      consented?: boolean;
    };

    // Het vinkje is de hele grond waarop hierna iets verwerkt mag worden. Zonder
    // dat is er geen account, en de server neemt het woord van de client daarover
    // niet aan: het moet expliciet meekomen.
    if (body.consented !== true) {
      return badRequest("Consent is required to create an account.");
    }

    // Uit het cookie en niet uit de body: de bezoeker heeft de knop op dit
    // scherm staan, en wat hij daar koos is wat hij bedoelde. Een client die
    // zijn eigen taal meestuurt kan dat tegenspreken, en deed dat ook.
    const store = await cookies();
    const locale = toLocale(store.get(LOCALE_COOKIE)?.value);
    const fullName = body.fullName?.trim() || null;

    if (fullName !== null && fullName.length > 120) {
      return badRequest("That name is too long.");
    }

    const athlete = await ensureAthleteForUser({
      userId: auth.user.id,
      email: auth.user.email ?? null,
      fullName,
      locale,
    });

    // Vastleggen wat er is afgesproken, en de bewaartermijn definitief maken.
    // Dezelfde `locale` als hierboven: dat is de taal waarin het scherm de
    // consenttekst toonde, en dus de taal die in het register hoort.
    await recordAccountConsent({
      athleteId: athlete.athleteId,
      context: consentContext(request, locale),
    });

    return NextResponse.json({ athleteId: athlete.athleteId, locale: athlete.locale });
  } catch (caught) {
    return handleError(caught);
  }
}
