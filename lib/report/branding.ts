import type { Locale } from "@/lib/i18n/locale";

/**
 * De naam van de praktijk, op één plek.
 *
 * Staat in het ontwerp als "unbound". Hij staat hier los omdat hij nergens in
 * het schema voorkomt: het is geen gegeven van een intake maar van de opdracht,
 * en dus geen kolom maar een constante.
 */
export const PRACTICE_NAME = "unbound";

/**
 * De taal waarin de praktijk haar samenvattingen leest.
 *
 * Bewust NIET `intake.locale`. De atleet ziet nooit een samenvatting: die
 * bestaat voor de coach en de behandelaar. Zou de taal de intake volgen, dan
 * leest een Vlaamse praktijk de helft van haar dossiers in het Engels omdat een
 * paar atleten de intake in het Engels invulden.
 *
 * Het houdt ook het antwoord op "welke tekst heeft de coach goedgekeurd"
 * enkelvoudig. Twee samenvattingen per dossier, een per taal, zouden twee
 * klinische teksten opleveren die over hetzelfde dossier iets anders kunnen
 * zeggen, en dat is precies wat het bevriezen moet uitsluiten.
 */
export const PRACTICE_LOCALE: Locale =
  process.env.PRACTICE_LOCALE === "en" ? "en" : "nl";
