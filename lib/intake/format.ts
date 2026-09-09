import { translator } from "@/lib/i18n/translator";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import { enumLabel } from "@/lib/dossier/enumLabels";
import type { FieldDefinition } from "@/lib/types";

/**
 * Hoe een opgeslagen waarde er op het scherm uitziet.
 *
 * Puur, en met opzet los van validateValue: die zet invoer om naar wat de
 * databank in gaat, dit zet dat weer om naar wat een mens leest. Eén functie
 * voor beide richtingen zou de twee verantwoordelijkheden door elkaar halen.
 *
 * Dit bestand is de enige plek die dat doet, zodat het chatscherm, het rapport,
 * de PDF en de CSV het straks niet elk anders opschrijven.
 */

/**
 * Maandnamen per taal, met de hand.
 *
 * Nog steeds geen toLocaleDateString, en de reden verandert niet doordat er een
 * tweede taal bij komt: die functie kijkt naar de omgeving, en dan verschilt een
 * rapport dat de server rendert van hetzelfde rapport in de browser. Een datum
 * in een medisch dossier moet er overal hetzelfde uitzien. Twee handgeschreven
 * lijstjes zijn de prijs daarvoor.
 */
export function monthName(index: number, locale: Locale): string {
  return months(locale)[index] ?? "";
}

function months(locale: Locale): string[] {
  return translator(locale, "format").raw("months") as string[];
}

/** ISO-datum naar "14 mrt 1992" of "14 Mar 1992". */
function formatIsoDate(value: string, locale: Locale): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  const monthName = months(locale)[Number(month) - 1];
  if (!monthName) return value;
  return `${Number(day)} ${monthName} ${year}`;
}

export function formatValue(
  definition: Pick<FieldDefinition, "key" | "dataType" | "enumOptions">,
  value: unknown,
  locale: Locale = DEFAULT_LOCALE,
): string {
  if (value === null || value === undefined) return "";

  switch (definition.dataType) {
    case "boolean":
      return translator(locale, "format")(value ? "yes" : "no");

    case "date":
      return formatIsoDate(String(value), locale);

    case "enum":
      return enumLabel(definition.key, value, locale);

    case "list":
      return (Array.isArray(value) ? value : [value]).map(String).join(", ");

    case "number":
      return String(value);

    default:
      return String(value);
  }
}

/**
 * Tijd bij een bericht: "14:32". Altijd 24-uurs, want dat is wat een
 * Nederlandstalige praktijk gebruikt, ook als de interface Engels is.
 */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/** Kalenderdag als sleutel, om te bepalen waar een datumscheiding hoort. */
export function dayKey(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/**
 * Label voor de datumscheiding: "Today · 14:32", of met de datum erbij als het
 * gesprek over meerdere dagen loopt.
 */
export function dividerLabel(iso: string, locale: Locale = DEFAULT_LOCALE): string {
  const date = new Date(iso);
  const now = new Date();
  const time = formatTime(iso);
  const t = translator(locale, "format");

  if (dayKey(iso) === dayKey(now.toISOString())) return `${t("today")} · ${time}`;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dayKey(iso) === dayKey(yesterday.toISOString())) {
    return `${t("yesterday")} · ${time}`;
  }

  return `${date.getDate()} ${months(locale)[date.getMonth()]} · ${time}`;
}
