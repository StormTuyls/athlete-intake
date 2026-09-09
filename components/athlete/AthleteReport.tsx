import { useTranslations } from "next-intl";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { SectionLabel } from "@/components/intake/SectionLabel";
import { ChevronLeftIcon } from "@/components/intake/icons";
import { PRACTICE_NAME } from "@/lib/report/branding";
import type { AthleteReport } from "@/lib/intake/report";

/**
 * Wat er tot nu toe verzameld is, voor de atleet zelf.
 *
 * Geen bronciteten, wel de bestandsnaam: zie lib/intake/report.ts.
 *
 * De opzet volgt het rapport uit het ontwerp (masthead, ring, velden per sectie)
 * maar zonder de coachdelen. Er staan geen confidence-chips: "citaat niet
 * teruggevonden" is een instructie voor iemand die het brondocument kan openen,
 * en dat is de behandelaar. Wat de atleet wel moet zien is waar hij zelf nog
 * iets aan kan doen, en dat staat bovenaan.
 */
export function AthleteReportView({
  report,
  backTo,
}: {
  report: AthleteReport;
  backTo: string;
}) {
  const t = useTranslations("athleteReport");
  const dated = report.submittedAt ?? report.startedAt;

  return (
    <main className="mx-auto min-h-dvh max-w-[30rem] bg-canvas px-4 pt-4 pb-10">
      <header className="flex items-center gap-3 px-1 py-2">
        <Link
          href={backTo}
          aria-label={t("back")}
          className="-ml-1.5 flex size-8 shrink-0 items-center justify-center rounded-chip text-ink-muted hover:bg-surface"
        >
          <ChevronLeftIcon className="size-5" />
        </Link>
        <div className="min-w-0">
          <SectionLabel>{t("title")}</SectionLabel>
          <h1 className="text-lg font-semibold tracking-tight text-ink">
            {PRACTICE_NAME}
          </h1>
        </div>
      </header>

      <section className="mt-2 rounded-card bg-surface p-4 shadow-card ring-1 ring-hairline ring-inset">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm text-ink">
            <strong>
              {report.requiredFilled} of {report.requiredTotal}
            </strong>{" "}
            {t("requiredComplete")}
          </p>
          <span className="text-xs text-ink-faint">
            {dated ? dated.slice(0, 10) : ""}
          </span>
        </div>
        <p className="mt-1 text-xs text-ink-muted">
          {report.status === "draft"
            ? t("stillOpen")
            : t("sent")}
        </p>
      </section>

      {report.attention.length > 0 && (
        <section className="mt-3 rounded-card border border-warn/30 bg-warn-soft p-4">
          <SectionLabel className="text-warn">{t("attention")}</SectionLabel>
          <ul className="mt-2 space-y-1.5">
            {report.attention.map((item) => (
              <li key={item.fieldKey} className="text-sm text-ink">
                {item.label}
                <span className="text-ink-muted">
                  {" · "}
                  {item.reason === "conflicting"
                    ? "your documents disagree"
                    : "not answered yet"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.sections.map((section) => (
        <section key={section.key} className="mt-5">
          <div className="flex items-baseline justify-between px-1">
            <SectionLabel>{section.label}</SectionLabel>
            <span className="text-xs tabular-nums text-ink-faint">
              {section.filled}/{section.total}
            </span>
          </div>

          <dl className="mt-2 divide-y divide-hairline rounded-card bg-surface shadow-card ring-1 ring-hairline ring-inset">
            {section.values.map((item) => (
              <div key={item.fieldKey} className="px-4 py-2.5">
                <dt className="text-xs text-ink-muted">
                  {item.label}
                  {item.required && <span className="text-ink-faint"> · required</span>}
                </dt>
                <dd
                  className={cn(
                    "mt-0.5 text-sm break-words",
                    item.value ? "text-ink" : "text-ink-faint italic",
                  )}
                >
                  {item.value || t("notAnswered")}
                </dd>
                {item.fromDocument && (
                  <p className="mt-0.5 text-xs text-ink-faint">
                    from {item.fromDocument}
                  </p>
                )}
              </div>
            ))}
          </dl>
        </section>
      ))}

      <section className="mt-5">
        <SectionLabel>{t("documents")}</SectionLabel>
        {report.documents.length === 0 ? (
          <p className="mt-2 px-1 text-sm text-ink-faint">{t("noneYet")}</p>
        ) : (
          <ul className="mt-2 divide-y divide-hairline rounded-card bg-surface shadow-card ring-1 ring-hairline ring-inset">
            {report.documents.map((document) => (
              <li key={document.filename} className="px-4 py-2.5 text-sm text-ink">
                {document.filename}
                {document.failed && (
                  <span className="text-danger"> · could not be read</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
