import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, LOCALE_COOKIE, toLocale, type Locale } from "@/lib/i18n/locale";
import nl from "@/messages/nl.json";
import en from "@/messages/en.json";

/**
 * De taal van deze aanvraag, voor next-intl.
 *
 * Geen [locale]-segment en geen middleware: de taal komt uit een cookie, en
 * waar een ding zijn eigen taal heeft (een intake, een bevroren rapport) geeft
 * de aanroeper hem expliciet mee via getTranslations({locale}). Dan levert
 * next-intl die locale hier af en gebruiken we hem in plaats van het cookie.
 *
 * Hier gebeurt met opzet GEEN databankquery. Dit draait bij elke render, en de
 * voorkeur van een persoon staat al in het cookie; die wordt bij inloggen uit
 * profiles.locale gevuld.
 */

const CATALOGS: Record<Locale, unknown> = { nl, en };

/**
 * Ontbreekt een sleutel in de doeltaal, val terug op de andere.
 *
 * Waarom: een half vertaald scherm moet gewoon uitleveren. Zonder terugval
 * rendert next-intl het sleutelpad zelf, dus dan staat er "chat.placeholder" op
 * het scherm van een atleet. Een Engelse zin tussen Nederlandse is lelijk; een
 * dotted pad is stuk. De pariteitstest in evals/unit/i18n-keys.test.ts zorgt dat
 * dit een vangnet blijft en geen werkwijze wordt.
 */
function merge(base: unknown, override: unknown): unknown {
  if (
    typeof base !== "object" ||
    base === null ||
    Array.isArray(base) ||
    typeof override !== "object" ||
    override === null ||
    Array.isArray(override)
  ) {
    return override ?? base;
  }

  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
    result[key] = key in result ? merge(result[key], value) : value;
  }
  return result;
}

export default getRequestConfig(async ({ locale: requested }) => {
  const store = await cookies();
  const locale = toLocale(requested ?? store.get(LOCALE_COOKIE)?.value);
  const other: Locale = locale === "nl" ? "en" : "nl";

  return {
    locale,
    messages: merge(CATALOGS[other], CATALOGS[locale]) as Record<string, unknown>,
    // Een kalenderdatum en een tijd horen bij de praktijk, niet bij de
    // tijdzone van de browser van de coach. Zie lib/intake/format.ts, dat om
    // dezelfde reden geen toLocaleDateString gebruikt.
    timeZone: "Europe/Brussels",
    now: new Date(),
  };
});

export { DEFAULT_LOCALE };
