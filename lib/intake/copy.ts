/**
 * Wat er nog over is van het losse tekstbestand: de sectienamen.
 *
 * De rest is verhuisd naar messages/{nl,en}.json, en de reden dat next-intl
 * eerder werd afgewezen (URL-gedreven, met een [locale]-segment) gold alleen
 * voor de standaardopzet. De plugin legt enkel de alias naar i18n/request.ts en
 * getTranslations neemt een expliciete taal aan, en dat is precies wat een
 * databankkolom kan leveren. Zie lib/i18n/locale.ts.
 *
 * Deze twee gaan mee in de volgende stap, samen met de klinische variant die
 * het reviewscherm en het rapport gebruiken. Ze staan hier nog omdat drie
 * servermodules ze aanroepen en dat een aparte wijziging is.
 */

/**
 * Sectienamen zoals de atleet ze leest, per sleutel uit `field_definitions`.
 *
 * Bewust andere woorden dan de databanksleutel: `current_status` zegt een
 * atleet niets, "Pain & complaints" wel. De sleutels zijn de zeven secties uit
 * supabase/seed.sql en die lijst is bevroren.
 */
export const SECTION_LABELS: Record<string, string> = {
  consent: "Consent",
  identity: "About you",
  biometrics: "Body measurements",
  training: "Training",
  medical_history: "Medical history",
  current_status: "Pain & complaints",
  uploads: "Documents",
};

export function sectionLabel(key: string | null | undefined): string {
  if (!key) return "";
  return SECTION_LABELS[key] ?? key;
}
