import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
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

  const t = await getTranslations("screening");
  const locale = await getLocale();

  const tests: EntryTest[] = library.map((item) => ({
    testKey: item.testKey,
    block: item.block,
    label: locale === "nl" ? item.labelNl : item.labelEn,
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
        {athlete.name ?? t("title")}
      </Link>

      <header className="mt-3 mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t("new")}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t("intro")}</p>
      </header>

      {tests.length === 0 ? (
        <p className="text-sm text-ink-faint">
          {t("emptyLibrary", { command: "npm run seed:screening" })}
        </p>
      ) : (
        <ScreeningEntry athleteId={athleteId} tests={tests} />
      )}
    </main>
  );
}
