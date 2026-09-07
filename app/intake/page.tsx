import { redirect } from "next/navigation";
import { currentAthlete } from "@/lib/intake/athlete";
import { IntakeFlow } from "@/components/IntakeFlow";

export const metadata = {
  title: "Intake",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Het intakescherm. Alleen voor een ingelogde atleet.
 *
 * De intake zelf wordt op het thuisscherm geopend of hervat; dit scherm gaat er
 * van uit dat het cookie er al is. Zonder account is er ook geen intake om aan
 * te wijzen, dus dan terug naar de voordeur.
 */
export default async function IntakePage() {
  const athlete = await currentAthlete();
  if (!athlete) redirect("/start?next=/intake");

  return <IntakeFlow />;
}
