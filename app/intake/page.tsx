import { redirect } from "next/navigation";
import { currentAthlete } from "@/lib/intake/athlete";
import { currentIntake } from "@/lib/intake/session";
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
 *
 * Die voordeur is `/home` en niet `/intake`, en dat is de reden dat hier twee
 * redirects staan in plaats van een. De linktree wijst naar `/intake`. Een
 * nieuwe atleet kwam daar binnen, ging naar `/start?next=/intake`, registreerde
 * zich, en werd door dat `next` weer op `/intake` gezet. Alleen zet
 * `/api/athlete/register` geen intakecookie: dat doet `POST /api/intake`, en dat
 * gebeurt op het thuisscherm. Het resultaat was een doodlopend scherm met "Your
 * session has expired" op de eerste pagina die een atleet ooit ziet. Gemeten op
 * productie, niet bedacht.
 *
 * De tweede redirect dekt hetzelfde gat voor een bestaande atleet: het cookie is
 * een capability token van dertig dagen, dus het verloopt en het reist niet mee
 * naar een ander toestel. Zonder geldige sessie is er niets te tonen, en hoort
 * hij naar de plek waar een intake geopend of hervat wordt.
 */
export default async function IntakePage() {
  const athlete = await currentAthlete();
  if (!athlete) redirect("/start?next=/home");

  const session = await currentIntake();
  if (!session) redirect("/home");

  return <IntakeFlow />;
}
