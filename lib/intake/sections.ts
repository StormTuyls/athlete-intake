import { translator } from "@/lib/i18n/translator";
import type { Locale } from "@/lib/i18n/locale";

/**
 * De naam van een sectie, in de taal en het register van de lezer.
 *
 * Er stonden drie van deze lijsten in de codebase, en ze verschilden niet alleen
 * in taal maar in TOON:
 *
 *   sleutel           atleet              klinisch
 *   identity          Over jou            Identiteit en administratie
 *   current_status    Pijn en klachten    Huidige status en doelen
 *   uploads           Documenten          Aangeleverd materiaal
 *
 * Dat verschil is geen slordigheid en gaat er dus niet uit. "Identiteit en
 * administratie" boven een vraag aan een atleet klinkt als een loket; "Over jou"
 * op een klinisch document klinkt niet als een dossier. Vandaar twee registers
 * naast twee talen: vier varianten van zeven namen.
 *
 * Niet afgeleid uit field_definitions, en niet in een eigen tabel. Die tabel
 * bestaat voor labels die de extractieprompt en de chatvragen gebruiken; een
 * sectiekop komt in geen enkele prompt en is puur presentatie. Een
 * section_definitions-tabel voor 28 strings kost een migratie, een join bij elke
 * render en een schemawijziging tegen de bevroren taxonomie, zonder dat er één
 * SQL-consument is die het nodig heeft.
 *
 * Wat wel een risico is: een vierde lijst die uit de pas loopt met de zeven
 * secties in supabase/seed.sql. Daar staat evals/unit/section-labels.test.ts
 * voor, die de seed uitleest en de sleutels vergelijkt.
 */

export type SectionRegister = "athlete" | "clinical";

export function sectionLabel(
  key: string | null | undefined,
  locale: Locale,
  register: SectionRegister = "athlete",
): string {
  if (!key) return "";
  const t = translator(locale, `sections.${register}`);
  // Een onbekende sleutel geeft de sleutel terug in plaats van een fout: dat is
  // wat het oude gedrag deed, en op een scherm is "recovery" leesbaarder dan
  // een lege plek of een crash.
  return t.has(key as never) ? t(key as never) : key;
}
