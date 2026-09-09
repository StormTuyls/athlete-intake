/**
 * De taal, als waarde.
 *
 * De locale is hier geen URL-segment maar een kolom: public.intakes.locale voor
 * het gesprek en wat eruit volgt, public.athletes.locale en
 * public.profiles.locale als voorkeur van de persoon. Dat is waarom de
 * standaardopzet van next-intl (een [locale]-segment plus middleware) hier niet
 * past: er is niets om aan de URL af te lezen.
 *
 * Drie lagen, in deze volgorde:
 *
 * 1. Expliciet per ding. Het gesprek en het rapport volgen `intakes.locale`,
 *    want de assistent en de vastgelegde transcriptie moeten één taal spreken.
 * 2. Het cookie, voor het renderen. Eén leesactie, geen databank.
 * 3. De kolom bij de persoon, alleen bij inloggen gelezen om het cookie te
 *    vullen. i18n/request.ts mag geen query doen: dat draait bij elke render.
 */

export const LOCALES = ["nl", "en"] as const;

export type Locale = (typeof LOCALES)[number];

/**
 * Engels als er niets bekend is, en dat blijft zo.
 *
 * Alle teksten bestaan nu in beide talen, dus `nl` zou technisch kunnen. Het
 * blijft een productbeslissing en niet een technische: de klant kiest wat een
 * bezoeker zonder cookie ziet, en die keuze is Engels. De databank heeft wel
 * `default 'nl'` op de locale-kolommen, dus een atleet die een account maakt
 * krijgt daarna zijn eigen voorkeur; deze constante geldt alleen voor wie nog
 * niets gekozen heeft.
 */
export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_COOKIE = "locale";

/** Een jaar: een taalkeuze is geen sessiegegeven. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Wat er ook in het cookie staat, er komt een geldige taal uit. */
export function toLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}
