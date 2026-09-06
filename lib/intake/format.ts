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

/** enum-sleutels zijn snake_case in de taxonomie; een mens leest dat niet. */
function humaniseEnum(value: string): string {
  const words = value.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * ISO-datum naar "14 Mar 1992".
 *
 * Handmatig en niet via toLocaleDateString: die kijkt naar de locale van de
 * omgeving, en dan verschilt een rapport dat de server rendert van hetzelfde
 * rapport in de browser. Een datum in een medisch dossier moet er overal
 * hetzelfde uitzien.
 */
function formatIsoDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  const monthName = MONTHS[Number(month) - 1];
  if (!monthName) return value;
  return `${Number(day)} ${monthName} ${year}`;
}

export function formatValue(
  definition: Pick<FieldDefinition, "dataType" | "enumOptions">,
  value: unknown,
): string {
  if (value === null || value === undefined) return "";

  switch (definition.dataType) {
    case "boolean":
      return value ? "Yes" : "No";

    case "date":
      return formatIsoDate(String(value));

    case "enum":
      return humaniseEnum(String(value));

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
export function dividerLabel(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const time = formatTime(iso);

  if (dayKey(iso) === dayKey(now.toISOString())) return `Today · ${time}`;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return `Yesterday · ${time}`;

  return `${date.getDate()} ${MONTHS[date.getMonth()]} · ${time}`;
}
