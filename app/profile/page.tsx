import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { currentAthlete } from "@/lib/intake/athlete";
import { loadProfile } from "@/lib/intake/profile";
import { ProfileScreen } from "@/components/athlete/ProfileScreen";

export async function generateMetadata() {
  const t = await getTranslations("titles");

  return {
    title: t("profile"),
    robots: { index: false, follow: false },
  };
}

export const dynamic = "force-dynamic";

/**
 * Het profiel van de atleet, achter de avatar op het thuisscherm.
 *
 * Server component, om dezelfde reden als het thuisscherm: de lijst met
 * behandelaars komt niet via een publiek endpoint de browser in. Dat scheelt
 * een route die alleen bestaat om data te verhuizen, en het houdt de
 * RLS-policy op `profiles` zoals hij is (een atleet leest alleen zijn eigen
 * profiel).
 */
export default async function ProfilePage() {
  const athlete = await currentAthlete();
  if (!athlete) redirect("/start?next=/profile");

  const data = await loadProfile({
    athleteId: athlete.athleteId,
    email: athlete.email,
  });

  return (
    <div className="lg:min-h-dvh lg:bg-backdrop">
      <ProfileScreen data={data} />
    </div>
  );
}
