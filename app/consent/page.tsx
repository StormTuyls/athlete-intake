import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { toLocale } from "@/lib/i18n/locale";
import { currentAthlete } from "@/lib/intake/athlete";
import { hasAccountConsent } from "@/lib/intake/consent";
import { retentionSentence } from "@/lib/intake/retention";
import { ConsentGate } from "@/components/athlete/ConsentGate";

export async function generateMetadata() {
  const t = await getTranslations("titles");

  return {
    title: t("consent"),
    robots: { index: false, follow: false },
  };
}

export const dynamic = "force-dynamic";

/**
 * De poort tussen een uitgenodigd account en een dossier.
 *
 * Alleen bereikbaar voor wie is ingelogd en nog geen accountconsent gaf. Wie hem
 * wel gaf wordt doorgestuurd: dit scherm twee keer tonen zou de indruk wekken
 * dat er iets mis is met de vorige keer, en het register weet al genoeg.
 *
 * De bewaartermijn gaat expliciet in de taal van dit scherm mee, om dezelfde
 * reden als op /start: de zin waar iemand mee instemt hoort in één taal te staan
 * en overeen te komen met wat er wordt vastgelegd.
 */
export default async function ConsentPage() {
  const athlete = await currentAthlete();
  if (!athlete) redirect("/start?next=/home");

  if (await hasAccountConsent(athlete.athleteId)) redirect("/home");

  const locale = toLocale(await getLocale());

  return <ConsentGate retention={retentionSentence(locale)} email={athlete.email} />;
}
