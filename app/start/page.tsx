import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { toLocale } from "@/lib/i18n/locale";
import { currentAthlete } from "@/lib/intake/athlete";
import { retentionSentence } from "@/lib/intake/retention";
import { AthleteAuth } from "@/components/athlete/AthleteAuth";

export async function generateMetadata() {
  const t = await getTranslations("titles");

  return {
    title: t("start"),
    robots: { index: false, follow: false },
  };
}

export const dynamic = "force-dynamic";

/**
 * Scherm 01: aanmelden of inloggen als atleet.
 *
 * De bewaartermijn gaat expliciet in de taal van dit scherm mee. Zonder die
 * parameter viel retentionSentence() terug op DEFAULT_LOCALE, en dan las een
 * Nederlandstalige bezoeker een Nederlandse consentzin met een Engelse
 * bewaartermijn erachter. Bij een gewone tekst is dat een schoonheidsfout; hier
 * is het de tekst waar iemand toestemming voor geeft, en die hoort in één taal
 * te staan en overeen te komen met wat er wordt vastgelegd.
 */
export default async function StartPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/home";

  const athlete = await currentAthlete();
  if (athlete) redirect(target);

  // Uit het cookie via next-intl, net als het thuisscherm: de bezoeker kan net
  // op de taalknop hebben gedrukt, en dan hoort deze zin mee te gaan.
  const locale = toLocale(await getLocale());

  return <AthleteAuth retention={retentionSentence(locale)} next={target} />;
}
