import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { checkCoach } from "@/lib/review/access";
import { listAthletesForCoach } from "@/lib/db/athletes";
import { PRACTICE_NAME } from "@/lib/report/branding";
import { AthleteList } from "@/components/coach/AthleteList";
import { LocaleToggle } from "@/components/LocaleToggle";

export async function generateMetadata() {
  const t = await getTranslations("titles");

  return {
    title: t("athletes"),
  robots: { index: false, follow: false },
  };
}

export const dynamic = "force-dynamic";

/**
 * De werklijst van de behandelaar.
 *
 * Bestond nog niet: het reviewscherm was alleen bereikbaar via een link uit
 * Notion of een intake-id dat je toevallig had. Met een login hoort daar een
 * plek bij om te zien wat er ligt.
 *
 * Bewust alleen wat nodig is om te kiezen welk dossier je opent: naam, status,
 * volledigheid en of er iets tegenstrijdig is. Geen klachten, geen diagnoses.
 * Een overzichtspagina die medische inhoud toont is een pagina die je niet open
 * kunt laten staan terwijl er iemand naast je zit.
 *
 * Zoeken en filteren zit in components/coach/AthleteList.tsx, want dat vraagt om
 * toestand in de browser. Deze pagina blijft de server-kant: autorisatie en het
 * ophalen.
 */
export default async function CoachPage() {
  const access = await checkCoach();
  if (access.kind === "anonymous") redirect("/coach/login?next=/coach");
  if (access.kind !== "coach") notFound();
  const coach = access.coach;

  const athletes = await listAthletesForCoach();

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-8 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Athletes</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {PRACTICE_NAME} · signed in as {coach.fullName ?? coach.email}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <LocaleToggle />
          <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="rounded-md px-3 py-1.5 text-xs font-medium text-ink-muted ring-1 ring-hairline ring-inset transition-colors hover:bg-canvas"
          >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <AthleteList athletes={athletes} />

    </main>
  );
}
