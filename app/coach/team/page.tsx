import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { checkCoach } from "@/lib/review/access";
import { listTeam } from "@/lib/db/practitioners";
import { PRACTICE_NAME } from "@/lib/report/branding";
import { TeamManager } from "@/components/coach/TeamManager";

export const metadata = {
  title: "Team",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Wie er in deze praktijk behandelt.
 *
 * Alleen voor een admin. Een gewone behandelaar kan hier niet komen en de
 * routes eronder weigeren hem ook: dit scherm bepaalt wie er bij medische
 * dossiers mag, en dat is de ene handeling die niet bij iedereen hoort te
 * liggen.
 *
 * 404 en geen 403 voor wie wel is ingelogd maar geen admin is. Zelfde
 * redenering als bij het atleetdossier: het bestaan van een beheerscherm is
 * niets wat een behandelaar hoeft te weten, en een foutmelding die zegt "dit
 * bestaat, maar niet voor jou" is een uitnodiging.
 */
export default async function TeamPage() {
  const access = await checkCoach();
  if (access.kind === "anonymous") redirect("/coach/login?next=/coach/team");
  if (access.kind !== "coach") notFound();
  if (access.coach.role !== "admin") notFound();

  const team = await listTeam();

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/coach" className="text-xs text-ink-muted underline">
        Athletes
      </Link>

      <header className="mt-3 mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {PRACTICE_NAME} · who treats here, and who athletes can pick
        </p>
      </header>

      <TeamManager team={team} />
    </main>
  );
}
