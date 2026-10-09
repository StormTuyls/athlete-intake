import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { checkCoach, isUuid } from "@/lib/review/access";
import { ensureFrozenScreening, getScreeningReport } from "@/lib/report/screeningFreeze";
import { AutoPrint } from "@/components/review/AutoPrint";
import { PRACTICE_NAME } from "@/lib/report/branding";
import { logAudit } from "@/lib/audit";

export async function generateMetadata() {
  const t = await getTranslations("screening");
  return { title: t("report"), robots: { index: false, follow: false } };
}

export const dynamic = "force-dynamic";

const BLOCK_ORDER = ["anthropometry", "mobility_ll", "mobility_ul", "core",
                     "movement_ll", "forcedecks", "strength_ul"];

const UNIT_SUFFIX: Record<string, string> = {
  deg: "°", cm: " cm", n: " N", xbw: "×BW", score: "", percent: "%",
  hand_lengths: "", mm: " mm", s: " s", kg: " kg",
};

/**
 * Het screeningrapport om af te drukken of als PDF te bewaren.
 *
 * Rendert UITSLUITEND uit een bevroren versie, nooit uit de huidige stand. Dat
 * is bij een screening scherper dan bij een intake: de praktijk kan op
 * /coach/library een drempel bijstellen, en zonder deze regel zou een afdruk
 * van vorig jaar met de drempels van vandaag opnieuw ingedeeld worden.
 *
 * De print-CSS staat al in app/globals.css en verbergt alles buiten .report.
 */
export default async function ScreeningPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ version?: string }>;
}) {
  const { sessionId } = await params;
  const { version } = await searchParams;
  if (!isUuid(sessionId)) notFound();

  const access = await checkCoach();
  if (access.kind === "anonymous") {
    redirect(`/coach/login?next=/coach/screening/${sessionId}/print`);
  }
  if (access.kind !== "coach") notFound();

  const actor = { id: access.coach.id };
  const report = version
    ? await getScreeningReport(sessionId, Number(version))
    : await ensureFrozenScreening(sessionId, actor, access.coach.id);
  if (!report) notFound();

  const t = await getTranslations("screening");
  const locale = await getLocale();
  const s = report.snapshot;
  const name = (r: { testLabelNl: string; testLabelEn: string }) =>
    locale === "nl" ? r.testLabelNl : r.testLabelEn;

  await logAudit({
    actorId: access.coach.id,
    actorKind: access.coach.role === "admin" ? "admin" : "coach",
    action: "export",
    entitySchema: "medical",
    entityTable: "screening_reports",
    entityId: sessionId,
    detail: { version: report.version, format: "print" },
  });

  const blocks = new Map<string, typeof s.results>();
  for (const row of s.results) {
    const list = blocks.get(row.block) ?? [];
    list.push(row);
    blocks.set(row.block, list);
  }
  const ordered = [...blocks].sort(
    (a, b) => (BLOCK_ORDER.indexOf(a[0]) + 1 || 99) - (BLOCK_ORDER.indexOf(b[0]) + 1 || 99),
  );

  const rules = new Map<string, { label: string; version: number | null; citation: string | null; note: string | null }>();
  for (const row of s.results) {
    if (row.ruleCitation || row.ruleNote) {
      rules.set(name(row), {
        label: name(row),
        version: row.ruleVersion,
        citation: row.ruleCitation,
        note: row.ruleNote,
      });
    }
  }

  return (
    <>
      <AutoPrint />
      <main className="report mx-auto max-w-3xl px-6 py-10">
        <header className="mb-6">
          <p className="text-xs text-ink-muted">{PRACTICE_NAME}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {s.athleteName ?? t("title")}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            {t("title")} {s.occurredOn}
            {s.bodyMassKg ? ` · ${s.bodyMassKg} kg` : ""}
          </p>
          <p className="mt-0.5 text-xs text-ink-faint">
            {t("reportVersion", { n: report.version, date: s.generatedAt.slice(0, 10) })}
          </p>
        </header>

        {ordered.map(([block, rows]) => (
          <section key={block} className="mb-5 break-inside-avoid">
            <h2 className="mb-1 text-sm font-medium">
              {t(`blocks.${block}` as "blocks.core")}
            </h2>
            <table className="w-full text-sm">
              <tbody>
                {rows.map((row, i) => (
                  <tr key={`${row.metricKey}-${row.kind}-${row.side}-${i}`} className="border-t border-hairline">
                    <td className="py-1">
                      {name(row)}
                      <span className="ml-1.5 text-xs text-ink-faint">
                        {(() => {
                          const side =
                            row.side === "left"
                              ? t("left")
                              : row.side === "right"
                                ? t("right")
                                : "";
                          if (row.kind === "asymmetry") return t("asymmetry");
                          // Ook bij een delta de zijde erbij: anders staan er
                          // twee regels "t.o.v. vorige" die niet te scheiden zijn.
                          if (row.kind === "delta") {
                            return side ? `${t("vsPrevious")}, ${side}` : t("vsPrevious");
                          }
                          return side;
                        })()}
                      </span>
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {row.status === "computed" && row.value !== null
                        ? `${row.value.toFixed(row.kind === "absolute" ? row.decimals : 1)}${UNIT_SUFFIX[row.unit] ?? ` ${row.unit}`}`
                        : t(`unavailable.${row.unavailableReason ?? "missing_input"}` as "unavailable.missing_input")}
                    </td>
                    <td className="w-24 py-1 pl-3 text-right text-xs text-ink-muted">
                      {row.bandStatus?.replace(/_/g, " ") ?? ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}

        {s.unclassified > 0 && (
          <p className="mb-4 text-xs text-ink-faint">
            {t("unclassified", { count: s.unclassified })}
          </p>
        )}

        {rules.size > 0 && (
          <section className="break-inside-avoid border-t border-hairline pt-3">
            <h2 className="mb-1 text-sm font-medium">{t("rules")}</h2>
            <ul className="text-xs text-ink-faint">
              {[...rules.values()].map((rule) => (
                <li key={rule.label} className="py-0.5">
                  <span className="text-ink-muted">{rule.label}</span>
                  {rule.version !== null && ` · ${t("ruleVersion", { n: rule.version })}`}
                  {rule.citation && ` · ${rule.citation}`}
                  {rule.note && <span className="block">{rule.note}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="mt-4 border-t border-hairline pt-2 text-[10px] text-ink-faint">
          {t("frozenNote")}
        </p>
      </main>
    </>
  );
}
