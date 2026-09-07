import { notFound, redirect } from "next/navigation";
import { ensureFrozenReport, getReport } from "@/lib/report/freeze";
import { checkCoach, isIntakeId } from "@/lib/review/access";
import { ReportDocument } from "@/components/review/ReportDocument";
import { AutoPrint } from "@/components/review/AutoPrint";
import { PRACTICE_NAME } from "@/lib/report/branding";
import { logAudit } from "@/lib/audit";

export const metadata = {
  title: "Intake report",
  robots: { index: false, follow: false },
};

/** Het rapport is per definitie niet te prerenderen: het leest een versie op aanvraag. */
export const dynamic = "force-dynamic";

/**
 * Het rapport om af te drukken of als PDF te bewaren.
 *
 * Geen @react-pdf/renderer. Dat brengt een eigen React-reconciler en een
 * layoutengine mee, en het belangrijkste bezwaar is niet de omvang maar dat geen
 * enkele regel van de bestaande vormgeving meegaat: het rapport zou twee keer
 * bestaan, in twee stylingsystemen, en die twee lopen uiteen. Zo is er één
 * document, en is de PDF aantoonbaar wat de coach op het scherm zag.
 *
 * De garantie die de klant kocht, namelijk dat een opnieuw gegenereerde PDF
 * klopt met wat er goedgekeurd is, komt van het bevroren snapshot en niet van de
 * renderer. `?version=1` geeft exact die versie terug.
 *
 * Wat dit niet doet: bytes op de server bewaren. `intake_reports.storage_path`
 * blijft daarom leeg. Wordt archivering een eis, dan laadt een headless browser
 * deze route en schrijft het resultaat weg; dan blijft het bij één renderer.
 */
export default async function PrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ intakeId: string }>;
  searchParams: Promise<{ version?: string }>;
}) {
  const { intakeId } = await params;
  const { version } = await searchParams;

  if (!isIntakeId(intakeId)) notFound();

  const access = await checkCoach();
  // Niet ingelogd hoort naar de login; ingelogd zonder coachrol hoort een 404 te
  // zien in plaats van een inlogformulier waar hij niets aan heeft.
  if (access.kind === "anonymous") redirect(`/coach/login?next=/review/${intakeId}/print`);
  if (access.kind !== "coach") notFound();
  const coach = access.coach;

  const requested = version === undefined ? null : Number(version);
  if (requested !== null && (!Number.isInteger(requested) || requested < 1)) notFound();

  const report =
    requested === null
      ? await ensureFrozenReport(intakeId, "export")
      : await getReport(intakeId, requested);

  if (!report) notFound();

  // Afdrukken is de data uit het systeem halen, ook al gebeurt het op papier.
  await logAudit({
    action: "export",
    actorKind: "coach",
    actorId: coach.id,
    entitySchema: "medical",
    entityTable: "intake_reports",
    entityId: intakeId,
    detail: {
      format: "print",
      version: report.version,
      contentHash: report.snapshot.contentHash.slice(0, 16),
    },
  });

  return (
    <>
      <AutoPrint />
      <ReportDocument
        snapshot={report.snapshot}
        version={report.version}
        practiceName={PRACTICE_NAME}
      />
    </>
  );
}
