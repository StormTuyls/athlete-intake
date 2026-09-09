import { cookies } from "next/headers";
import { translator } from "@/lib/i18n/translator";
import { LOCALE_COOKIE, toLocale, type Locale } from "@/lib/i18n/locale";

/**
 * De taal van deze aanvraag, voor route handlers.
 *
 * Uit het cookie en niet uit `intakes.locale`, en dat is een keuze: een melding
 * hoort in de taal van het SCHERM te staan. De taal van een ingediende intake
 * staat vast, terwijl de bezoeker daarna op de taalknop kan hebben gedrukt; een
 * Nederlandse foutmelding in een Engelse interface leest als een defect.
 *
 * De inhoud volgt wel de intake: labels, vragen en het rapport komen uit
 * `intakes.locale`. Meldingen zijn geen inhoud.
 *
 * Expliciet en niet via getTranslations() uit next-intl/server. Dat zou ook
 * moeten werken in een route handler, maar ik kreeg het in de devserver niet
 * bewezen (een vers toegevoegde route bleef 404 geven), en een aanname over
 * waar een ambiente context wel en niet bestaat is precies het soort ding dat
 * pas in productie stukloopt. Deze weg werkt in een handler, in een server
 * component en in een tsx-script, alle drie op dezelfde manier.
 */

export async function requestLocale(): Promise<Locale> {
  const store = await cookies();
  return toLocale(store.get(LOCALE_COOKIE)?.value);
}

/** De meldingen die naar buiten gaan, in de taal van het scherm. */
export async function apiMessages() {
  return translator(await requestLocale(), "api");
}
