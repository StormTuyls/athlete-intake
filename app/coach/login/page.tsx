import { redirect } from "next/navigation";
import { currentCoach } from "@/lib/review/access";
import { CoachLogin } from "@/components/coach/CoachLogin";

export const metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

/**
 * Inloggen voor de coach, met een magic link.
 *
 * Geen wachtwoord. Een praktijk van een paar behandelaars heeft geen
 * wachtwoordbeleid, geen resetflow en geen plek om ze te bewaren, en dan wordt
 * het wachtwoord het zwakste deel van een systeem dat verder medische data
 * netjes afschermt. Een link naar het werkadres leunt op de mailbox, en die is
 * bij deze doelgroep beter beveiligd dan een zelfgekozen wachtwoord.
 */
export default async function CoachLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  // Al ingelogd: doorlopen naar waar hij heen wilde.
  const coach = await currentCoach();
  if (coach) redirect(next && next.startsWith("/") ? next : "/coach");

  return <CoachLogin next={next ?? null} linkFailed={error === "link"} />;
}
