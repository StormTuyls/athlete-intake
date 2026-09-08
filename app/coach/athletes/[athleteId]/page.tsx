import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { checkCoach, isIntakeId } from "@/lib/review/access";
import { getAthleteProfile } from "@/lib/db/athletes";

export const metadata = {
  title: "Athlete",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Het profiel van een atleet: wie het is, en welke intakes er liggen.
 *
 * Bewust geen medische inhoud. Elk veld hier komt uit de identiteitssectie van
 * de taxonomie met `is_medical = false`, en de query filtert daarop in SQL in
 * plaats van op een lijst sleutels in deze pagina: breidt de taxonomie ooit uit,
 * dan lekt er niets mee omdat iemand vergat deze lijst bij te werken. Lengte,
 * gewicht, klachten en blessures blijven achter het dossier van een intake.
 *
 * Waarom deze pagina bestaat: wissen, bewaartermijn en toestemming zijn
 * eigenschappen van een persoon, niet van een intake. Zonder atleetpagina hangt
 * dat straks aan een willekeurige intake, en dat is precies hoe je per ongeluk
 * de verkeerde atleet verwijdert.
 */

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-0.5 py-1.5 text-sm sm:flex-row sm:gap-3">
      <dt className="text-xs text-ink-muted sm:w-40 sm:shrink-0">{label}</dt>
      <dd className={value ? "min-w-0" : "min-w-0 text-ink-faint"}>{value ?? "-"}</dd>
    </div>
  );
}

function statusLabel(status: string): string {
  if (status === "approved") return "approved";
  if (status === "in_review") return "in review";
  if (status === "submitted") return "waiting for review";
  return "in progress";
}

export default async function AthletePage({
  params,
}: {
  params: Promise<{ athleteId: string }>;
}) {
  const { athleteId } = await params;

  // Dezelfde vormcontrole als bij een intake-id: een misvormd pad hoort een 404
  // te geven en niet een pg-fout die als 500 naar buiten komt.
  if (!isIntakeId(athleteId)) notFound();

  const access = await checkCoach();
  if (access.kind === "anonymous") {
    redirect(`/coach/login?next=/coach/athletes/${athleteId}`);
  }
  if (access.kind !== "coach") notFound();

  const athlete = await getAthleteProfile(athleteId);
  if (!athlete) notFound();

  const retention =
    athlete.retentionMode === "until_date"
      ? `until ${athlete.retentionUntil ?? "unknown"}`
      : "kept indefinitely";

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/coach" className="text-xs text-ink-muted underline">
        Athletes
      </Link>

      <header className="mt-3 mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          {athlete.name ?? "Name unknown"}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          {athlete.intakes.length === 1
            ? "1 intake"
            : `${athlete.intakes.length} intakes`}
          {athlete.hasAccount ? " · has an account" : " · no account, file only"}
        </p>
      </header>

      <section className="mb-8">
        <h2 className="mb-1 text-sm font-medium">Details</h2>
        <dl className="divide-y divide-hairline border-t border-hairline">
          <Row label="Email" value={athlete.email} />
          <Row label="Phone" value={athlete.phone} />
          <Row label="Sport" value={athlete.sport} />
          <Row label="Discipline" value={athlete.discipline} />
          <Row label="Club" value={athlete.club} />
          <Row label="Federation" value={athlete.federation} />
          <Row label="Coach" value={athlete.coachName} />
        </dl>
        <p className="mt-2 text-xs text-ink-faint">
          Administrative data only. Body measurements, complaints and injury
          history stay inside the intake file.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="mb-1 text-sm font-medium">Intakes</h2>
        {athlete.intakes.length === 0 ? (
          <p className="text-sm text-ink-faint">No intakes yet.</p>
        ) : (
          <ul className="divide-y divide-hairline border-t border-hairline">
            {athlete.intakes.map((intake) => (
              <li key={intake.id}>
                <Link
                  href={`/review/${intake.id}`}
                  className="flex items-baseline justify-between gap-4 py-2.5 transition-colors hover:bg-canvas"
                >
                  <span className="min-w-0 text-sm">
                    <span
                      className={
                        intake.status === "submitted" || intake.status === "in_review"
                          ? "font-medium"
                          : undefined
                      }
                    >
                      {statusLabel(intake.status)}
                    </span>
                    <span className="ml-2 text-xs text-ink-muted">
                      {(intake.submittedAt ?? intake.startedAt)?.slice(0, 10)}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-ink-muted">
                    {intake.requiredFilled}/{intake.requiredTotal} required
                    {intake.conflicts > 0 && (
                      <span className="ml-2 text-warn">{intake.conflicts} to check</span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-sm font-medium">Data and consent</h2>
        <dl className="divide-y divide-hairline border-t border-hairline">
          <Row label="Retention" value={retention} />
          <Row label="Retention basis" value={athlete.retentionBasis} />
          <Row
            label="Consent on file"
            value={
              athlete.accountConsentAt
                ? `given ${athlete.accountConsentAt.slice(0, 10)}`
                : null
            }
          />
        </dl>
      </section>
    </main>
  );
}
