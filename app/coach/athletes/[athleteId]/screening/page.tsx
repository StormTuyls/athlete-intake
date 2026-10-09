import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { checkCoach, isUuid } from "@/lib/review/access";
import { getAthleteProfile } from "@/lib/db/athletes";
import { getTimelineEvents, getTrends, listSessions } from "@/lib/db/screening";
import { MetricTrend } from "@/components/coach/MetricTrend";

export async function generateMetadata() {
  const t = await getTranslations("titles");
  return { title: t("athlete"), robots: { index: false, follow: false } };
}

export const dynamic = "force-dynamic";

const BLOCK_ORDER = ["anthropometry", "mobility_ll", "mobility_ul", "core",
                     "movement_ll", "forcedecks", "strength_ul"];

/**
 * Het verloop per metriek. FR-12.
 *
 * Elke grafiek heeft een tabel als tweelingweergave: een waarde mag nooit
 * alleen uit een plaatje te halen zijn, en een lijn van drie punten is voor
 * een schermlezer niets.
 */
export default async function ScreeningTrendPage({
  params,
}: {
  params: Promise<{ athleteId: string }>;
}) {
  const { athleteId } = await params;
  if (!isUuid(athleteId)) notFound();

  const access = await checkCoach();
  if (access.kind === "anonymous") {
    redirect(`/coach/login?next=/coach/athletes/${athleteId}/screening`);
  }
  if (access.kind !== "coach") notFound();

  const [athlete, trends, sessions, events] = await Promise.all([
    getAthleteProfile(athleteId),
    getTrends(athleteId, { id: access.coach.id }),
    listSessions(athleteId, { id: access.coach.id }),
    getTimelineEvents(athleteId),
  ]);
  if (!athlete) notFound();

  const t = await getTranslations("screening");
  const locale = await getLocale();
  const name = (m: { testLabelNl: string; testLabelEn: string }) =>
    locale === "nl" ? m.testLabelNl : m.testLabelEn;

  const labels = {
    left: t("left"),
    right: t("right"),
    protocolChanged: t("protocolChanged"),
    injury: t("asymmetry"),
  };

  const byBlock = new Map<string, typeof trends>();
  for (const trend of trends) {
    const list = byBlock.get(trend.block) ?? [];
    list.push(trend);
    byBlock.set(trend.block, list);
  }
  const ordered = [...byBlock].sort(
    (a, b) => (BLOCK_ORDER.indexOf(a[0]) + 1 || 99) - (BLOCK_ORDER.indexOf(b[0]) + 1 || 99),
  );

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href={`/coach/athletes/${athleteId}`} className="text-xs text-ink-muted underline">
        {athlete.name ?? t("backToAthlete")}
      </Link>

      <header className="mt-3 mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t("trend")}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {t("sessionsCount", { count: sessions.length })}
        </p>
        <p className="mt-2 max-w-prose text-xs text-ink-faint">{t("trendIntro")}</p>
      </header>

      {trends.length === 0 ? (
        <p className="text-sm text-ink-faint">{t("noTrend")}</p>
      ) : (
        ordered.map(([block, items]) => (
          <section key={block} className="mb-8">
            <h2 className="mb-3 text-sm font-medium">
              {t(`blocks.${block}` as "blocks.core")}
            </h2>
            <ul className="grid gap-6 sm:grid-cols-2">
              {items.map((metric) => {
                const bySide = new Map<string, typeof metric.points>();
                for (const p of metric.points) {
                  const list = bySide.get(p.side) ?? [];
                  list.push(p);
                  bySide.set(p.side, list);
                }
                const series = [...bySide].map(([side, points]) => ({
                  side: side as "left" | "right" | "bilateral" | "unknown",
                  points,
                }));
                const dates = [...new Set(metric.points.map((p) => p.date))].sort();

                return (
                  <li key={metric.metricKey} className="min-w-0">
                    <h3 className="mb-1 text-xs font-medium">{name(metric)}</h3>
                    <MetricTrend
                      series={series}
                      labels={labels}
                      events={events}
                      decimals={metric.decimals}
                    />

                    {/* De tweelingweergave. Elke waarde die in de grafiek staat
                        is hier ook te lezen, zonder kleur en zonder muis. */}
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[10px] text-ink-muted">
                        {t("tableView")}
                      </summary>
                      <table className="mt-1 w-full text-[10px] tabular-nums">
                        <thead>
                          <tr className="text-ink-faint">
                            <th scope="col" className="py-0.5 text-left font-normal">
                              {t("date")}
                            </th>
                            {series.map((s) => (
                              <th key={s.side} scope="col" className="py-0.5 text-right font-normal">
                                {s.side === "left" ? t("left") : s.side === "right" ? t("right") : metric.unit}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {dates.map((date) => (
                            <tr key={date} className="border-t border-hairline">
                              <th scope="row" className="py-0.5 text-left font-normal text-ink-muted">
                                {date}
                              </th>
                              {series.map((s) => {
                                const point = s.points.find((p) => p.date === date);
                                return (
                                  <td key={s.side} className="py-0.5 text-right">
                                    {point ? point.value.toFixed(metric.decimals) : "-"}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </details>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </main>
  );
}
