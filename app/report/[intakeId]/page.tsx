import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { currentAthlete } from "@/lib/intake/athlete";
import { isIntakeId } from "@/lib/review/access";
import { loadAthleteReport } from "@/lib/intake/report";
import { AthleteReportView } from "@/components/athlete/AthleteReport";

export async function generateMetadata() {
  const t = await getTranslations("titles");

  return {
    title: t("athleteReport"),
    robots: { index: false, follow: false },
  };
}

export const dynamic = "force-dynamic";

/**
 * Het rapport van de atleet over zijn eigen intake.
 *
 * De poort is eigenaarschap, niet een rol: loadAthleteReport geeft null zodra de
 * intake niet van deze atleet is, en dan een 404. Geen 403, want dat zou
 * bevestigen dat de intake bestaat.
 */
export default async function AthleteReportPage({
  params,
}: {
  params: Promise<{ intakeId: string }>;
}) {
  const { intakeId } = await params;
  if (!isIntakeId(intakeId)) notFound();

  const athlete = await currentAthlete();
  if (!athlete) redirect(`/start?next=/report/${intakeId}`);

  const report = await loadAthleteReport({
    intakeId,
    athleteId: athlete.athleteId,
  });

  if (!report) notFound();

  return (
    <AthleteReportView
      report={report}
      backTo={report.status === "draft" ? "/intake" : "/home"}
    />
  );
}
