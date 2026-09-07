import { redirect } from "next/navigation";
import { currentAthlete } from "@/lib/intake/athlete";
import { loadHome } from "@/lib/intake/home";
import { HomeScreen } from "@/components/athlete/HomeScreen";

export const metadata = {
  title: "unbound",
  robots: { index: false, follow: false },
};

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

  const data = await loadHome({
    athleteId: athlete.athleteId,
    fullName: athlete.fullName,
    email: athlete.email,
  });

  return <HomeScreen data={data} />;
}
