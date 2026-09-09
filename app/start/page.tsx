import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
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

/** Scherm 01: aanmelden of inloggen als atleet. */
export default async function StartPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/home";

  const athlete = await currentAthlete();
  if (athlete) redirect(target);

  return <AthleteAuth retention={retentionSentence()} next={target} />;
}
