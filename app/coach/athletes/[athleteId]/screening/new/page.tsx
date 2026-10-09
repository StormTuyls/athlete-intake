import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { checkCoach, isUuid } from "@/lib/review/access";
import { getAthleteProfile } from "@/lib/db/athletes";
import { getLibrary } from "@/lib/db/screening";
import { ScreeningEntry, type EntryTest } from "@/components/coach/ScreeningEntry";

export async function generateMetadata() {
  const t = await getTranslations("titles");
  return { title: t("athlete"), robots: { index: false, follow: false } };
}

export const dynamic = "force-dynamic";

/**
 * Een screening invoeren.
 *
 * De bibliotheek komt server-side binnen: welke tests er zijn, welke per zijde
 * gaan, en of er op dit moment een band uit kan komen. Dat laatste staat bij het
 * veld, niet pas op het resultaatscherm, zodat een tester weet wat hij meet.
 */
export default async function NewScreeningPage({
  params,
}: {
  params: Promise<{ athleteId: string }>;
}) {
  const { athleteId } = await params;
  if (!isUuid(athleteId)) notFound();

  const access = await checkCoach();
  if (access.kind === "anonymous") {
    redirect(`/coach/login?next=/coach/athletes/${athleteId}/screening/new`);
  }
  if (access.kind !== "coach") notFound();

  const [athlete, library] = await Promise.all([
    getAthleteProfile(athleteId),
    getLibrary(),
  ]);
  if (!athlete) notFound();

  const tests: EntryTest[] = library.map((item) => ({
    testKey: item.testKey,
    block: item.block,
    label: item.labelEn,
    metricKey: item.metricKey,
    unit: item.unit,
    perSide: item.laterality === "per_side",
    decimals: item.decimals,
    classifies: item.rule?.classificationEnabled ?? false,
    protocolConfirmed: item.protocolConfirmed,
    note: item.ruleNote,
  }));

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href={`/coach/athletes/${athleteId}`} className="text-xs text-ink-muted underline">
        {athlete.name ?? "Athlete"}
      </Link>

      <header className="mt-3 mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">New screening</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Fill in what you measured. Leave the rest empty; an empty field means
          not measured, not zero.
        </p>
      </header>

      {tests.length === 0 ? (
        <p className="text-sm text-ink-faint">
          No tests in the library yet. Run <code>npm run seed:screening</code>.
        </p>
      ) : (
        <ScreeningEntry athleteId={athleteId} tests={tests} />
      )}
    </main>
  );
}
