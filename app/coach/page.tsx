import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { checkCoach } from "@/lib/review/access";
import { listIntakesForCoach } from "@/lib/db/review";
import { PRACTICE_NAME } from "@/lib/report/branding";

export const metadata = {
  title: "Intakes",
  robots: { index: false, follow: false },
};

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
 */
export default async function CoachPage() {
  const access = await checkCoach();
  if (access.kind === "anonymous") redirect("/coach/login?next=/coach");
  if (access.kind !== "coach") notFound();
  const coach = access.coach;

  const intakes = await listIntakesForCoach();

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-8 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Intakes</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {PRACTICE_NAME} · signed in as {coach.fullName ?? coach.email}
          </p>
        </div>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="rounded-md px-3 py-1.5 text-xs font-medium text-ink-muted ring-1 ring-hairline ring-inset transition-colors hover:bg-canvas"
          >
            Sign out
          </button>
        </form>
      </header>

      {intakes.length === 0 ? (
        <p className="text-sm text-ink-faint">No intakes yet.</p>
      ) : (
        <ul className="divide-y divide-hairline">
          {intakes.map((intake) => (
            <li key={intake.id}>
              <Link
                href={`/review/${intake.id}`}
                className="flex items-baseline justify-between gap-4 py-3 transition-colors hover:bg-canvas"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {intake.athleteName ?? "Name unknown"}
                  </span>
                  <span className="block text-xs text-ink-muted">
                    {intake.status}
                    {intake.submittedAt ? ` · ${intake.submittedAt.slice(0, 10)}` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-ink-muted">
                  {intake.requiredFilled}/{intake.requiredTotal} required
                  {intake.conflicts > 0 && (
                    <span className="ml-2 text-warn">
                      {intake.conflicts} to check
                    </span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
