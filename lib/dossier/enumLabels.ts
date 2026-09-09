import { translator } from "@/lib/i18n/translator";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";

/**
 * De leesbare naam van een enum-waarde.
 *
 * De taxonomie bewaart sleutels ('specific_prep') omdat die stabiel en
 * taalonafhankelijk zijn. Een samenvatting die "seizoensfase specific prep"
 * schrijft leest als een databankdump, dus de weergave hoort hier.
 *
 * Op VELD gesleuteld en niet op waarde alleen. De oude lijst was één platte map,
 * en daarin zijn `other`, `full`, `none`, `transition` en `competition` generieke
 * woorden die over vier niet-verwante velden verdeeld staan. Zodra een vijfde
 * enum een van die woorden hergebruikt, geeft een opzoeking op waarde stil het
 * label van een ander veld. Dat is geen theoretisch risico: `competition` is nu
 * een seizoensfase, en een veld "doelwedstrijd" met dezelfde waarde is zo
 * bijgekomen.
 *
 * In code en niet in de databank: wat bevroren is, is de sleutelverzameling, en
 * die staat in field_definitions.enum_options met een constraint eromheen. Een
 * label is presentatie en heeft geen enkele SQL-consument.
 */

export function enumLabel(
  fieldKey: string,
  value: unknown,
  locale: Locale = DEFAULT_LOCALE,
): string {
  if (value === null || value === undefined) return "-";

  const raw = String(value);
  const t = translator(locale, "enums");
  const key = `${fieldKey.replace(".", ":")}:${raw}` as never;

  if (t.has(key)) return t(key);

  // Onbekend: leesbaar maken in plaats van de sleutel laten staan. Zo degradeert
  // een nieuwe waarde in de taxonomie naar "Nieuwe waarde" en niet naar
  // "nieuwe_waarde", en gaat er niets stuk voordat het label er is.
  const words = raw.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
