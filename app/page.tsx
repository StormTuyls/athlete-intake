import { redirect } from "next/navigation";
import { currentAthlete } from "@/lib/intake/athlete";
import { currentCoach } from "@/lib/review/access";

export const dynamic = "force-dynamic";

/**
 * De voordeur.
 *
 * Stuurt door op basis van wie er is: een atleet naar zijn thuisscherm, een
 * behandelaar naar de werklijst, en wie niemand is naar het aanmeldscherm.
 * Eerst de coach controleren, want een behandelaar heeft geen `athletes`-rij en
 * zou anders op het atleetpad belanden.
 */
export default async function RootPage() {
  const coach = await currentCoach();
  if (coach) redirect("/coach");

  const athlete = await currentAthlete();
  if (athlete) redirect("/home");

  redirect("/start");
}
