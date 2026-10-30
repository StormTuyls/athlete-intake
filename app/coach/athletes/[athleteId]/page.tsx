import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { checkCoach, isIntakeId } from "@/lib/review/access";
import { getAthleteProfile } from "@/lib/db/athletes";
import { listTeam } from "@/lib/db/practitioners";
import { PurgeAthlete } from "@/components/coach/PurgeAthlete";
import { AssignPractitioner } from "@/components/coach/AssignPractitioner";

export async function generateMetadata() {
  const t = await getTranslations("titles");

  return {
    title: t("athlete"),
    robots: { index: false, follow: false },
  };
}

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

/** Zelfde rij, maar met iets bedienbaars erin in plaats van tekst. */
function ControlRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-1.5 text-sm sm:flex-row sm:items-center sm:gap-3">
      <dt className="text-xs text-ink-muted sm:w-40 sm:shrink-0">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/** De sleutel voor deze status; de pagina vertaalt hem. */
function statusKey(status: string): "statusApproved" | "statusInReview" | "statusSubmitted" | "statusDraft" {
  if (status === "approved") return "statusApproved";
  if (status === "in_review") return "statusInReview";
  if (status === "submitted") return "statusSubmitted";
  return "statusDraft";
}

/**
 * De status als label, niet als titel.
 *
 * Wachtend werk moet eruit springen; afgetekend werk hoort rustig te zijn. Vier
 * identieke grijze pillen zouden hetzelfde probleem geven als vier identieke
 * titels.
 */
function statusStyle(status: string): string {
  if (status === "submitted" || status === "in_review") {
    return "bg-warn-soft text-warn";
  }
  if (status === "approved") return "bg-ok/10 text-ok";
  return "bg-canvas text-ink-muted";
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

  const [athlete, team] = await Promise.all([
    getAthleteProfile(athleteId),
    listTeam(),
  ]);
  if (!athlete) notFound();

  // Gearchiveerde behandelaars staan er wel bij, met een label. De atleet ziet
  // ze niet meer, maar een dossier terugzetten op wie het behandeld heeft is
  // een correctie die de praktijk moet kunnen maken.
  const assignable = team
    .filter((member) => member.kind !== null)
    .map((member) => ({
      id: member.id,
      name: member.fullName,
      kind: member.kind!,
      archived: member.archivedAt !== null,
    }));

  const tc = await getTranslations("coach");
  const titles = await getTranslations("titles");

  const retention =
    athlete.retentionMode === "until_date"
      ? tc("keptUntil", { date: athlete.retentionUntil ?? tc("unknown") })
      : tc("keptIndefinitely");

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 lg:max-w-5xl">
      <Link href="/coach" className="text-xs text-ink-muted underline">
        {titles("athletes")}
      </Link>

      <header className="mt-3 mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          {athlete.name ?? tc("nameUnknown")}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          {tc("intakeCount", { count: athlete.intakes.length })}
          {athlete.hasAccount ? tc("hasAccount") : tc("noAccount")}
        </p>
      </header>

      {/* Vanaf lg naast elkaar. Links waar de behandelaar voor komt: wie dit
          is, en welke dossiers er liggen. Rechts wat je zelden aanraakt maar
          wel moet kunnen vinden: bewaartermijn, toestemming, en wissen.

          Wissen hoort bewust niet onder de intakelijst. Een knop die een
          persoon verwijdert, direct onder de rij die je aanklikt om een
          dossier te openen, is een knop die je een keer per ongeluk raakt. */}
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-10">
        <div className="min-w-0">
        <section className="mb-8">
          <h2 className="mb-1 text-sm font-medium">{tc("details")}</h2>
          <dl className="divide-y divide-hairline border-t border-hairline">
            <Row label={tc("email")} value={athlete.email} />
            <Row label={tc("phone")} value={athlete.phone} />
            <Row label={tc("address")} value={athlete.address} />
            {/* Twee rijen die op elkaar lijken en dat niet zijn. "Assigned to" is
                iemand met een login hier; de atleet kiest hem op zijn profiel en
                de praktijk kan het hier corrigeren. "Own coach" is zijn eigen
                trainer, een naam uit het dossier. */}
            <ControlRow label={tc("assignedTo")}>
              <AssignPractitioner
                athleteId={athlete.id}
                current={athlete.practitionerId}
                options={assignable}
              />
            </ControlRow>
            <Row label={tc("sport")} value={athlete.sport} />
            <Row label={tc("discipline")} value={athlete.discipline} />
            <Row label={tc("club")} value={athlete.club} />
            <Row label={tc("federation")} value={athlete.federation} />
            <Row label={tc("ownCoach")} value={athlete.coachName} />
          </dl>
          <p className="mt-2 text-xs text-ink-faint">
            {tc("adminNote")}
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-1 text-sm font-medium">{tc("intakes")}</h2>
          {athlete.intakes.length === 0 ? (
            <p className="text-sm text-ink-faint">{tc("noIntakes")}</p>
          ) : (
            <ul className="divide-y divide-hairline border-t border-hairline">
              {athlete.intakes.map((intake) => (
                <li key={intake.id}>
                  <Link
                    href={`/review/${intake.id}`}
                    className="flex flex-col gap-1 py-2.5 transition-colors hover:bg-canvas sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
                  >
                    <span className="min-w-0">
                      {/* De klacht als titel. De status zegt niets over welk
                          dossier dit is, en bij twee intakes staat er twee keer
                          hetzelfde; de klacht onderscheidt ze wel. */}
                      <span className="block text-sm font-medium">
                        {intake.label ?? tc("intakeFallback")}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] whitespace-nowrap ${statusStyle(intake.status)}`}
                        >
                          {tc(statusKey(intake.status))}
                        </span>
                        {/* nowrap, anders breekt een datum op een smal scherm
                            midden in de maand af: "2026-" / "08-08". */}
                        <span className="text-xs whitespace-nowrap text-ink-muted">
                          {(intake.submittedAt ?? intake.startedAt)?.slice(0, 10)}
                        </span>
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-ink-muted">
                      {tc("required", {
                        filled: intake.requiredFilled,
                        total: intake.requiredTotal,
                      })}
                      {intake.conflicts > 0 && (
                        <span className="ml-2 text-warn">
                          {tc("toCheck", { count: intake.conflicts })}
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        </div>

        <aside className="min-w-0 lg:sticky lg:top-10">
        <section>
          <h2 className="mb-1 text-sm font-medium">{tc("dataAndConsent")}</h2>
          <dl className="divide-y divide-hairline border-t border-hairline">
            <Row label={tc("retention")} value={retention} />
            <Row label={tc("retentionBasis")} value={athlete.retentionBasis} />
            <Row
              label={tc("consentOnFile")}
              value={
                athlete.accountConsentAt
                  ? tc("consentGiven", { date: athlete.accountConsentAt.slice(0, 10) })
                  : null
              }
            />
          </dl>
        </section>

        <PurgeAthlete
          athleteId={athlete.id}
          athleteName={athlete.name}
          intakeCount={athlete.intakes.length}
          hasAccount={athlete.hasAccount}
        />
        </aside>
      </div>
    </main>
  );
}
