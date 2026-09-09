import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { toLocale } from "@/lib/i18n/locale";
import { currentAthlete } from "@/lib/intake/athlete";
import { loadHome } from "@/lib/intake/home";
import { HomeScreen } from "@/components/athlete/HomeScreen";

export async function generateMetadata() {
  const t = await getTranslations("titles");

  return {
    title: t("home"),
    robots: { index: false, follow: false },
  };
}

export const dynamic = "force-dynamic";

/**
 * Scherm 02: het thuisscherm van de atleet.
 *
 * Server component, dus de lijst met intakes komt niet via een publiek endpoint
 * de browser in. Dat scheelt een route die alleen bestaat om data te verhuizen,
 * en het is één plek minder waar een autorisatiecontrole vergeten kan worden.
 */
export default async function HomePage() {
  const athlete = await currentAthlete();
  if (!athlete) redirect("/start?next=/home");

  // De taal van het scherm, niet die van de atleetrij: de bezoeker kan net op
  // de taalknop hebben gedrukt, en dan hoort dit scherm mee te gaan.
  const locale = toLocale(await getLocale());

  const data = await loadHome({
    athleteId: athlete.athleteId,
    fullName: athlete.fullName,
    email: athlete.email,
    locale,
  });

  return <HomeScreen data={data} />;
}
